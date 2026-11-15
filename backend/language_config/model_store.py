from __future__ import annotations

import hashlib
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from runtime_paths import get_kiwi_model_root, get_opennlp_model_root


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

OPENNLP_MODELS = {
    "en": OPENNLP_ENGLISH_MODELS,
    "de": {
        "opennlp-de-ud-gsd-sentence-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-sentdetect-de/1.3.0/opennlp-models-sentdetect-de-1.3.0.jar",
        "opennlp-de-ud-gsd-tokens-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-tokenizer-de/1.3.0/opennlp-models-tokenizer-de-1.3.0.jar",
        "opennlp-de-ud-gsd-pos-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-pos-de/1.3.0/opennlp-models-pos-de-1.3.0.jar",
        "opennlp-de-ud-gsd-lemmas-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-lemmatizer-de/1.3.0/opennlp-models-lemmatizer-de-1.3.0.jar",
    },
    "ru": {
        "opennlp-ru-ud-gsd-sentence-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-sentdetect-ru/1.3.0/opennlp-models-sentdetect-ru-1.3.0.jar",
        "opennlp-ru-ud-gsd-tokens-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-tokenizer-ru/1.3.0/opennlp-models-tokenizer-ru-1.3.0.jar",
        "opennlp-ru-ud-gsd-pos-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-pos-ru/1.3.0/opennlp-models-pos-ru-1.3.0.jar",
        "opennlp-ru-ud-gsd-lemmas-1.3-2.5.4.bin": "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-models-lemmatizer-ru/1.3.0/opennlp-models-lemmatizer-ru-1.3.0.jar",
    },
}

SUDACHI_DICTIONARY_FILENAME = "system_core.dic"
SUDACHI_DICTIONARY_URL = (
    "https://huggingface.co/datasets/solm0/nautilus-releases/resolve/main/"
    "language-packs/ja/1.1.2/sudachi-dictionary-20240409-small.zip"
)
SUDACHI_DICTIONARY_SHA256 = "904bf3a47b0feac3f9e2c0631dcc255f0950a5800fea12483599c63d410df8bd"

KIWI_MODEL_URL = (
    "https://github.com/bab2min/Kiwi/releases/download/v0.24.0/"
    "kiwi_model_v0.24.0_base.tgz"
)
KIWI_MODEL_SHA256 = "33188ba932bba4717bad5244bbec0ef8b1c9cbb47e26e68394a7976d8d779083"
KIWI_REQUIRED_MODEL_FILES = {
    "combiningRule.txt",
    "cong.mdl",
    "default.dict",
    "dialect.dict",
    "extract.mdl",
    "multi.dict",
    "nounchr.mdl",
    "sj.morph",
    "typo.dict",
}
KIWI_ARCHIVE_PREFIX = "models/cong/base/"


def get_opennlp_model_dir(lang: str) -> Path:
    if lang not in OPENNLP_MODELS:
        raise ValueError(f"OpenNLP model storage is not configured for {lang}")
    return get_opennlp_model_root() / lang


def get_sudachi_model_dir() -> Path:
    return get_opennlp_model_root() / "ja"


def get_kiwi_model_dir() -> Path:
    return get_kiwi_model_root() / "ko"


def ensure_model_installed(lang: str) -> Path:
    if lang == "ko":
        return ensure_kiwi_model_installed()
    if lang == "ja":
        return ensure_sudachi_dictionary_installed()
    if lang in OPENNLP_MODELS:
        return ensure_opennlp_model_installed(lang)
    raise ValueError(f"No Java analyzer model is configured for {lang}")


def model_installed(lang: str) -> bool:
    if lang == "ko":
        return _kiwi_model_ready(get_kiwi_model_dir())
    if lang == "ja":
        dictionary = get_sudachi_model_dir() / SUDACHI_DICTIONARY_FILENAME
        return dictionary.is_file() and dictionary.stat().st_size > 0
    if lang in OPENNLP_MODELS:
        return all(
            (get_opennlp_model_dir(lang) / filename).is_file()
            for filename in OPENNLP_MODELS[lang]
        )

    return False


def remove_models(lang: str):
    paths: list[Path] = []
    if lang in OPENNLP_MODELS:
        paths.append(get_opennlp_model_dir(lang))
    if lang == "ja":
        paths.append(get_sudachi_model_dir())
    if lang == "ko":
        paths.append(get_kiwi_model_dir())

    for path in paths:
        if path and path.exists():
            shutil.rmtree(path, ignore_errors=True)


def ensure_opennlp_model_installed(lang: str) -> Path:
    model_dir = get_opennlp_model_dir(lang)
    models = OPENNLP_MODELS[lang]
    if all((model_dir / filename).is_file() for filename in models):
        return model_dir

    model_dir.mkdir(parents=True, exist_ok=True)
    for filename, url in models.items():
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


def ensure_sudachi_dictionary_installed() -> Path:
    """Install the Android-pinned Sudachi dictionary outside the app bundle."""
    model_dir = get_sudachi_model_dir()
    destination = model_dir / SUDACHI_DICTIONARY_FILENAME
    if destination.is_file() and destination.stat().st_size > 0:
        return model_dir
    model_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temporary:
        archive_path = Path(temporary.name)
    try:
        with urllib.request.urlopen(SUDACHI_DICTIONARY_URL, timeout=120) as response, archive_path.open("wb") as output:
            shutil.copyfileobj(response, output)
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        if digest != SUDACHI_DICTIONARY_SHA256:
            raise RuntimeError("Downloaded Sudachi dictionary failed SHA-256 verification")
        with zipfile.ZipFile(archive_path) as archive:
            matches = [name for name in archive.namelist() if Path(name).name == SUDACHI_DICTIONARY_FILENAME]
            if len(matches) != 1:
                raise RuntimeError(f"Sudachi dictionary artifact does not contain {SUDACHI_DICTIONARY_FILENAME}")
            with archive.open(matches[0]) as source, tempfile.NamedTemporaryFile(
                delete=False, dir=model_dir, suffix=".partial"
            ) as output:
                partial_path = Path(output.name)
                shutil.copyfileobj(source, output)
        partial_path.replace(destination)
    finally:
        archive_path.unlink(missing_ok=True)
        if "partial_path" in locals():
            partial_path.unlink(missing_ok=True)
    return model_dir


def _kiwi_model_ready(model_dir: Path) -> bool:
    return model_dir.is_dir() and all(
        (model_dir / filename).is_file() and (model_dir / filename).stat().st_size > 0
        for filename in KIWI_REQUIRED_MODEL_FILES
    )


def ensure_kiwi_model_installed() -> Path:
    """Install the Android-pinned Kiwi model outside the desktop bundle."""
    model_dir = get_kiwi_model_dir()
    if _kiwi_model_ready(model_dir):
        return model_dir

    model_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as temporary:
        archive_path = Path(temporary.name)
    staging = Path(tempfile.mkdtemp(prefix=".ko-kiwi-", dir=model_dir.parent))
    try:
        with urllib.request.urlopen(KIWI_MODEL_URL, timeout=120) as response, archive_path.open("wb") as output:
            shutil.copyfileobj(response, output)
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        if digest != KIWI_MODEL_SHA256:
            raise RuntimeError("Downloaded Kiwi model failed SHA-256 verification")
        with tarfile.open(archive_path, "r:gz") as archive:
            members = {
                member.name[len(KIWI_ARCHIVE_PREFIX):]: member
                for member in archive.getmembers()
                if member.isfile()
                and member.name.startswith(KIWI_ARCHIVE_PREFIX)
                and "/" not in member.name[len(KIWI_ARCHIVE_PREFIX):]
                and member.name[len(KIWI_ARCHIVE_PREFIX):] in KIWI_REQUIRED_MODEL_FILES
            }
            missing = KIWI_REQUIRED_MODEL_FILES - members.keys()
            if missing:
                raise RuntimeError(f"Kiwi model archive is missing files: {sorted(missing)}")
            for filename, member in members.items():
                source = archive.extractfile(member)
                if source is None:
                    raise RuntimeError(f"Could not read Kiwi model file: {filename}")
                with source, (staging / filename).open("wb") as output:
                    shutil.copyfileobj(source, output)
        if not _kiwi_model_ready(staging):
            raise RuntimeError("Extracted Kiwi model is incomplete")
        shutil.rmtree(model_dir, ignore_errors=True)
        staging.replace(model_dir)
    finally:
        archive_path.unlink(missing_ok=True)
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
    return model_dir
