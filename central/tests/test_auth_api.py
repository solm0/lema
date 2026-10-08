import os
import unittest
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse
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
from models import PasswordResetToken, User
from routers.auth_router import (
    create_token,
    hash_password,
    hash_reset_token,
    pwd_context,
    router,
)
from services.auth_rate_limits import EmailSendLimiter, LoginAttemptLimiter
from services.password_reset_limits import PasswordResetAttemptLimiter


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

    def make_reset_limiter(self, *, ip_limit=10, token_limit=5):
        return PasswordResetAttemptLimiter(
            ip_limit=ip_limit,
            ip_window_seconds=600,
            token_failure_limit=token_limit,
            token_window_seconds=900,
        )

    @staticmethod
    def now():
        return datetime.now(UTC).replace(tzinfo=None)

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

    def test_successful_login_upgrades_legacy_bcrypt_hash(self):
        db = self.Session()
        user = db.query(User).filter(User.email == "user@example.com").first()
        user.password_hash = pwd_context.handler("bcrypt").hash("correct-password")
        self.assertTrue(user.password_hash.startswith("$2"))
        db.commit()
        db.close()

        response = self.client.post(
            "/api/login",
            json={"email": "user@example.com", "password": "correct-password"},
        )

        self.assertEqual(response.status_code, 200)
        db = self.Session()
        upgraded = db.query(User).filter(User.email == "user@example.com").first()
        self.assertTrue(upgraded.password_hash.startswith("$argon2"))
        db.close()

    def test_signup_rejects_short_and_common_passwords_at_the_api(self):
        short = self.client.post(
            "/api/signup",
            json={
                "email": "new@example.com",
                "password": "short",
                "name": "New User",
            },
        )
        common = self.client.post(
            "/api/signup",
            json={
                "email": "new@example.com",
                "password": "password123",
                "name": "New User",
            },
        )

        self.assertEqual(short.status_code, 400)
        self.assertEqual(short.json()["detail"]["code"], "password_too_short")
        self.assertEqual(common.status_code, 400)
        self.assertEqual(common.json()["detail"]["code"], "password_compromised")

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

    def test_password_reset_hashes_token_and_revokes_existing_jwt_on_success(self):
        send_email = AsyncMock()
        limiter = self.make_reset_limiter()

        db = self.Session()
        user = db.query(User).filter(User.email == "user@example.com").first()
        old_access_token = create_token(user.id, user.auth_version or 0)
        db.close()

        with (
            patch("routers.auth_router.send_email", send_email),
            patch("routers.auth_router.password_reset_attempt_limiter", limiter),
        ):
            requested = self.client.post(
                "/api/request-password-reset",
                json={"email": "user@example.com"},
            )

            self.assertEqual(requested.status_code, 202)
            reset_link = send_email.await_args.args[1]
            raw_token = parse_qs(urlparse(reset_link).query)["token"][0]

            db = self.Session()
            token_record = db.query(PasswordResetToken).one()
            self.assertEqual(token_record.token_hash, hash_reset_token(raw_token))
            self.assertNotEqual(token_record.token_hash, raw_token)
            self.assertIsNotNone(token_record.delivered_at)
            db.close()

            before_reset = self.client.get(
                "/api/me",
                headers={"Authorization": f"Bearer {old_access_token}"},
            )
            self.assertEqual(before_reset.status_code, 200)

            with patch(
                "routers.auth_router.validate_new_password",
                AsyncMock(return_value="new-password-123"),
            ):
                reset = self.client.post(
                    "/api/reset-password",
                    json={
                        "token": raw_token,
                        "new_password": "new-password-123",
                    },
                )

            self.assertEqual(reset.status_code, 200)

            reused = self.client.post(
                "/api/reset-password",
                json={
                    "token": raw_token,
                    "new_password": "another-password-123",
                },
            )
            self.assertEqual(reused.status_code, 400)
            self.assertEqual(reused.json()["detail"]["code"], "invalid_token")

        old_session = self.client.get(
            "/api/me",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        self.assertEqual(old_session.status_code, 401)

        new_login = self.client.post(
            "/api/login",
            json={"email": "user@example.com", "password": "new-password-123"},
        )
        self.assertEqual(new_login.status_code, 200)

    def test_failed_reset_email_removes_only_the_new_pending_token(self):
        db = self.Session()
        user = db.query(User).filter(User.email == "user@example.com").first()
        previous = PasswordResetToken(
            user_id=user.id,
            token_hash=hash_reset_token("previous-token"),
            created_at=self.now(),
            expires_at=self.now() + timedelta(minutes=30),
            delivered_at=self.now(),
        )
        db.add(previous)
        db.commit()
        previous_id = previous.id
        db.close()

        with self.assertLogs("routers.auth_router", level="ERROR"):
            with patch(
                "routers.auth_router.send_email",
                AsyncMock(side_effect=RuntimeError("smtp unavailable")),
            ):
                response = self.client.post(
                    "/api/request-password-reset",
                    json={"email": "user@example.com"},
                )

        self.assertEqual(response.status_code, 202)
        db = self.Session()
        remaining = db.query(PasswordResetToken).all()
        self.assertEqual([token.id for token in remaining], [previous_id])
        self.assertIsNone(remaining[0].revoked_at)
        db.close()

    def test_expired_reset_token_is_rejected(self):
        db = self.Session()
        user = db.query(User).filter(User.email == "user@example.com").first()
        raw_token = "expired-token"
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_reset_token(raw_token),
            created_at=self.now() - timedelta(hours=1),
            expires_at=self.now() - timedelta(minutes=30),
            delivered_at=self.now() - timedelta(hours=1),
        ))
        db.commit()
        db.close()

        with patch(
            "routers.auth_router.password_reset_attempt_limiter",
            self.make_reset_limiter(),
        ):
            response = self.client.post(
                "/api/reset-password",
                json={"token": raw_token, "new_password": "new-password-123"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "invalid_token")

    def test_reset_token_failures_are_rate_limited(self):
        limiter = self.make_reset_limiter(token_limit=2)
        with patch("routers.auth_router.password_reset_attempt_limiter", limiter):
            first = self.client.post(
                "/api/reset-password",
                json={"token": "invalid", "new_password": "new-password-123"},
            )
            blocked = self.client.post(
                "/api/reset-password",
                json={"token": "invalid", "new_password": "new-password-123"},
            )

        self.assertEqual(first.status_code, 400)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(
            blocked.json()["detail"]["code"],
            "password_reset_rate_limited",
        )
        self.assertIn("Retry-After", blocked.headers)


if __name__ == "__main__":
    unittest.main()
