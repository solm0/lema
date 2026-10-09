from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from typing import List

from services.nlp_service import analyze_text

router = APIRouter(prefix="/api")

MAX_ANALYZE_BLOCKS = 100
MAX_ANALYZE_CHARS = 50_000


class Block(BaseModel):
    text: str = Field(max_length=MAX_ANALYZE_CHARS)


class AnalyzeRequest(BaseModel):
    blocks: List[Block] = Field(max_length=MAX_ANALYZE_BLOCKS)
    language: str

    @model_validator(mode="after")
    def validate_total_chars(self):
        if sum(len(block.text) for block in self.blocks) > MAX_ANALYZE_CHARS:
            raise ValueError(f"analysis input exceeds {MAX_ANALYZE_CHARS} characters")
        return self


@router.post("/analyze")
def analyze(req: AnalyzeRequest):
    out_blocks = []

    for block in req.blocks:
        text = block.text.strip()

        if not text:
            out_blocks.append({
                "text": block.text,
                "tokens": []
            })
            continue

        out_blocks.append({
            "text": block.text,
            "tokens": analyze_text(text, req.language) or []
        })

    return {"blocks": out_blocks}
