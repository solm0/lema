import math
import threading
import time
from collections import defaultdict, deque


class LemmaExampleWriteLimiter:
    """Small, process-local limiter for the single central-server deployment."""

    def __init__(self, *, limit: int = 60, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[int, deque[float]] = defaultdict(deque)
        self._guard = threading.Lock()

    def reserve(self, user_id: int) -> int:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._guard:
            events = self._events[user_id]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                return max(1, math.ceil(events[0] + self.window_seconds - now))
            events.append(now)
            return 0


lemma_example_write_limiter = LemmaExampleWriteLimiter()
