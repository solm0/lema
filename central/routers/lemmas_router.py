from datetime import date, datetime, timedelta
import hashlib
import json
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import get_db
from models import (
    User,
    UserLemma,
    UserLemmaExample,
    UserLemmaMilestone,
    UserRecapItem,
    UserRecapWeek,
)
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


class RecapQuestionRequest(BaseModel):
    """A client-selected local-language-pack question snapshot.

    The central service deliberately has no language-pack corpus.  The client
    picks the examples using its installed pack, then saves this payload so a
    refresh or another device resumes the identical question.
    """

    question: dict[str, Any]


class RecapAnswerRequest(BaseModel):
    choice_key: str = Field(min_length=1, max_length=600)


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
    origin = state.last_recap_succeeded_at or state.created_at or state.updated_at or datetime.utcnow()
    age_days = max(0, (datetime.utcnow() - origin).total_seconds() / 86_400)
    age_days = max(0, age_days - (state.decay_reduction_days or 0))
    return min(100, round(age_days / 365 * 100))


RECAP_GROUP_SIZE = 8
RECAP_SESSION_SIZE = 2


def _recap_day(timezone: str) -> date:
    try:
        return datetime.now(ZoneInfo(timezone)).date()
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="invalid timezone") from exc


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _week_key(day: date) -> str:
    return _week_start(day).isoformat()


def _serialize_recap_item(item: UserRecapItem) -> dict:
    return {
        "id": item.id,
        "lemma_key": item.lemma_key,
        "position": item.position,
        "status": item.status,
        "attempt_count": item.attempt_count,
    }


def _client_question(question_json: str | None) -> dict | None:
    if not question_json:
        return None
    question = json.loads(question_json)
    # The answer remains server-side after a question is frozen.
    question.pop("answer_key", None)
    return question


def _expire_old_recap_weeks(db: Session, user_id: int, current_week: str, now: datetime) -> None:
    old_weeks = db.query(UserRecapWeek).filter(
        UserRecapWeek.user_id == user_id,
        UserRecapWeek.week_start < current_week,
        UserRecapWeek.expired_at.is_(None),
        UserRecapWeek.completed_at.is_(None),
    ).all()
    for week in old_weeks:
        db.query(UserRecapItem).filter(
            UserRecapItem.recap_week_id == week.id,
            UserRecapItem.kind == "test",
            UserRecapItem.status == "pending",
        ).update({"status": "expired"}, synchronize_session=False)
        week.expired_at = now


def _select_showcase_lemmas(db: Session, user_id: int, week_start: date) -> list[str]:
    """Apply the agreed priority order, with no hidden repetition correction."""
    recent_failure_cutoff = datetime.combine(week_start - timedelta(days=7), datetime.min.time())
    rows = db.query(UserLemma).filter(
        UserLemma.user_id == user_id,
        (UserLemma.is_known.is_(True)) | (UserLemma.is_interested.is_(True)),
        (UserLemma.last_recap_failed_at.is_(None)) | (UserLemma.last_recap_failed_at < recent_failure_cutoff),
    ).all()

    def by_decay(states: list[UserLemma]) -> list[UserLemma]:
        return sorted(states, key=lambda state: (_decay(state), state.id), reverse=True)

    # 1) known with the highest decay; 2) interested with high decay; 3) up
    # to two interested lemmas added during the preceding calendar week.
    recent_start = datetime.combine(week_start - timedelta(days=7), datetime.min.time())
    recent_end = datetime.combine(week_start, datetime.min.time())
    tiers = [
        by_decay([row for row in rows if row.is_known]),
        by_decay([row for row in rows if row.is_interested]),
        by_decay([
            row for row in rows
            if row.is_interested and row.created_at and recent_start <= row.created_at < recent_end
        ])[:2],
    ]
    selected: list[str] = []
    for tier in tiers:
        for row in tier:
            if row.lemma_key not in selected:
                selected.append(row.lemma_key)
            if len(selected) == RECAP_GROUP_SIZE:
                return selected
    return selected


def _ensure_recap_week(db: Session, user_id: int, timezone: str) -> tuple[UserRecapWeek, date]:
    today = _recap_day(timezone)
    current_week = _week_key(today)
    now = datetime.utcnow()
    _expire_old_recap_weeks(db, user_id, current_week, now)
    week = db.query(UserRecapWeek).filter_by(user_id=user_id, week_start=current_week).first()
    if week is not None:
        db.commit()
        return week, today

    previous_week_key = (_week_start(today) - timedelta(days=7)).isoformat()
    previous = db.query(UserRecapWeek).filter_by(
        user_id=user_id,
        week_start=previous_week_key,
    ).first()
    week = UserRecapWeek(user_id=user_id, week_start=current_week)
    db.add(week)
    db.flush()

    if previous is not None:
        previous_showcase = db.query(UserRecapItem).filter_by(
            recap_week_id=previous.id,
            kind="showcase",
        ).order_by(UserRecapItem.position.asc()).limit(RECAP_GROUP_SIZE).all()
        for position, item in enumerate(previous_showcase, start=1):
            db.add(UserRecapItem(
                recap_week_id=week.id,
                lemma_key=item.lemma_key,
                kind="test",
                position=position,
            ))

    for position, lemma_key in enumerate(_select_showcase_lemmas(db, user_id, _week_start(today)), start=1):
        db.add(UserRecapItem(
            recap_week_id=week.id,
            lemma_key=lemma_key,
            kind="showcase",
            position=position,
        ))
    db.commit()
    db.refresh(week)
    return week, today


def _get_recap_item(db: Session, user_id: int, item_id: int) -> tuple[UserRecapWeek, UserRecapItem]:
    row = db.query(UserRecapItem, UserRecapWeek).join(
        UserRecapWeek, UserRecapItem.recap_week_id == UserRecapWeek.id,
    ).filter(
        UserRecapItem.id == item_id,
        UserRecapWeek.user_id == user_id,
        UserRecapItem.kind == "test",
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="recap item not found")
    item, week = row
    return week, item


def _mark_recap_complete_if_needed(db: Session, week: UserRecapWeek, now: datetime) -> None:
    pending = db.query(UserRecapItem).filter_by(
        recap_week_id=week.id,
        kind="test",
        status="pending",
    ).count()
    if pending == 0 and week.completed_at is None:
        week.completed_at = now


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


@router.get("/lemma/recap")
def get_recap(
    timezone: str = Query(default="UTC", min_length=1, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return this week's fixed test group and its next-week showcase."""
    week, today = _ensure_recap_week(db, current_user.id, timezone)
    tests = db.query(UserRecapItem).filter_by(
        recap_week_id=week.id,
        kind="test",
    ).order_by(UserRecapItem.position.asc()).all()
    showcase = db.query(UserRecapItem).filter_by(
        recap_week_id=week.id,
        kind="showcase",
    ).order_by(UserRecapItem.position.asc()).all()
    pending = [item for item in tests if item.status == "pending"]
    today_key = today.isoformat()
    active_session = [item for item in pending if item.session_date == today_key]
    return {
        "week_start": week.week_start,
        "available": bool(tests),
        "state": (
            "warming_up" if not tests else
            "completed" if week.completed_at else
            "daily_complete" if week.last_session_date == today_key and not active_session else
            "ready"
        ),
        "remaining_count": len(pending),
        "test_items": [_serialize_recap_item(item) for item in tests],
        "showcase_items": [_serialize_recap_item(item) for item in showcase],
    }


@router.post("/lemma/recap/session")
def start_recap_session(
    timezone: str = Query(default="UTC", min_length=1, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Open (or resume) today's one two-word Revival session."""
    week, today = _ensure_recap_week(db, current_user.id, timezone)
    if week.completed_at or week.expired_at:
        raise HTTPException(status_code=409, detail="recap week is not active")
    today_key = today.isoformat()
    all_tests = db.query(UserRecapItem).filter_by(
        recap_week_id=week.id,
        kind="test",
    ).order_by(UserRecapItem.position.asc()).all()
    if not all_tests:
        raise HTTPException(status_code=409, detail="recap is warming up")

    session_items = [
        item for item in all_tests
        if item.session_date == today_key and item.status == "pending"
    ]
    if not session_items:
        if week.last_session_date == today_key:
            raise HTTPException(status_code=409, detail="today's recap is complete")
        session_items = [item for item in all_tests if item.status == "pending"][:RECAP_SESSION_SIZE]
        if not session_items:
            _mark_recap_complete_if_needed(db, week, datetime.utcnow())
            db.commit()
            raise HTTPException(status_code=409, detail="recap week is complete")
        for item in session_items:
            item.session_date = today_key
        week.last_session_date = today_key
        db.commit()
    return {
        "week_start": week.week_start,
        "items": [_serialize_recap_item(item) for item in session_items],
    }


@router.put("/lemma/recap/items/{item_id}/question")
def save_recap_question(
    item_id: int,
    req: RecapQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Freeze a locally generated question the first time it is displayed."""
    week, item = _get_recap_item(db, current_user.id, item_id)
    if week.completed_at or week.expired_at or item.status != "pending":
        raise HTTPException(status_code=409, detail="recap item is not active")
    if item.session_date is None:
        raise HTTPException(status_code=409, detail="recap session has not been started")
    if item.question_json is None:
        answer_key = req.question.get("answer_key")
        options = req.question.get("options")
        if not isinstance(answer_key, str) or not answer_key:
            raise HTTPException(status_code=422, detail="question answer_key is required")
        if not isinstance(options, list) or len(options) != 4:
            raise HTTPException(status_code=422, detail="question must contain four options")
        option_keys = {
            option.get("key") for option in options
            if isinstance(option, dict) and isinstance(option.get("key"), str)
        }
        if answer_key not in option_keys:
            raise HTTPException(status_code=422, detail="answer_key must be one of the options")
        item.question_json = json.dumps(req.question, ensure_ascii=False, separators=(",", ":"))
        db.commit()
    return {"item": _serialize_recap_item(item), "question": _client_question(item.question_json)}


@router.post("/lemma/recap/items/{item_id}/answer")
def answer_recap_question(
    item_id: int,
    req: RecapAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    week, item = _get_recap_item(db, current_user.id, item_id)
    if week.completed_at or week.expired_at or item.status != "pending":
        raise HTTPException(status_code=409, detail="recap item is not active")
    if item.session_date is None:
        raise HTTPException(status_code=409, detail="recap session has not been started")
    if not item.question_json:
        raise HTTPException(status_code=409, detail="recap question has not been created")
    question = json.loads(item.question_json)
    answer_key = question.get("answer_key")
    now = datetime.utcnow()
    correct = req.choice_key == answer_key
    item.attempt_count = min(2, (item.attempt_count or 0) + 1)
    if correct:
        item.status = "passed"
        item.answered_at = now
        lemma = db.query(UserLemma).filter_by(
            user_id=current_user.id,
            lemma_key=item.lemma_key,
        ).first()
        if lemma is not None:
            lemma.last_recap_succeeded_at = now
            lemma.updated_at = now
    elif item.attempt_count >= 2:
        item.status = "failed"
        item.answered_at = now
        lemma = db.query(UserLemma).filter_by(
            user_id=current_user.id,
            lemma_key=item.lemma_key,
        ).first()
        if lemma is not None:
            lemma.last_recap_failed_at = now
    if item.status != "pending":
        _mark_recap_complete_if_needed(db, week, now)
    db.commit()
    return {
        "correct": correct,
        "retry_available": not correct and item.status == "pending",
        "status": item.status,
        "answer_key": answer_key if item.status != "pending" else None,
        "week_completed": week.completed_at is not None,
    }


@router.delete("/lemma/profile")
def reset_lemma_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete every cloud-synced vocabulary record for the current user."""
    user_id = current_user.id
    db.query(UserLemmaExample).filter(
        UserLemmaExample.user_id == user_id,
    ).delete(synchronize_session=False)
    db.query(UserLemmaMilestone).filter(
        UserLemmaMilestone.user_id == user_id,
    ).delete(synchronize_session=False)
    recap_weeks = db.query(UserRecapWeek.id).filter(
        UserRecapWeek.user_id == user_id,
    ).subquery()
    db.query(UserRecapItem).filter(
        UserRecapItem.recap_week_id.in_(recap_weeks),
    ).delete(synchronize_session=False)
    db.query(UserRecapWeek).filter(
        UserRecapWeek.user_id == user_id,
    ).delete(synchronize_session=False)
    db.query(UserLemma).filter(
        UserLemma.user_id == user_id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


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
