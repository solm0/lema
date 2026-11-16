import os
import unittest
from datetime import datetime, timedelta

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("MAIL_USERNAME", "test@example.com")
os.environ.setdefault("MAIL_PASSWORD", "test-password")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from models import User, UserLemma, UserRecapResult
from routers.auth_router import create_token, hash_password
from routers.lemmas_router import router


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

    def test_legacy_server_managed_recap_routes_are_removed(self):
        requests = [
            ("get", "/api/lemma/recap"),
            ("post", "/api/lemma/recap/showcase/reroll"),
            ("post", "/api/lemma/recap/session/reset"),
            ("post", "/api/lemma/recap/session"),
            ("put", "/api/lemma/recap/items/1/question"),
            ("post", "/api/lemma/recap/items/1/answer"),
        ]
        for method, path in requests:
            response = getattr(self.client, method)(path, headers=self.headers)
            self.assertEqual(response.status_code, 404, path)

    def test_device_result_is_idempotent_and_updates_lemma_state(self):
        payload = {
            "event_id": "device-event-1",
            "lemma_key": "word0/NOUN/en",
            "result": "passed",
            "answered_at": "2026-11-16T10:00:00.000Z",
        }
        recorded = self.client.post(
            "/api/lemma/recap/results",
            headers=self.headers,
            json=payload,
        )
        self.assertEqual(recorded.status_code, 200)
        self.assertFalse(recorded.json()["duplicate"])
        self.assertIsNotNone(recorded.json()["last_recap_succeeded_at"])
        self.assertEqual(recorded.json()["decay"], 0)

        duplicate = self.client.post(
            "/api/lemma/recap/results",
            headers=self.headers,
            json=payload,
        )
        self.assertEqual(duplicate.status_code, 200)
        self.assertTrue(duplicate.json()["duplicate"])

        db = self.Session()
        self.assertEqual(
            db.query(UserRecapResult).filter_by(
                user_id=self.user_id,
                event_id=payload["event_id"],
            ).count(),
            1,
        )
        db.close()


if __name__ == "__main__":
    unittest.main()
