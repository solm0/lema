import threading
import unittest

from services.nlp_service import AnalysisQueueFull, LanguageQueueLimiter


class LanguageQueueLimiterTests(unittest.TestCase):
    def test_rejects_work_above_a_language_capacity(self):
        limiter = LanguageQueueLimiter(queue_limit=1)
        started = threading.Event()
        release = threading.Event()

        def hold_slot():
            return limiter.run("ko", lambda: (started.set(), release.wait()))

        worker = threading.Thread(target=hold_slot)
        worker.start()
        self.assertTrue(started.wait(timeout=1))

        with self.assertRaises(AnalysisQueueFull):
            limiter.run("ko", lambda: None)

        release.set()
        worker.join(timeout=1)
        self.assertFalse(worker.is_alive())

    def test_languages_have_independent_capacity(self):
        limiter = LanguageQueueLimiter(queue_limit=1)
        started = threading.Event()
        release = threading.Event()

        worker = threading.Thread(
            target=lambda: limiter.run("ko", lambda: (started.set(), release.wait())),
        )
        worker.start()
        self.assertTrue(started.wait(timeout=1))

        self.assertEqual(limiter.run("ja", lambda: "available"), "available")

        release.set()
        worker.join(timeout=1)
        self.assertFalse(worker.is_alive())


if __name__ == "__main__":
    unittest.main()
