import os
import unittest

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("MAIL_USERNAME", "test@example.com")
os.environ.setdefault("MAIL_PASSWORD", "test-password")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from models import User, UserLemma, UserLemmaExample, UserLemmaMilestone
from routers.auth_router import create_token, hash_password
from routers.lemmas_router import router


class LemmaProfileResetTests(unittest.TestCase):
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
            name="Test User",
            email_verified=True,
        )
        other_user = User(
            email="other@example.com",
            password_hash=hash_password("correct-password"),
            name="Other User",
            email_verified=True,
        )
        db.add_all([self.user, other_user])
        db.commit()
        db.refresh(self.user)
        db.refresh(other_user)

        db.add_all([
            UserLemma(user_id=self.user.id, lemma_key="run/VERB/en"),
            UserLemmaExample(
                user_id=self.user.id,
                lemma_key="run/VERB/en",
                language="en",
                text="I run.",
                tokens_json="[]",
                match_indices_json="[]",
                content_hash="a" * 64,
            ),
            UserLemmaMilestone(user_id=self.user.id, language="en", known_count=10),
            UserLemma(user_id=other_user.id, lemma_key="keep/VERB/en"),
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

    def tearDown(self):
        self.client.close()

    def test_reset_deletes_only_the_current_users_vocabulary_records(self):
        token = create_token(self.user.id, self.user.auth_version or 0)

        response = self.client.delete(
            "/api/lemma/profile",
            headers={"Authorization": f"Bearer {token}"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

        db = self.Session()
        self.assertEqual(db.query(UserLemma).filter_by(user_id=self.user.id).count(), 0)
        self.assertEqual(db.query(UserLemmaExample).filter_by(user_id=self.user.id).count(), 0)
        self.assertEqual(db.query(UserLemmaMilestone).filter_by(user_id=self.user.id).count(), 0)
        self.assertEqual(db.query(UserLemma).filter_by(lemma_key="keep/VERB/en").count(), 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
