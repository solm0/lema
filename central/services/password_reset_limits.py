import math
import os
import threading
import time
from collections import deque
from typing import Callable


def _positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


class PasswordResetAttemptLimiter:
    def __init__(
        self,
        *,
        ip_limit: int,
        ip_window_seconds: int,
        token_failure_limit: int,
        token_window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ):
        if min(ip_limit, ip_window_seconds, token_failure_limit, token_window_seconds) <= 0:
            raise ValueError("password reset limits must be greater than zero")
        self.ip_limit = ip_limit
        self.ip_window_seconds = ip_window_seconds
        self.token_failure_limit = token_failure_limit
        self.token_window_seconds = token_window_seconds
        self.clock = clock
        self._guard = threading.Lock()
        self._attempts: dict[str, deque[float]] = {}
        self._operation_count = 0

    def _prune(self, key: str, now: float, window_seconds: int) -> deque[float]:
        attempts = self._attempts.setdefault(key, deque())
        cutoff = now - window_seconds
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        return attempts

    @staticmethod
    def _retry_after(attempts: deque[float], now: float, window_seconds: int) -> int:
        return max(1, math.ceil(attempts[0] + window_seconds - now))

    def _maintain(self, now: float) -> None:
        self._operation_count += 1
        if self._operation_count % 256:
            return
        stale = []
        for key, values in self._attempts.items():
            window_seconds = (
                self.ip_window_seconds
                if key.startswith("ip:")
                else self.token_window_seconds
            )
            if not values or values[-1] <= now - window_seconds:
                stale.append(key)
        for key in stale:
            self._attempts.pop(key, None)

    def reserve_ip_attempt(self, client_ip: str) -> int:
        now = self.clock()
        key = f"ip:{client_ip}"
        with self._guard:
            attempts = self._prune(key, now, self.ip_window_seconds)
            if len(attempts) >= self.ip_limit:
                return self._retry_after(attempts, now, self.ip_window_seconds)
            attempts.append(now)
            self._maintain(now)
            return 0

    def token_retry_after(self, token_hash: str) -> int:
        now = self.clock()
        key = f"token:{token_hash}"
        with self._guard:
            attempts = self._prune(key, now, self.token_window_seconds)
            if len(attempts) >= self.token_failure_limit:
                return self._retry_after(attempts, now, self.token_window_seconds)
            self._maintain(now)
            return 0

    def record_token_failure(self, token_hash: str) -> int:
        now = self.clock()
        key = f"token:{token_hash}"
        with self._guard:
            attempts = self._prune(key, now, self.token_window_seconds)
            attempts.append(now)
            self._maintain(now)
            if len(attempts) >= self.token_failure_limit:
                return self._retry_after(attempts, now, self.token_window_seconds)
            return 0

    def reset_token(self, token_hash: str) -> None:
        with self._guard:
            self._attempts.pop(f"token:{token_hash}", None)


password_reset_attempt_limiter = PasswordResetAttemptLimiter(
    ip_limit=_positive_int_env("AUTH_RESET_IP_LIMIT", 10),
    ip_window_seconds=_positive_int_env("AUTH_RESET_IP_WINDOW_SECONDS", 10 * 60),
    token_failure_limit=_positive_int_env("AUTH_RESET_TOKEN_FAILURE_LIMIT", 5),
    token_window_seconds=_positive_int_env("AUTH_RESET_TOKEN_WINDOW_SECONDS", 15 * 60),
)
