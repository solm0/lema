from __future__ import annotations

from pathlib import Path

import bootstrap_paths  # noqa: F401
BASE_DIR = Path(__file__).resolve().parent.parent
STANZA_MODEL_DIR = BASE_DIR / "models"


def get_model_dir(lang: str) -> Path:
    return STANZA_MODEL_DIR


def get_model_path(lang: str) -> Path:
    return get_model_dir(lang) / lang


def model_exists(lang: str) -> bool:
    return get_model_path(lang).exists()


def ensure_model_directories():
    STANZA_MODEL_DIR.mkdir(parents=True, exist_ok=True)


def download_model(lang: str):
    model_dir = get_model_dir(lang)

    import stanza

    stanza.download(lang, model_dir=str(model_dir), processors="tokenize,pos,lemma")
