from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import get_db
from models import User, UserLemma
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
        "updated_at": state.updated_at.isoformat() if state.updated_at else None,
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
    if req.is_known is not None:
        state.is_known = req.is_known
    if req.is_interested is not None:
        state.is_interested = req.is_interested
    if req.memo is not None:
        state.memo = req.memo
    state.updated_at = datetime.utcnow()
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
