import os
import unittest
from datetime import date, datetime, timedelta
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("MAIL_USERNAME", "test@example.com")
os.environ.setdefault("MAIL_PASSWORD", "test-password")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from models import User, UserLemma
from routers.auth_router import create_token, hash_password
from routers.lemmas_router import _decay, router


class RecapApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(bind=engine)
        db = self.Session()
        self.user = User(
            email="user@example.com",
            password_hash=hash_password("correct-password"),
            email_verified=True,
        )
        db.add(self.user)
        db.commit()
        db.refresh(self.user)
        self.user_id = self.user.id
        old = datetime.utcnow() - timedelta(days=370)
        db.add_all([
            UserLemma(
                user_id=self.user_id,
                lemma_key=f"word{index}/NOUN/en",
                is_known=True,
                created_at=old - timedelta(days=index),
                updated_at=old - timedelta(days=index),
            )
            for index in range(10)
        ])
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
        self.headers = {"Authorization": f"Bearer {create_token(self.user_id, 0)}"}

    def tearDown(self):
        self.client.close()

    def _question(self, answer_key):
        return {
            "answer_key": answer_key,
            "primary_example": {"text": "A local pack sentence."},
            "options": [
                {"key": answer_key, "label": answer_key},
                {"key": "wrong-a/NOUN/en", "label": "wrong a"},
                {"key": "wrong-b/NOUN/en", "label": "wrong b"},
                {"key": "wrong-c/NOUN/en", "label": "wrong c"},
            ],
        }

    def test_weekly_showcase_becomes_two_attempt_test_and_enforces_daily_limit(self):
        first_week = date(2026, 10, 26)
        with patch("routers.lemmas_router._recap_day", return_value=first_week):
            warmup = self.client.get("/api/lemma/recap", headers=self.headers)
        self.assertEqual(warmup.status_code, 200)
        self.assertFalse(warmup.json()["available"])
        self.assertEqual(len(warmup.json()["showcase_items"]), 8)

        with patch("routers.lemmas_router._recap_day", return_value=date(2026, 11, 2)):
            recap = self.client.get("/api/lemma/recap", headers=self.headers)
            self.assertTrue(recap.json()["available"])
            self.assertEqual(len(recap.json()["test_items"]), 8)

            session = self.client.post("/api/lemma/recap/session", headers=self.headers)
            self.assertEqual(session.status_code, 200)
            items = session.json()["items"]
            self.assertEqual(len(items), 2)

            first_id = items[0]["id"]
            first_key = items[0]["lemma_key"]
            frozen = self.client.put(
                f"/api/lemma/recap/items/{first_id}/question",
                headers=self.headers,
                json={"question": self._question(first_key)},
            )
            self.assertEqual(frozen.status_code, 200)
            self.assertNotIn("answer_key", frozen.json()["question"])

            retry = self.client.post(
                f"/api/lemma/recap/items/{first_id}/answer",
                headers=self.headers,
                json={"choice_key": "wrong-a/NOUN/en"},
            )
            self.assertTrue(retry.json()["retry_available"])
            failed = self.client.post(
                f"/api/lemma/recap/items/{first_id}/answer",
                headers=self.headers,
                json={"choice_key": "wrong-b/NOUN/en"},
            )
            self.assertEqual(failed.json()["status"], "failed")

            second_id = items[1]["id"]
            second_key = items[1]["lemma_key"]
            self.client.put(
                f"/api/lemma/recap/items/{second_id}/question",
                headers=self.headers,
                json={"question": self._question(second_key)},
            )
            passed = self.client.post(
                f"/api/lemma/recap/items/{second_id}/answer",
                headers=self.headers,
                json={"choice_key": second_key},
            )
            self.assertEqual(passed.json()["status"], "passed")

            daily_limit = self.client.post("/api/lemma/recap/session", headers=self.headers)
            self.assertEqual(daily_limit.status_code, 409)

        db = self.Session()
        failed_lemma = db.query(UserLemma).filter_by(user_id=self.user_id, lemma_key=first_key).one()
        passed_lemma = db.query(UserLemma).filter_by(user_id=self.user_id, lemma_key=second_key).one()
        self.assertIsNotNone(failed_lemma.last_recap_failed_at)
        self.assertEqual(_decay(passed_lemma), 0)
        db.close()


if __name__ == "__main__":
    unittest.main()
