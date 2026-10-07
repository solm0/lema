import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base
from services.auth_rate_limits import EmailSendLimiter, LoginAttemptLimiter


class MonotonicClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += seconds


class DateTimeClock:
    def __init__(self):
        self.now = datetime(2026, 10, 7, 12, 0, 0)

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += timedelta(seconds=seconds)


class LoginAttemptLimiterTests(unittest.TestCase):
    def setUp(self):
        self.clock = MonotonicClock()
        self.limiter = LoginAttemptLimiter(
            failure_threshold=3,
            cooldown_seconds=(10, 20),
            failure_reset_seconds=60,
            max_entries=100,
            sweep_every=2,
            clock=self.clock,
        )

    def test_starts_progressive_cooldown_at_threshold(self):
        self.assertEqual(self.limiter.record_failure("User@Example.com"), 0)
        self.assertEqual(self.limiter.record_failure("user@example.com"), 0)
        self.assertEqual(self.limiter.record_failure("user@example.com"), 10)
        self.assertEqual(self.limiter.retry_after("USER@example.com"), 10)

        self.clock.advance(10)
        self.assertEqual(self.limiter.retry_after("user@example.com"), 0)
        self.assertEqual(self.limiter.record_failure("user@example.com"), 20)

    def test_success_reset_clears_failures(self):
        for _ in range(3):
            self.limiter.record_failure("user@example.com")

        self.limiter.reset("user@example.com")

        self.assertEqual(self.limiter.retry_after("user@example.com"), 0)
        self.assertEqual(self.limiter.record_failure("user@example.com"), 0)

    def test_stale_failures_expire(self):
        for _ in range(3):
            self.limiter.record_failure("user@example.com")

        self.clock.advance(61)

        self.assertEqual(self.limiter.retry_after("user@example.com"), 0)
        self.assertEqual(self.limiter.record_failure("user@example.com"), 0)


class EmailSendLimiterTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(bind=engine)
        self.clock = DateTimeClock()
        self.limiter = EmailSendLimiter(
            minimum_interval_seconds=60,
            recipient_hourly_limit=2,
            recipient_daily_limit=3,
            global_daily_limit=4,
            clock=self.clock,
        )

    def test_enforces_minimum_recipient_interval(self):
        db = self.Session()
        try:
            first = self.limiter.reserve(
                db,
                email="User@Example.com",
                purpose="password_reset",
            )
            second = self.limiter.reserve(
                db,
                email="user@example.com",
                purpose="password_reset",
            )

            self.assertTrue(first.allowed)
            self.assertFalse(second.allowed)
            self.assertEqual(second.retry_after, 60)
        finally:
            db.close()

    def test_enforces_hourly_and_daily_recipient_limits(self):
        db = self.Session()
        try:
            self.assertTrue(self.limiter.reserve(
                db,
                email="user@example.com",
                purpose="password_reset",
            ).allowed)
            self.clock.advance(60)
            self.assertTrue(self.limiter.reserve(
                db,
                email="user@example.com",
                purpose="password_reset",
            ).allowed)
            self.clock.advance(60)

            hourly_block = self.limiter.reserve(
                db,
                email="user@example.com",
                purpose="password_reset",
            )
            self.assertFalse(hourly_block.allowed)
            self.assertEqual(hourly_block.retry_after, 60 * 60 - 120)

            self.clock.advance(60 * 60)
            self.assertTrue(self.limiter.reserve(
                db,
                email="user@example.com",
                purpose="password_reset",
            ).allowed)

            daily_block = self.limiter.reserve(
                db,
                email="user@example.com",
                purpose="password_reset",
            )
            self.assertFalse(daily_block.allowed)
        finally:
            db.close()

    def test_global_limit_is_shared_across_recipients_and_sessions(self):
        for index in range(4):
            db = self.Session()
            try:
                result = self.limiter.reserve(
                    db,
                    email=f"user{index}@example.com",
                    purpose="verify_email",
                )
                self.assertTrue(result.allowed)
            finally:
                db.close()

        db = self.Session()
        try:
            blocked = self.limiter.reserve(
                db,
                email="last@example.com",
                purpose="verify_email",
            )
            self.assertFalse(blocked.allowed)
            self.assertEqual(blocked.retry_after, 24 * 60 * 60)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
