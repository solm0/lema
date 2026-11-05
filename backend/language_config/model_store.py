from __future__ import annotations

import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from runtime_paths import get_opennlp_model_root, get_stanza_model_root


OPENNLP_ENGLISH_MODELS = {
    "opennlp-en-ud-ewt-sentence-1.3-2.5.4.bin": (
        "https://repo.maven.apache.org/maven2/org/apache/opennlp/"
        "opennlp-models-sentdetect-en/1.3.0/opennlp-models-sentdetect-en-1.3.0.jar"
    ),
    "opennlp-en-ud-ewt-tokens-1.3-2.5.4.bin": (
        "https://repo.maven.apache.org/maven2/org/apache/opennlp/"
        "opennlp-models-tokenizer-en/1.3.0/opennlp-models-tokenizer-en-1.3.0.jar"
    ),
    "opennlp-en-ud-ewt-pos-1.3-2.5.4.bin": (
        "https://repo.maven.apache.org/maven2/org/apache/opennlp/"
        "opennlp-models-pos-en/1.3.0/opennlp-models-pos-en-1.3.0.jar"
    ),
    "opennlp-en-ud-ewt-lemmas-1.3-2.5.4.bin": (
        "https://repo.maven.apache.org/maven2/org/apache/opennlp/"
        "opennlp-models-lemmatizer-en/1.3.0/opennlp-models-lemmatizer-en-1.3.0.jar"
    ),
}


STANZA_MODEL_DIR = get_stanza_model_root()


def english_analyzer_engine() -> str:
    """The old engine remains available for controlled regression comparison."""
    engine = os.getenv("LEMA_ENGLISH_ANALYZER", "opennlp").strip().lower()
    if engine not in {"opennlp", "stanza"}:
        raise ValueError("LEMA_ENGLISH_ANALYZER must be 'opennlp' or 'stanza'")
    return engine


def _legacy_stanza_root() -> Path | None:
    try:
        from stanza.resources.common import DEFAULT_MODEL_DIR
    except Exception:
        return None

    return Path(DEFAULT_MODEL_DIR)


def _lang_path(root: Path | None, lang: str) -> Path | None:
    if root is None:
        return None

    return root / lang


def get_local_model_dir(lang: str) -> Path:
    return STANZA_MODEL_DIR


def get_opennlp_model_dir(lang: str) -> Path:
    if lang != "en":
        raise ValueError(f"OpenNLP model storage is not configured for {lang}")
    return get_opennlp_model_root() / lang


def get_local_model_path(lang: str) -> Path:
    return get_local_model_dir(lang) / lang


def get_legacy_model_path(lang: str) -> Path | None:
    return _lang_path(_legacy_stanza_root(), lang)


def resolve_model_dir(lang: str) -> Path:
    local_dir = get_local_model_dir(lang)
    local_path = local_dir / lang

    if local_path.exists():
        return local_dir

    legacy_path = get_legacy_model_path(lang)

    if legacy_path and legacy_path.exists():
        return legacy_path.parent

    return local_dir


def ensure_model_installed(lang: str) -> Path:
    if lang == "en" and english_analyzer_engine() == "opennlp":
        return ensure_opennlp_model_installed(lang)

    local_dir = get_local_model_dir(lang)
    local_path = local_dir / lang

    if local_path.exists():
        return local_dir

    legacy_path = get_legacy_model_path(lang)

    if legacy_path and legacy_path.exists():
        return legacy_path.parent

    local_dir.mkdir(parents=True, exist_ok=True)

    import stanza

    stanza.download(lang, model_dir=str(local_dir), processors="tokenize,pos,lemma")
    return local_dir


def model_installed(lang: str) -> bool:
    if lang == "en" and english_analyzer_engine() == "opennlp":
        return all(
            (get_opennlp_model_dir(lang) / filename).is_file()
            for filename in OPENNLP_ENGLISH_MODELS
        )

    if get_local_model_path(lang).exists():
        return True

    legacy_path = get_legacy_model_path(lang)
    return bool(legacy_path and legacy_path.exists())


def remove_models(lang: str):
    paths = [get_local_model_path(lang), get_legacy_model_path(lang)]
    if lang == "en":
        paths.append(get_opennlp_model_dir(lang))

    for path in paths:
        if path and path.exists():
            shutil.rmtree(path, ignore_errors=True)


def ensure_opennlp_model_installed(lang: str) -> Path:
    model_dir = get_opennlp_model_dir(lang)
    if all((model_dir / filename).is_file() for filename in OPENNLP_ENGLISH_MODELS):
        return model_dir

    model_dir.mkdir(parents=True, exist_ok=True)
    for filename, url in OPENNLP_ENGLISH_MODELS.items():
        destination = model_dir / filename
        if destination.is_file() and destination.stat().st_size > 0:
            continue
        _download_model_from_jar(url, filename, destination)
    return model_dir


def _download_model_from_jar(url: str, filename: str, destination: Path) -> None:
    """Extract one pinned model from its official Maven artifact atomically."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jar") as temporary:
        archive_path = Path(temporary.name)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, archive_path.open("wb") as output:
            shutil.copyfileobj(response, output)
        with zipfile.ZipFile(archive_path) as archive:
            matches = [name for name in archive.namelist() if Path(name).name == filename]
            if len(matches) != 1:
                raise RuntimeError(f"OpenNLP model artifact does not contain {filename}")
            with archive.open(matches[0]) as source, tempfile.NamedTemporaryFile(
                delete=False, dir=destination.parent, suffix=".partial"
            ) as output:
                partial_path = Path(output.name)
                shutil.copyfileobj(source, output)
        partial_path.replace(destination)
    finally:
        archive_path.unlink(missing_ok=True)
        if "partial_path" in locals():
            partial_path.unlink(missing_ok=True)
