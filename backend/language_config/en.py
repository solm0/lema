import unicodedata
from pathlib import Path

from .opennlp_english import analyze_text
from .sqlite_pack import LanguagePackDB, find_pack_db


def normalize(text: str):
    return unicodedata.normalize("NFC", text)


def get_config(base_dir: Path):
    from .registry import get_latest_version_path

    version_path = get_latest_version_path(base_dir / "en")
    db_path = find_pack_db(version_path)
    return {
        "normalize": normalize,
        "analyze_text": analyze_text,
        "pack_db": LanguagePackDB(db_path) if db_path else None,
        "db_path": db_path,
    }


def unload():
    return None
