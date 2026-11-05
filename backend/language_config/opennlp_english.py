from __future__ import annotations

from language_config.model_store import get_opennlp_model_dir
from sidecars.opennlp_english import sidecar


def analyze_text(text: str) -> list[dict]:
    return sidecar.analyze(text, get_opennlp_model_dir("en"))
