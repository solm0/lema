import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.landing_lookup_router import router


class LandingLookupApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_lookup_reads_only_the_fixed_english_pack(self):
        with (
            patch("routers.landing_lookup_router.lemma_service.has_key", return_value=True) as has_key,
            patch("routers.landing_lookup_router.lemma_service.get_line_ids", return_value=["line-1"]),
            patch("routers.landing_lookup_router.lemma_service.sample_kwic", return_value=[{"line_id": "line-1"}]),
            patch("routers.landing_lookup_router.lemma_service.get_furigana", return_value=None),
        ):
            response = self.client.post(
                "/api/landing/lookup",
                json={"lemma": "run", "pos": "VERB"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["global_key"], "run/VERB/en")
        self.assertTrue(response.json()["found"])
        has_key.assert_called_once_with("run_VERB", "en")

    def test_batch_keeps_missing_lemmas_in_the_response(self):
        with patch("routers.landing_lookup_router.lemma_service.has_key", return_value=False) as has_key:
            response = self.client.post(
                "/api/landing/lookup_batch",
                json={"items": [{"lemma": "missing", "pos": "NOUN"}]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["missing_NOUN"]["found"])
        has_key.assert_called_once_with("missing_NOUN", "en")
