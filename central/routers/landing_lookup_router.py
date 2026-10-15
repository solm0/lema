from fastapi import APIRouter
from pydantic import BaseModel, Field

from services import lemma_service


router = APIRouter(prefix="/api/landing", tags=["landing"])
MAX_LOOKUP_BATCH_ITEMS = 100


class LookupRequest(BaseModel):
    lemma: str = Field(min_length=1, max_length=200)
    pos: str = Field(min_length=1, max_length=40)


class BatchLookupRequest(BaseModel):
    items: list[LookupRequest] = Field(max_length=MAX_LOOKUP_BATCH_ITEMS)


def lookup_lemma(lemma: str, pos: str) -> dict:
    key = f"{lemma}_{pos}"
    if not lemma_service.has_key(key, "en"):
        return {
            "key": key,
            "global_key": f"{lemma}/{pos}/en",
            "found": False,
            "kwic": [],
            "furigana": None,
            "is_interested": False,
            "is_favorite": False,
        }

    return {
        "key": key,
        "global_key": f"{lemma}/{pos}/en",
        "found": True,
        "kwic": lemma_service.sample_kwic(
            lemma_service.get_line_ids(key, "en"), lemma, pos, "en"
        ),
        "furigana": lemma_service.get_furigana(key, "en"),
        "is_interested": False,
        "is_favorite": False,
    }


@router.post("/lookup")
def lookup(request: LookupRequest):
    return lookup_lemma(request.lemma, request.pos)


@router.post("/lookup_batch")
def lookup_batch(request: BatchLookupRequest):
    return {
        f"{item.lemma}_{item.pos}": lookup_lemma(item.lemma, item.pos)
        for item in request.items
    }
