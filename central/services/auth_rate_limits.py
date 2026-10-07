import hashlib
import math
import os
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Callable, Sequence

from sqlalchemy.orm import Session

from models import EmailSendEvent


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


def _positive_int_list_env(name: str, default: Sequence[int]) -> tuple[int, ...]:
    raw_value = os.getenv(name)
    if raw_value is None:
        return tuple(default)

    try:
        values = tuple(int(item.strip()) for item in raw_value.split(","))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a comma-separated list of integers") from exc

    if not values or any(value <= 0 for value in values):
        raise RuntimeError(f"{name} values must be greater than zero")
    return values


def normalize_email(email: str) -> str:
    return email.strip().lower()


def email_rate_limit_key(email: str) -> str:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


@dataclass
class _LoginAttemptState:
    failure_count: int
    last_failure: float
    blocked_until: float
    last_seen: float


class LoginAttemptLimiter:
    def __init__(
        self,
        *,
        failure_threshold: int,
        cooldown_seconds: Sequence[int],
        failure_reset_seconds: int,
        max_entries: int,
        sweep_every: int = 256,
        clock: Callable[[], float] = time.monotonic,
    ):
        if (
            failure_threshold <= 0
            or not cooldown_seconds
            or any(value <= 0 for value in cooldown_seconds)
            or failure_reset_seconds <= 0
            or max_entries <= 0
            or sweep_every <= 0
        ):
            raise ValueError("login limiter values must be greater than zero")

        self.failure_threshold = failure_threshold
        self.cooldown_seconds = tuple(cooldown_seconds)
        self.failure_reset_seconds = failure_reset_seconds
        self.max_entries = max_entries
        self.sweep_every = sweep_every
        self.clock = clock
        self._guard = threading.Lock()
        self._attempts: dict[str, _LoginAttemptState] = {}
        self._operation_count = 0

    def _key(self, email: str) -> str:
        return email_rate_limit_key(email)

    def _is_stale(self, state: _LoginAttemptState, now: float) -> bool:
        return (
            now - state.last_failure >= self.failure_reset_seconds
            and state.blocked_until <= now
        )

    def _sweep(self, now: float) -> None:
        stale_keys = [
            key
            for key, state in self._attempts.items()
            if self._is_stale(state, now)
        ]
        for key in stale_keys:
            self._attempts.pop(key, None)

        overflow = len(self._attempts) - self.max_entries
        if overflow > 0:
            oldest_keys = sorted(
                self._attempts,
                key=lambda key: self._attempts[key].last_seen,
            )[:overflow]
            for key in oldest_keys:
                self._attempts.pop(key, None)

    def _maintain(self, now: float) -> None:
        self._operation_count += 1
        if (
            self._operation_count % self.sweep_every == 0
            or len(self._attempts) > self.max_entries
        ):
            self._sweep(now)

    def retry_after(self, email: str) -> int:
        now = self.clock()
        key = self._key(email)

        with self._guard:
            state = self._attempts.get(key)
            if state is None:
                self._maintain(now)
                return 0

            if self._is_stale(state, now):
                self._attempts.pop(key, None)
                self._maintain(now)
                return 0

            state.last_seen = now
            self._maintain(now)
            return max(0, math.ceil(state.blocked_until - now))

    def record_failure(self, email: str) -> int:
        now = self.clock()
        key = self._key(email)

        with self._guard:
            state = self._attempts.get(key)
            if state is None or self._is_stale(state, now):
                state = _LoginAttemptState(
                    failure_count=0,
                    last_failure=now,
                    blocked_until=0,
                    last_seen=now,
                )
                self._attempts[key] = state

            state.failure_count += 1
            state.last_failure = now
            state.last_seen = now

            retry_after = 0
            if state.failure_count >= self.failure_threshold:
                cooldown_index = min(
                    state.failure_count - self.failure_threshold,
                    len(self.cooldown_seconds) - 1,
                )
                state.blocked_until = now + self.cooldown_seconds[cooldown_index]
                retry_after = math.ceil(state.blocked_until - now)

            self._maintain(now)
            return retry_after

    def reset(self, email: str) -> None:
        now = self.clock()
        with self._guard:
            self._attempts.pop(self._key(email), None)
            self._maintain(now)


@dataclass(frozen=True)
class EmailSendReservation:
    allowed: bool
    retry_after: int = 0
    event_id: int | None = None


class EmailSendLimiter:
    def __init__(
        self,
        *,
        minimum_interval_seconds: int,
        recipient_hourly_limit: int,
        recipient_daily_limit: int,
        global_daily_limit: int,
        clock: Callable[[], datetime] | None = None,
    ):
        if (
            minimum_interval_seconds <= 0
            or recipient_hourly_limit <= 0
            or recipient_daily_limit <= 0
            or global_daily_limit <= 0
        ):
            raise ValueError("email limiter values must be greater than zero")

        self.minimum_interval_seconds = minimum_interval_seconds
        self.recipient_hourly_limit = recipient_hourly_limit
        self.recipient_daily_limit = recipient_daily_limit
        self.global_daily_limit = global_daily_limit
        self.clock = clock or (lambda: datetime.now(UTC).replace(tzinfo=None))
        self._guard = threading.Lock()

    @staticmethod
    def _retry_after(events: list[datetime], limit: int, window_seconds: int, now: datetime) -> int:
        if len(events) < limit:
            return 0
        relevant_event = events[-limit]
        available_at = relevant_event + timedelta(seconds=window_seconds)
        return max(1, math.ceil((available_at - now).total_seconds()))

    def reserve(self, db: Session, *, email: str, purpose: str) -> EmailSendReservation:
        now = self.clock()
        minute_cutoff = now - timedelta(seconds=self.minimum_interval_seconds)
        hour_cutoff = now - timedelta(hours=1)
        day_cutoff = now - timedelta(hours=24)
        recipient_key = email_rate_limit_key(email)

        with self._guard:
            db.query(EmailSendEvent).filter(
                EmailSendEvent.sent_at <= day_cutoff,
            ).delete(synchronize_session=False)

            recipient_events = [
                row[0]
                for row in db.query(EmailSendEvent.sent_at)
                .filter(
                    EmailSendEvent.recipient_hash == recipient_key,
                    EmailSendEvent.sent_at > day_cutoff,
                )
                .order_by(EmailSendEvent.sent_at.asc())
                .all()
            ]
            global_events = [
                row[0]
                for row in db.query(EmailSendEvent.sent_at)
                .filter(EmailSendEvent.sent_at > day_cutoff)
                .order_by(EmailSendEvent.sent_at.asc())
                .all()
            ]

            recent_minute = [event for event in recipient_events if event > minute_cutoff]
            recent_hour = [event for event in recipient_events if event > hour_cutoff]
            retry_after = max(
                self._retry_after(
                    recent_minute,
                    1,
                    self.minimum_interval_seconds,
                    now,
                ),
                self._retry_after(
                    recent_hour,
                    self.recipient_hourly_limit,
                    60 * 60,
                    now,
                ),
                self._retry_after(
                    recipient_events,
                    self.recipient_daily_limit,
                    24 * 60 * 60,
                    now,
                ),
                self._retry_after(
                    global_events,
                    self.global_daily_limit,
                    24 * 60 * 60,
                    now,
                ),
            )

            if retry_after:
                db.commit()
                return EmailSendReservation(False, retry_after=retry_after)

            event = EmailSendEvent(
                recipient_hash=recipient_key,
                purpose=purpose,
                sent_at=now,
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            return EmailSendReservation(True, event_id=event.id)


login_attempt_limiter = LoginAttemptLimiter(
    failure_threshold=_positive_int_env("AUTH_LOGIN_FAILURE_THRESHOLD", 5),
    cooldown_seconds=_positive_int_list_env(
        "AUTH_LOGIN_COOLDOWNS_SECONDS",
        (30, 60, 120, 300),
    ),
    failure_reset_seconds=_positive_int_env(
        "AUTH_LOGIN_FAILURE_RESET_SECONDS",
        15 * 60,
    ),
    max_entries=_positive_int_env("AUTH_LOGIN_MAX_TRACKED_EMAILS", 50_000),
)

email_send_limiter = EmailSendLimiter(
    minimum_interval_seconds=_positive_int_env("AUTH_EMAIL_MIN_INTERVAL_SECONDS", 60),
    recipient_hourly_limit=_positive_int_env("AUTH_EMAIL_RECIPIENT_HOURLY_LIMIT", 5),
    recipient_daily_limit=_positive_int_env("AUTH_EMAIL_RECIPIENT_DAILY_LIMIT", 10),
    global_daily_limit=_positive_int_env("AUTH_EMAIL_GLOBAL_DAILY_LIMIT", 400),
)
