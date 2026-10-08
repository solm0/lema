import unittest

from services.password_reset_limits import PasswordResetAttemptLimiter


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += seconds


class PasswordResetAttemptLimiterTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.limiter = PasswordResetAttemptLimiter(
            ip_limit=2,
            ip_window_seconds=600,
            token_failure_limit=2,
            token_window_seconds=900,
            clock=self.clock,
        )

    def test_limits_ip_attempts(self):
        self.assertEqual(self.limiter.reserve_ip_attempt("203.0.113.1"), 0)
        self.assertEqual(self.limiter.reserve_ip_attempt("203.0.113.1"), 0)
        self.assertEqual(self.limiter.reserve_ip_attempt("203.0.113.1"), 600)

        self.clock.advance(600)
        self.assertEqual(self.limiter.reserve_ip_attempt("203.0.113.1"), 0)

    def test_limits_and_resets_token_failures(self):
        self.assertEqual(self.limiter.record_token_failure("token-hash"), 0)
        self.assertEqual(self.limiter.record_token_failure("token-hash"), 900)
        self.assertEqual(self.limiter.token_retry_after("token-hash"), 900)

        self.limiter.reset_token("token-hash")
        self.assertEqual(self.limiter.token_retry_after("token-hash"), 0)


if __name__ == "__main__":
    unittest.main()
