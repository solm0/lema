import os
import threading
from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parents[2]
root_str = str(ROOT_DIR)

if root_str not in sys.path:
    sys.path.append(root_str)

from shared.services import nlp_service as _shared_module


for _name in dir(_shared_module):
    if _name.startswith("__"):
        continue
    globals()[_name] = getattr(_shared_module, _name)


DEFAULT_LANGUAGE_QUEUE_LIMIT = 5


class AnalysisQueueFull(Exception):
    pass


class LanguageQueueLimiter:
    """Bounds the running-and-waiting work for each language independently."""

    def __init__(self, queue_limit: int):
        if queue_limit <= 0:
            raise ValueError("queue_limit must be greater than zero")

        self.queue_limit = queue_limit
        self._guard = threading.Lock()
        self._slots: dict[str, threading.BoundedSemaphore] = {}

    def _slot_for(self, language: str) -> threading.BoundedSemaphore:
        with self._guard:
            slot = self._slots.get(language)
            if slot is None:
                slot = threading.BoundedSemaphore(self.queue_limit)
                self._slots[language] = slot
            return slot

    def run(self, language: str, operation):
        slot = self._slot_for(language)
        if not slot.acquire(blocking=False):
            raise AnalysisQueueFull(f"analysis queue is full for language: {language}")

        try:
            return operation()
        finally:
            slot.release()


def _queue_limit_from_env() -> int:
    raw_value = os.getenv("ANALYZE_LANGUAGE_QUEUE_LIMIT")
    if raw_value is None:
        return DEFAULT_LANGUAGE_QUEUE_LIMIT

    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError("ANALYZE_LANGUAGE_QUEUE_LIMIT must be an integer") from exc

    if value <= 0:
        raise RuntimeError("ANALYZE_LANGUAGE_QUEUE_LIMIT must be greater than zero")
    return value


language_queue_limiter = LanguageQueueLimiter(_queue_limit_from_env())


def analyze_text(text: str, language: str):
    return language_queue_limiter.run(
        language,
        lambda: _shared_module.analyze_text(text, language),
    )


__all__ = [
    *[name for name in dir(_shared_module) if not name.startswith("__")],
    "AnalysisQueueFull",
    "LanguageQueueLimiter",
    "analyze_text",
]
