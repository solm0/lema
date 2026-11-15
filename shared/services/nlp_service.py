from __future__ import annotations

import threading


# A pipeline instance is not safe to initialize or execute concurrently. Keep
# one lock per language so requests for different languages can proceed in
# parallel while requests for the same language remain ordered.
_language_locks_guard = threading.Lock()
_language_locks: dict[str, threading.Lock] = {}


def _get_language_lock(language: str) -> threading.Lock:
    with _language_locks_guard:
        lock = _language_locks.get(language)
        if lock is None:
            lock = threading.Lock()
            _language_locks[language] = lock
        return lock


def analyze_text(text: str, language: str):
    from language_config import get_config

    with _get_language_lock(language):
        cfg = get_config(language)
        return cfg["analyze_text"](text)
