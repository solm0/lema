import os
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("MAIL_USERNAME", "test@example.com")
os.environ.setdefault("MAIL_PASSWORD", "test-password")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from models import User
from routers.auth_router import hash_password, router
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


class AuthApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(bind=engine)
        db = self.Session()
        db.add(User(
            email="user@example.com",
            password_hash=hash_password("correct-password"),
            name="Test User",
            email_verified=True,
        ))
        db.commit()
        db.close()

        self.app = FastAPI()
        self.app.include_router(router)

        def override_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        self.app.dependency_overrides[get_db] = override_db
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()

    def test_login_cooldown_returns_retry_after_and_resets_after_success(self):
        clock = MonotonicClock()
        limiter = LoginAttemptLimiter(
            failure_threshold=3,
            cooldown_seconds=(10, 20),
            failure_reset_seconds=60,
            max_entries=100,
            clock=clock,
        )

        with patch("routers.auth_router.login_attempt_limiter", limiter):
            for _ in range(2):
                response = self.client.post(
                    "/api/login",
                    json={"email": "USER@example.com", "password": "wrong"},
                )
                self.assertEqual(response.status_code, 400)

            blocked = self.client.post(
                "/api/login",
                json={"email": "user@example.com", "password": "wrong"},
            )
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers["Retry-After"], "10")
            self.assertEqual(blocked.json()["detail"]["code"], "login_rate_limited")

            still_blocked = self.client.post(
                "/api/login",
                json={"email": "user@example.com", "password": "correct-password"},
            )
            self.assertEqual(still_blocked.status_code, 429)

            clock.advance(10)
            success = self.client.post(
                "/api/login",
                json={"email": "user@example.com", "password": "correct-password"},
            )
            self.assertEqual(success.status_code, 200)
            self.assertIn("access_token", success.json())
            self.assertEqual(limiter.retry_after("user@example.com"), 0)

    def test_reset_request_keeps_same_response_when_email_is_suppressed(self):
        clock = DateTimeClock()
        limiter = EmailSendLimiter(
            minimum_interval_seconds=60,
            recipient_hourly_limit=5,
            recipient_daily_limit=10,
            global_daily_limit=400,
            clock=clock,
        )
        send_email = AsyncMock()

        with (
            patch("routers.auth_router.email_send_limiter", limiter),
            patch("routers.auth_router.send_email", send_email),
        ):
            first = self.client.post(
                "/api/request-password-reset",
                json={"email": "user@example.com"},
            )
            suppressed = self.client.post(
                "/api/request-password-reset",
                json={"email": "user@example.com"},
            )
            unknown = self.client.post(
                "/api/request-password-reset",
                json={"email": "unknown@example.com"},
            )

        self.assertEqual(first.status_code, 202)
        self.assertEqual(suppressed.status_code, 202)
        self.assertEqual(unknown.status_code, 202)
        self.assertEqual(first.json(), suppressed.json())
        self.assertEqual(first.json(), unknown.json())
        send_email.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
