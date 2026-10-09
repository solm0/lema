import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from db import get_db
from models import User, UserLemma
from routers.auth_router import get_current_user
from services.analysis_access import AnalysisLease, acquire_analysis_lease
from services import lemma_service
from services.nlp_service import AnalysisQueueFull, analyze_text

router = APIRouter(prefix="/api/mobile", tags=["mobile"])
logger = logging.getLogger(__name__)

MAX_ANALYZE_BLOCKS = 100
MAX_ANALYZE_CHARS = 50_000
MAX_LOOKUP_BATCH_ITEMS = 100


class Block(BaseModel):
    text: str = Field(max_length=MAX_ANALYZE_CHARS)


class AnalyzeRequest(BaseModel):
    blocks: list[Block] = Field(max_length=MAX_ANALYZE_BLOCKS)
    language: str

    @model_validator(mode="after")
    def validate_total_chars(self):
        if sum(len(block.text) for block in self.blocks) > MAX_ANALYZE_CHARS:
            raise ValueError(f"analysis input exceeds {MAX_ANALYZE_CHARS} characters")
        return self


class LookupRequest(BaseModel):
    lemma: str
    pos: str
    language: str


class BatchLookupRequest(BaseModel):
    items: list[dict] = Field(max_length=MAX_LOOKUP_BATCH_ITEMS)
    language: str


def to_local_key(lemma: str, pos: str) -> str:
    return f"{lemma}_{pos}"


def to_global_key(lemma: str, pos: str, lang: str) -> str:
    return f"{lemma}/{pos}/{lang}"


def fetch_user_lemma_states(
    db: Session,
    user: User,
):
    rows = db.query(UserLemma).filter(
        UserLemma.user_id == user.id,
    ).all()

    return {
        row.lemma_key: {
            "exposure_count": min(max(row.exposure_count or 0, 0), 10),
            "is_known": bool(row.is_known),
            "is_interested": bool(row.is_interested),
        }
        for row in rows
    }


@router.post("/analyze")
def analyze(
    req: AnalyzeRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    lease: AnalysisLease = acquire_analysis_lease(
        user_id=current_user.id,
        request=request,
    )
    started_at = time.perf_counter()
    logger.info(
        "[mobile.analyze] start user_id=%s language=%s blocks=%s",
        current_user.id,
        req.language,
        len(req.blocks),
    )

    try:
        out_blocks = []

        for index, block in enumerate(req.blocks):
            text = block.text.strip()

            if not text:
                out_blocks.append({
                    "text": block.text,
                    "tokens": [],
                })
                continue

            block_started_at = time.perf_counter()

            try:
                logger.info(
                    "[mobile.analyze] block=%s chars=%s running_nlp",
                    index,
                    len(text),
                )
                tokens_all = analyze_text(text, req.language)
                logger.info(
                    "[mobile.analyze] block=%s nlp_done elapsed=%.2fs",
                    index,
                    time.perf_counter() - block_started_at,
                )
            except AnalysisQueueFull as exc:
                logger.info(
                    "[mobile.analyze] block=%s language=%s queue_full",
                    index,
                    req.language,
                )
                raise HTTPException(
                    status_code=429,
                    detail={
                        "code": "analysis_queue_full",
                        "message": "analysis queue is full for this language",
                    },
                    headers={"Retry-After": "5"},
                ) from exc
            except Exception:
                logger.exception(
                    "[mobile.analyze] block=%s nlp failed chars=%s",
                    index,
                    len(text),
                )
                raise

            out_blocks.append({
                "text": block.text,
                "tokens": tokens_all or [],
            })

        logger.info(
            "[mobile.analyze] done user_id=%s language=%s blocks=%s elapsed=%.2fs",
            current_user.id,
            req.language,
            len(out_blocks),
            time.perf_counter() - started_at,
        )
        return {"blocks": out_blocks}
    finally:
        lease.release()


@router.post("/lookup")
def lookup(
    req: LookupRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    global_key = to_global_key(req.lemma, req.pos, req.language)
    local_key = to_local_key(req.lemma, req.pos)

    user_lemma_states = fetch_user_lemma_states(db, user)
    is_interested = bool(user_lemma_states.get(global_key, {}).get("is_interested"))

    if not lemma_service.has_key(local_key, req.language):
        return {
            "key": local_key,
            "global_key": global_key,
            "found": False,
            "kwic": [],
            "furigana": None,
            "is_interested": is_interested,
            "is_favorite": is_interested,
        }

    line_ids = lemma_service.get_line_ids(local_key, req.language)

    kwic = lemma_service.sample_kwic(
        line_ids,
        req.lemma,
        req.pos,
        req.language,
        user_lemma_states=user_lemma_states,
    )

    return {
        "key": local_key,
        "global_key": global_key,
        "found": True,
        "kwic": kwic,
        "furigana": lemma_service.get_furigana(local_key, req.language),
        "is_interested": is_interested,
        "is_favorite": is_interested,
    }


@router.post("/lookup_batch")
def lookup_batch(
    req: BatchLookupRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lang = req.language
    result = {}

    user_lemma_states = fetch_user_lemma_states(db, user)

    for item in req.items:
        lemma = item["lemma"]
        pos = item["pos"]

        local_key = to_local_key(lemma, pos)
        global_key = to_global_key(lemma, pos, lang)

        if not lemma_service.has_key(local_key, lang):
            continue

        result[local_key] = {
            "key": local_key,
            "global_key": global_key,
            "found": True,
            "furigana": lemma_service.get_furigana(local_key, lang),
            "kwic": lemma_service.sample_kwic(
                lemma_service.get_line_ids(local_key, lang),
                lemma,
                pos,
                lang,
                user_lemma_states=user_lemma_states,
            ),
            "is_interested": bool(
                user_lemma_states.get(global_key, {}).get("is_interested")
            ),
            "is_favorite": bool(
                user_lemma_states.get(global_key, {}).get("is_interested")
            ),
        }

    return result
