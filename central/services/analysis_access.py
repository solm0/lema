import ipaddress
import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import fcntl
from fastapi import HTTPException, Request


DEFAULT_USER_RATE_LIMIT = 20
DEFAULT_IP_RATE_LIMIT = 40
DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60
DEFAULT_LOCK_PATH = "/tmp/lema-central-analysis.lock"


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


def _trusted_proxy_ips() -> set[str]:
    raw_value = os.getenv("ANALYZE_TRUSTED_PROXY_IPS", "127.0.0.1,::1")
    return {item.strip() for item in raw_value.split(",") if item.strip()}


def _valid_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def get_client_ip(request: Request) -> str:
    peer_ip = request.client.host if request.client else "unknown"

    # Only accept a forwarded address from an explicitly trusted reverse proxy.
    # Uvicorn may already have replaced request.client with the original address;
    # in that case this branch is intentionally skipped.
    if peer_ip in _trusted_proxy_ips():
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            forwarded_ips = [
                parsed_ip
                for item in forwarded_for.split(",")
                if (parsed_ip := _valid_ip(item)) is not None
            ]
            trusted_proxies = _trusted_proxy_ips()
            for forwarded_ip in reversed(forwarded_ips):
                if forwarded_ip not in trusted_proxies:
                    return forwarded_ip

    return _valid_ip(peer_ip) or peer_ip


class AnalysisAccessRejected(Exception):
    def __init__(self, code: str, message: str, retry_after: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after = max(1, retry_after)


@dataclass
class AnalysisLease:
    controller: "AnalysisAccessController"
    token: object
    _released: bool = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        self.controller.release(self.token)


class AnalysisAccessController:
    def __init__(
        self,
        *,
        user_rate_limit: int,
        ip_rate_limit: int,
        window_seconds: int,
        lock_path: str,
        clock: Callable[[], float] = time.monotonic,
    ):
        if user_rate_limit <= 0 or ip_rate_limit <= 0 or window_seconds <= 0:
            raise ValueError("analysis access limits must be greater than zero")

        self.user_rate_limit = user_rate_limit
        self.ip_rate_limit = ip_rate_limit
        self.window_seconds = window_seconds
        self.lock_path = Path(lock_path)
        self.clock = clock
        self._guard = threading.Lock()
        self._requests: dict[str, deque[float]] = {}
        self._active_token: object | None = None
        self._active_lock_fd: int | None = None
        self._request_count = 0

    def _prune(self, key: str, now: float) -> deque[float]:
        timestamps = self._requests.setdefault(key, deque())
        cutoff = now - self.window_seconds
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()
        return timestamps

    def _sweep_stale_keys(self, now: float) -> None:
        cutoff = now - self.window_seconds
        stale_keys = [
            key
            for key, timestamps in self._requests.items()
            if not timestamps or timestamps[-1] <= cutoff
        ]
        for key in stale_keys:
            self._requests.pop(key, None)

    def _retry_after(self, timestamps: deque[float], now: float) -> int:
        return max(1, math.ceil(timestamps[0] + self.window_seconds - now))

    def _open_global_lock(self) -> int:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_CREAT | os.O_RDWR
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        return os.open(self.lock_path, flags, 0o600)

    def acquire(self, *, user_id: int, client_ip: str) -> AnalysisLease:
        now = self.clock()
        user_key = f"user:{user_id}"
        ip_key = f"ip:{client_ip}"

        with self._guard:
            self._request_count += 1
            if self._request_count % 256 == 0:
                self._sweep_stale_keys(now)

            user_requests = self._prune(user_key, now)
            ip_requests = self._prune(ip_key, now)
            retry_after = 0

            if len(user_requests) >= self.user_rate_limit:
                retry_after = max(retry_after, self._retry_after(user_requests, now))
            if len(ip_requests) >= self.ip_rate_limit:
                retry_after = max(retry_after, self._retry_after(ip_requests, now))

            if retry_after:
                raise AnalysisAccessRejected(
                    "analysis_rate_limited",
                    "too many analysis requests",
                    retry_after,
                )

            # Attempts that collide with an active analysis still count. This
            # prevents a busy endpoint from becoming an unlimited polling target.
            user_requests.append(now)
            ip_requests.append(now)

            if self._active_token is not None:
                raise AnalysisAccessRejected(
                    "analysis_busy",
                    "another analysis is already running",
                    1,
                )

            lock_fd = self._open_global_lock()
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                os.close(lock_fd)
                raise AnalysisAccessRejected(
                    "analysis_busy",
                    "another analysis is already running",
                    1,
                ) from exc

            token = object()
            self._active_token = token
            self._active_lock_fd = lock_fd
            return AnalysisLease(controller=self, token=token)

    def release(self, token: object) -> None:
        with self._guard:
            if token is not self._active_token:
                return

            lock_fd = self._active_lock_fd
            self._active_token = None
            self._active_lock_fd = None

            if lock_fd is not None:
                try:
                    fcntl.flock(lock_fd, fcntl.LOCK_UN)
                finally:
                    os.close(lock_fd)


analysis_access_controller = AnalysisAccessController(
    user_rate_limit=_positive_int_env(
        "ANALYZE_USER_RATE_LIMIT",
        DEFAULT_USER_RATE_LIMIT,
    ),
    ip_rate_limit=_positive_int_env(
        "ANALYZE_IP_RATE_LIMIT",
        DEFAULT_IP_RATE_LIMIT,
    ),
    window_seconds=_positive_int_env(
        "ANALYZE_RATE_LIMIT_WINDOW_SECONDS",
        DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    ),
    lock_path=os.getenv("ANALYZE_LOCK_PATH", DEFAULT_LOCK_PATH),
)


def acquire_analysis_lease(*, user_id: int, request: Request) -> AnalysisLease:
    try:
        return analysis_access_controller.acquire(
            user_id=user_id,
            client_ip=get_client_ip(request),
        )
    except AnalysisAccessRejected as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "code": exc.code,
                "message": exc.message,
            },
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
