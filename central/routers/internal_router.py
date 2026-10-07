from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from packs import PACKS

from db import get_db
from models import User, UserLemma
from routers.auth_router import get_current_user

router = APIRouter(prefix="/api")


# -----------------------------
# INTEREST BATCH CHECK
# -----------------------------

class BatchInterestCheckRequest(BaseModel):
    user_id: int
    lemma_keys: List[str]


class BatchInterestCheckResponse(BaseModel):
    interests: List[str]
    favorites: List[str]


@router.post("/user-lemmas/batch-check", response_model=BatchInterestCheckResponse)
def batch_check_interests(
    req: BatchInterestCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if req.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="forbidden")

    if not req.lemma_keys:
        return {"interests": [], "favorites": []}

    rows = db.query(UserLemma.lemma_key).filter(
        UserLemma.user_id == current_user.id,
        UserLemma.is_interested.is_(True),
        UserLemma.lemma_key.in_(req.lemma_keys)
    ).all()

    interests = [row[0] for row in rows]
    return {"interests": interests, "favorites": interests}

@router.get("/lang/packs")
def get_packs():
    return PACKS
