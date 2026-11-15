from pathlib import Path

from .opennlp import analyze_text as sidecar_analyze
from .sqlite_pack import LanguagePackDB, find_pack_db


LATIN_TO_CYR = str.maketrans({
    "a": "а", "A": "А", "e": "е", "E": "Е", "o": "о", "O": "О",
    "p": "р", "P": "Р", "c": "с", "C": "С", "y": "у", "Y": "У",
    "x": "х", "X": "Х", "n": "п", "N": "П", "u": "и", "U": "И",
    "k": "к", "K": "К", "m": "м", "M": "М", "t": "т", "T": "Т",
    "b": "в", "B": "В", "h": "н", "H": "Н",
})


def normalize(text: str):
    return text.translate(LATIN_TO_CYR)


def get_config(base_dir: Path):
    from .registry import get_latest_version_path

    version_path = get_latest_version_path(base_dir / "ru")
    db_path = find_pack_db(version_path)
    return {
        "normalize": normalize,
        "analyze_text": lambda text: sidecar_analyze(text, "ru", db_path),
        "pack_db": LanguagePackDB(db_path) if db_path else None,
        "db_path": db_path,
    }


def unload():
    return None
