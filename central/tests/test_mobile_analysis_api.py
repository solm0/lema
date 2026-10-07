import os
import unittest
from unittest.mock import patch


os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("MAIL_USERNAME", "test@example.com")
os.environ.setdefault("MAIL_PASSWORD", "test-password")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db import get_db
from models import User
from routers.auth_router import create_token
from routers.mobile_router import router
from services.analysis_access import AnalysisAccessController
from services.nlp_service import AnalysisQueueFull


class FakeQuery:
    def __init__(self, user):
        self.user = user

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.user


class FakeDb:
    def __init__(self, user):
        self.user = user

    def query(self, _model):
        return FakeQuery(self.user)


class MobileAnalysisApiTests(unittest.TestCase):
    def setUp(self):
        self.user = User(id=7, email="test@example.com", name="Test")
        self.app = FastAPI()
        self.app.include_router(router)

        def override_db():
            yield FakeDb(self.user)

        self.app.dependency_overrides[get_db] = override_db
        self.client = TestClient(self.app)
        self.token = create_token(self.user.id)

    def tearDown(self):
        self.client.close()
    def make_controller(self, *, user_limit=20, ip_limit=40):
        return AnalysisAccessController(
            user_rate_limit=user_limit,
            ip_rate_limit=ip_limit,
            window_seconds=60,
            user_concurrent_limit=1,
            ip_concurrent_limit=5,
        )

    def post_analysis(self, *, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post(
            "/api/mobile/analyze",
            headers=headers,
            json={
                "blocks": [{"text": "Hello."}],
                "language": "en",
            },
        )

    def test_requires_a_bearer_token(self):
        with patch("routers.mobile_router.analyze_text") as analyze_text:
            response = self.post_analysis()

        self.assertEqual(response.status_code, 401)
        analyze_text.assert_not_called()

    def test_mobile_lookup_also_requires_a_bearer_token(self):
        response = self.client.post(
            "/api/mobile/lookup",
            json={"lemma": "hello", "pos": "INTJ", "language": "en"},
        )

        self.assertEqual(response.status_code, 401)

    def test_authenticated_request_runs_analysis(self):
        controller = self.make_controller()
        with (
            patch(
                "services.analysis_access.analysis_access_controller",
                controller,
            ),
            patch(
                "routers.mobile_router.analyze_text",
                return_value=[{
                    "surface": "Hello",
                    "lemma": "hello",
                    "pos": "INTJ",
                }],
            ) as analyze_text,
        ):
            response = self.post_analysis(token=self.token)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["blocks"][0]["tokens"][0]["lemma"], "hello")
        analyze_text.assert_called_once_with("Hello.", "en")

    def test_returns_429_after_user_rate_limit(self):
        controller = self.make_controller(user_limit=1)
        with (
            patch(
                "services.analysis_access.analysis_access_controller",
                controller,
            ),
            patch("routers.mobile_router.analyze_text", return_value=[]),
        ):
            first_response = self.post_analysis(token=self.token)
            limited_response = self.post_analysis(token=self.token)

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(limited_response.status_code, 429)
        self.assertEqual(
            limited_response.json()["detail"]["code"],
            "analysis_rate_limited",
        )
        self.assertEqual(limited_response.headers["retry-after"], "60")

    def test_returns_429_when_the_language_queue_is_full(self):
        controller = self.make_controller()
        with (
            patch(
                "services.analysis_access.analysis_access_controller",
                controller,
            ),
            patch(
                "routers.mobile_router.analyze_text",
                side_effect=AnalysisQueueFull(),
            ),
        ):
            response = self.post_analysis(token=self.token)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"]["code"], "analysis_queue_full")
        self.assertEqual(response.headers["retry-after"], "5")


if __name__ == "__main__":
    unittest.main()
