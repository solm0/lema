from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
STANZA_MODEL_DIR = ROOT_DIR / "backend" / "models"

SPACY_MODELS = {
    "de": "de_core_news_md",
    "en": "en_core_web_md",
    "ru": "ru_core_news_md",
}
STANZA_LANGS = {"ja", "ko"}
STANZA_MODEL_COMPONENTS = {
    "ja": ("tokenize", "pos", "lemma", "pretrain"),
    "ko": ("tokenize", "pos", "lemma", "pretrain"),
}
def _has_model_components(model_dir: Path, components: Iterable[str]) -> bool:
    return all(any((model_dir / component).glob("*.pt")) for component in components)


def _ensure_spacy_model(lang: str, log: Callable[[str], None]):
    import spacy

    model_name = SPACY_MODELS[lang]
    if spacy.util.is_package(model_name):
        return

    log(f"{lang} models: downloading spaCy model {model_name}")
    from spacy.cli import download

    download(model_name)

    if not spacy.util.is_package(model_name):
        raise RuntimeError(f"spaCy model download did not complete: {model_name}")


def _ensure_stanza_model(lang: str, log: Callable[[str], None]):
    model_dir = STANZA_MODEL_DIR / lang
    if _has_model_components(model_dir, STANZA_MODEL_COMPONENTS[lang]):
        return

    log(f"{lang} models: downloading Stanza models")
    import stanza

    STANZA_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    stanza.download(
        lang,
        model_dir=str(STANZA_MODEL_DIR),
        processors="tokenize,pos,lemma",
    )

    if not _has_model_components(model_dir, STANZA_MODEL_COMPONENTS[lang]):
        raise RuntimeError(f"Stanza model download did not complete for language: {lang}")


def ensure_language_model(lang: str, log: Callable[[str], None] = print):
    if lang in SPACY_MODELS:
        _ensure_spacy_model(lang, log)
        return

    if lang in STANZA_LANGS:
        _ensure_stanza_model(lang, log)
        return

    raise KeyError(f"No preprocess model setup is configured for language: {lang}")


def ensure_language_models(
    langs: Iterable[str],
    log: Callable[[str], None] = print,
):
    for lang in dict.fromkeys(langs):
        ensure_language_model(lang, log=log)
