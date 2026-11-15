from __future__ import annotations

import sqlite3
from pathlib import Path

from language_config.model_store import get_kiwi_model_dir, get_opennlp_model_dir, get_sudachi_model_dir
from runtime_paths import get_runtime_root
from sidecars.opennlp_english import sidecar


def _lemma_keys_file(language: str, db_path: Path | None) -> Path | None:
    if language not in {"de", "ja", "ru"} or db_path is None or not db_path.is_file():
        return None
    target = get_runtime_root() / "opennlp-keys" / f"{language}-{db_path.stem}.txt"
    if target.exists() and target.stat().st_mtime >= db_path.stat().st_mtime:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        keys = connection.execute("SELECT lemma_key FROM lemma_stats").fetchall()
    temporary = target.with_suffix(".partial")
    temporary.write_text("\n".join(key for (key,) in keys) + "\n", encoding="utf-8")
    temporary.replace(target)
    return target


def analyze_text(text: str, language: str, db_path: Path | None = None) -> list[dict]:
    if language == "ja":
        model_dir = get_sudachi_model_dir()
    elif language == "ko":
        model_dir = get_kiwi_model_dir()
    else:
        model_dir = get_opennlp_model_dir(language)
    return sidecar.analyze(text, model_dir, language, _lemma_keys_file(language, db_path))
