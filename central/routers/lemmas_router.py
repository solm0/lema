from datetime import datetime
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import get_db
from models import User, UserLemma, UserLemmaExample, UserLemmaMilestone
from services.lemma_example_limits import lemma_example_write_limiter
from .auth_router import get_current_user


router = APIRouter(prefix="/api")


class InterestRequest(BaseModel):
    key: str


class InterestBatchRequest(BaseModel):
    keys: list[str]


class LemmaStateRequest(BaseModel):
    key: str
    exposure_count: int | None = Field(default=None, ge=0, le=10)
    is_known: bool | None = None
    is_interested: bool | None = None
    memo: str | None = Field(default=None, max_length=20)


class ExampleMorphRequest(BaseModel):
    surface: str = Field(min_length=1, max_length=200)
    lemma: str | None = Field(default=None, max_length=200)
    pos: str | None = Field(default=None, max_length=64)


class ExampleTokenRequest(BaseModel):
    surface: str = Field(min_length=1, max_length=500)
    lemma: str | None = Field(default=None, max_length=500)
    pos: str | None = Field(default=None, max_length=64)
    morphs: list[ExampleMorphRequest] | None = Field(default=None, max_length=32)


class LemmaExampleRequest(BaseModel):
    lemma_key: str = Field(min_length=3, max_length=600)
    language: str = Field(min_length=2, max_length=16)
    text: str = Field(min_length=1, max_length=8_000)
    tokens: list[ExampleTokenRequest] = Field(min_length=1, max_length=300)
    match_indices: list[int] = Field(min_length=1, max_length=32)


MAX_EXAMPLES_PER_USER = 10_000
DATABASE_PAGE_SIZE = 10


def _key_parts(key: str) -> tuple[str, str, str]:
    """Keys are stored as lemma/POS/language; tolerate old malformed rows."""
    parts = key.rsplit("/", 2)
    if len(parts) != 3:
        return key, "", ""
    return parts[0], parts[1], parts[2]


def _decay(state: UserLemma) -> int:
    """A read-only 0–100 score: 100 after one year without a state change."""
    origin = state.created_at or state.updated_at or datetime.utcnow()
    age_days = max(0, (datetime.utcnow() - origin).total_seconds() / 86_400)
    age_days = max(0, age_days - (state.decay_reduction_days or 0))
    return min(100, round(age_days / 365 * 100))


def _known_word_milestone(count: int) -> bool:
    return count in {10, 25, 50, 100, 250, 500, 1000} or (count > 1000 and count % 500 == 0)


def _example_payload(req: LemmaExampleRequest) -> tuple[str, str, str]:
    if any(index < 0 or index >= len(req.tokens) for index in req.match_indices):
        raise HTTPException(status_code=422, detail="match index is outside the token list")
    tokens = [token.model_dump(exclude_none=True) for token in req.tokens]
    match_indices = sorted(set(req.match_indices))
    canonical = json.dumps(
        {"lemma_key": req.lemma_key, "tokens": tokens},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return (
        json.dumps(tokens, ensure_ascii=False, separators=(",", ":")),
        json.dumps(match_indices, separators=(",", ":")),
        hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )


def _serialize_example(example: UserLemmaExample) -> dict:
    return {
        "id": example.id,
        "lemma_key": example.lemma_key,
        "language": example.language,
        "text": example.text,
        "tokens": json.loads(example.tokens_json),
        "match_indices": json.loads(example.match_indices_json),
        "created_at": example.created_at.isoformat(),
        "last_seen_at": example.last_seen_at.isoformat(),
    }


def _get_or_create_state(db: Session, user_id: int, key: str) -> UserLemma:
    state = db.query(UserLemma).filter_by(user_id=user_id, lemma_key=key).first()
    if state is None:
        state = UserLemma(
            user_id=user_id,
            lemma_key=key,
            exposure_count=0,
            is_known=False,
            is_interested=False,
            memo="",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(state)
    return state


def _serialize_state(state: UserLemma) -> dict:
    return {
        "key": state.lemma_key,
        "exposure_count": min(max(state.exposure_count or 0, 0), 10),
        "is_known": bool(state.is_known),
        "is_interested": bool(state.is_interested),
        "memo": state.memo or "",
        "created_at": (state.created_at or state.updated_at).isoformat()
        if state.created_at or state.updated_at else None,
        "updated_at": state.updated_at.isoformat() if state.updated_at else None,
        "decay": _decay(state),
    }


@router.patch("/lemma/state")
def update_lemma_state(
    req: LemmaStateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    state = _get_or_create_state(db, current_user.id, req.key)
    if req.exposure_count is not None:
        state.exposure_count = max(state.exposure_count or 0, req.exposure_count)
    became_known = req.is_known is True and not state.is_known
    if req.is_known is not None:
        state.is_known = req.is_known
    if req.is_interested is not None:
        state.is_interested = req.is_interested
    if req.memo is not None:
        state.memo = req.memo
    # A state edit meaningfully refreshes a word without requiring a write on
    # every database read. Thirty days is enough to be visible but not a reset.
    state.decay_reduction_days = min(365, (state.decay_reduction_days or 0) + 30)
    state.updated_at = datetime.utcnow()
    if became_known:
        _, _, language = _key_parts(state.lemma_key)
        if language:
            known_count = db.query(UserLemma).filter(
                UserLemma.user_id == current_user.id,
                UserLemma.is_known.is_(True),
                UserLemma.lemma_key.endswith(f"/{language}"),
            ).count()
            if _known_word_milestone(known_count):
                existing = db.query(UserLemmaMilestone).filter_by(
                    user_id=current_user.id,
                    language=language,
                    known_count=known_count,
                ).first()
                if existing is None:
                    db.add(UserLemmaMilestone(
                        user_id=current_user.id,
                        language=language,
                        known_count=known_count,
                        achieved_at=state.updated_at,
                    ))
    db.commit()
    db.refresh(state)
    return _serialize_state(state)


@router.get("/lemma/profile")
def get_lemma_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.query(UserLemma).filter(UserLemma.user_id == current_user.id).all()
    return {"items": [_serialize_state(row) for row in rows]}


@router.get("/lemma/database")
def get_lemma_database(
    q: str | None = Query(default=None, max_length=100),
    pos: str | None = Query(default=None, max_length=64),
    language: str | None = Query(default=None, max_length=16),
    is_known: bool | None = None,
    is_interested: bool | None = None,
    offset: int = Query(default=0, ge=0, le=100_000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A bounded database view; never materialize a user's whole profile."""
    query = db.query(UserLemma).filter(UserLemma.user_id == current_user.id)
    if q:
        query = query.filter(UserLemma.lemma_key.startswith(q.strip()))
    if pos:
        query = query.filter(UserLemma.lemma_key.like(f"%/{pos}/%"))
    if language:
        query = query.filter(UserLemma.lemma_key.endswith(f"/{language}"))
    if is_known is not None:
        query = query.filter(UserLemma.is_known.is_(is_known))
    if is_interested is not None:
        query = query.filter(UserLemma.is_interested.is_(is_interested))

    rows = query.order_by(UserLemma.updated_at.desc(), UserLemma.id.desc()).offset(offset).limit(DATABASE_PAGE_SIZE + 1).all()
    items = []
    for row in rows[:DATABASE_PAGE_SIZE]:
        item = _serialize_state(row)
        lemma, item_pos, item_language = _key_parts(row.lemma_key)
        item.update({"lemma": lemma, "pos": item_pos, "language": item_language})
        items.append(item)
    return {"items": items, "has_more": len(rows) > DATABASE_PAGE_SIZE}


@router.get("/lemma/milestones")
def get_lemma_milestones(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(UserLemmaMilestone)
        .filter(UserLemmaMilestone.user_id == current_user.id)
        .order_by(UserLemmaMilestone.language.asc(), UserLemmaMilestone.achieved_at.desc())
        .all()
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        entries = grouped.setdefault(row.language, [])
        if len(entries) < 3:
            entries.append({"count": row.known_count, "achieved_at": row.achieved_at.isoformat()})
    return {"items": grouped}


@router.delete("/lemma/state")
def delete_lemma_state(
    key: str = Query(min_length=3, max_length=600),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(UserLemmaExample).filter(
        UserLemmaExample.user_id == current_user.id,
        UserLemmaExample.lemma_key == key,
    ).delete(synchronize_session=False)
    db.query(UserLemma).filter(
        UserLemma.user_id == current_user.id,
        UserLemma.lemma_key == key,
    ).delete(synchronize_session=False)
    db.commit()
    return {"key": key, "deleted": True}


@router.get("/lemma/examples")
def get_lemma_examples(
    key: str = Query(min_length=3, max_length=600),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(UserLemmaExample)
        .filter(
            UserLemmaExample.user_id == current_user.id,
            UserLemmaExample.lemma_key == key,
        )
        .order_by(UserLemmaExample.last_seen_at.desc(), UserLemmaExample.id.desc())
        .limit(100)
        .all()
    )
    return {"items": [_serialize_example(row) for row in rows]}


@router.post("/lemma/examples")
def save_lemma_example(
    req: LemmaExampleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tokens_json, match_indices_json, content_hash = _example_payload(req)
    existing = db.query(UserLemmaExample).filter_by(
        user_id=current_user.id,
        lemma_key=req.lemma_key,
        content_hash=content_hash,
    ).first()
    now = datetime.utcnow()
    if existing is not None:
        existing.last_seen_at = now
        db.commit()
        db.refresh(existing)
        return {"created": False, "item": _serialize_example(existing)}

    retry_after = lemma_example_write_limiter.reserve(current_user.id)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail={"code": "lemma_example_rate_limited", "retry_after_seconds": retry_after},
            headers={"Retry-After": str(retry_after)},
        )

    count = db.query(UserLemmaExample).filter_by(user_id=current_user.id).count()
    if count >= MAX_EXAMPLES_PER_USER:
        raise HTTPException(status_code=409, detail={"code": "lemma_example_limit_reached"})

    example = UserLemmaExample(
        user_id=current_user.id,
        lemma_key=req.lemma_key,
        language=req.language,
        text=req.text,
        tokens_json=tokens_json,
        match_indices_json=match_indices_json,
        content_hash=content_hash,
        created_at=now,
        last_seen_at=now,
    )
    db.add(example)
    db.commit()
    db.refresh(example)
    return {"created": True, "item": _serialize_example(example)}


@router.post("/lemma/interest")
@router.post("/lemma/favorite", include_in_schema=False)
def add_interest(
    req: InterestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    state = _get_or_create_state(db, current_user.id, req.key)
    state.is_interested = True
    state.updated_at = datetime.utcnow()
    state.decay_reduction_days = min(365, (state.decay_reduction_days or 0) + 30)
    db.commit()
    return {"key": req.key, "is_interested": True, "is_favorite": True}


@router.delete("/lemma/interest")
@router.delete("/lemma/favorite", include_in_schema=False)
def remove_interest(
    req: InterestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    state = db.query(UserLemma).filter_by(
        user_id=current_user.id,
        lemma_key=req.key,
    ).first()
    if state:
        state.is_interested = False
        state.updated_at = datetime.utcnow()
        state.decay_reduction_days = min(365, (state.decay_reduction_days or 0) + 30)
        db.commit()
    return {"key": req.key, "is_interested": False, "is_favorite": False}


@router.post("/lemma/interest/check")
@router.post("/lemma/favorite/check", include_in_schema=False)
def check_interests(
    req: InterestBatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.query(UserLemma.lemma_key).filter(
        UserLemma.user_id == current_user.id,
        UserLemma.is_interested.is_(True),
        UserLemma.lemma_key.in_(req.keys),
    ).all()
    interests = [row[0] for row in rows]
    return {"interests": interests, "favorites": interests}


@router.get("/lemma/interests")
@router.get("/lemma/favorites", include_in_schema=False)
def get_interests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.query(UserLemma.lemma_key).filter(
        UserLemma.user_id == current_user.id,
        UserLemma.is_interested.is_(True),
    ).all()
    return {"items": [row[0] for row in rows]}
