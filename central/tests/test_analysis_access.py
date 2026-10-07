import os
import unittest
from unittest.mock import patch

from starlette.requests import Request

from services.analysis_access import (
    AnalysisAccessController,
    AnalysisAccessRejected,
    get_client_ip,
)


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += seconds


class AnalysisAccessControllerTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def make_controller(
        self,
        *,
        user_limit=2,
        ip_limit=2,
        user_concurrent_limit=1,
        ip_concurrent_limit=5,
        window=60,
    ):
        return AnalysisAccessController(
            user_rate_limit=user_limit,
            ip_rate_limit=ip_limit,
            window_seconds=window,
            user_concurrent_limit=user_concurrent_limit,
            ip_concurrent_limit=ip_concurrent_limit,
            clock=self.clock,
        )

    def acquire_and_release(self, controller, *, user_id, client_ip):
        lease = controller.acquire(user_id=user_id, client_ip=client_ip)
        lease.release()

    def test_limits_requests_by_user_across_ips(self):
        controller = self.make_controller(user_limit=2, ip_limit=10)
        self.acquire_and_release(controller, user_id=1, client_ip="192.0.2.1")
        self.acquire_and_release(controller, user_id=1, client_ip="192.0.2.2")

        with self.assertRaises(AnalysisAccessRejected) as raised:
            controller.acquire(user_id=1, client_ip="192.0.2.3")

        self.assertEqual(raised.exception.code, "analysis_rate_limited")
        self.assertEqual(raised.exception.retry_after, 60)

    def test_limits_requests_by_ip_across_users(self):
        controller = self.make_controller(user_limit=10, ip_limit=2)
        self.acquire_and_release(controller, user_id=1, client_ip="192.0.2.1")
        self.acquire_and_release(controller, user_id=2, client_ip="192.0.2.1")

        with self.assertRaises(AnalysisAccessRejected) as raised:
            controller.acquire(user_id=3, client_ip="192.0.2.1")

        self.assertEqual(raised.exception.code, "analysis_rate_limited")

    def test_allows_requests_again_after_window(self):
        controller = self.make_controller(user_limit=1, ip_limit=1)
        self.acquire_and_release(controller, user_id=1, client_ip="192.0.2.1")
        self.clock.advance(60)

        self.acquire_and_release(controller, user_id=1, client_ip="192.0.2.1")

    def test_rejects_a_second_concurrent_analysis_for_the_same_user(self):
        controller = self.make_controller(user_limit=10, ip_limit=10)
        first_lease = controller.acquire(user_id=1, client_ip="192.0.2.1")

        with self.assertRaises(AnalysisAccessRejected) as raised:
            controller.acquire(user_id=1, client_ip="192.0.2.2")

        self.assertEqual(raised.exception.code, "analysis_busy")
        first_lease.release()

        second_lease = controller.acquire(user_id=1, client_ip="192.0.2.2")
        second_lease.release()

    def test_allows_different_users_to_run_concurrently(self):
        controller = self.make_controller(user_limit=10, ip_limit=10)
        first_lease = controller.acquire(user_id=1, client_ip="192.0.2.1")
        second_lease = controller.acquire(user_id=2, client_ip="192.0.2.2")

        first_lease.release()
        second_lease.release()

    def test_rejects_the_sixth_concurrent_user_from_one_ip(self):
        controller = self.make_controller(user_limit=10, ip_limit=20)
        leases = [
            controller.acquire(user_id=user_id, client_ip="192.0.2.1")
            for user_id in range(1, 6)
        ]
        with self.assertRaises(AnalysisAccessRejected) as raised:
            controller.acquire(user_id=6, client_ip="192.0.2.1")

        self.assertEqual(raised.exception.code, "analysis_busy")
        for lease in leases:
            lease.release()

    def test_release_is_idempotent(self):
        controller = self.make_controller(user_limit=10, ip_limit=10)
        lease = controller.acquire(user_id=1, client_ip="192.0.2.1")

        lease.release()
        lease.release()

        next_lease = controller.acquire(user_id=2, client_ip="192.0.2.2")
        next_lease.release()


class ClientIpTests(unittest.TestCase):
    def make_request(self, *, peer_ip, forwarded_for):
        headers = []
        if forwarded_for is not None:
            headers.append((b"x-forwarded-for", forwarded_for.encode("ascii")))
        return Request({
            "type": "http",
            "method": "POST",
            "path": "/api/mobile/analyze",
            "headers": headers,
            "client": (peer_ip, 12345),
        })

    def test_ignores_forwarded_header_from_untrusted_peer(self):
        request = self.make_request(
            peer_ip="203.0.113.10",
            forwarded_for="192.0.2.99",
        )

        self.assertEqual(get_client_ip(request), "203.0.113.10")

    def test_uses_rightmost_untrusted_ip_from_trusted_proxy(self):
        request = self.make_request(
            peer_ip="127.0.0.1",
            forwarded_for="192.0.2.99, 198.51.100.25",
        )

        with patch.dict(
            os.environ,
            {"ANALYZE_TRUSTED_PROXY_IPS": "127.0.0.1"},
        ):
            self.assertEqual(get_client_ip(request), "198.51.100.25")


if __name__ == "__main__":
    unittest.main()
