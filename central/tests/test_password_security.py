import unittest
from unittest.mock import AsyncMock, patch

from services.password_security import (
    PasswordPolicyError,
    validate_new_password,
    validate_password_locally,
)


class PasswordSecurityTests(unittest.IsolatedAsyncioTestCase):
    def test_enforces_length_without_trimming_spaces(self):
        with self.assertRaises(PasswordPolicyError) as short_error:
            validate_password_locally("1234567")
        self.assertEqual(short_error.exception.code, "password_too_short")

        password = "  long password  "
        self.assertEqual(validate_password_locally(password), password)

        with self.assertRaises(PasswordPolicyError) as long_error:
            validate_password_locally("a" * 129)
        self.assertEqual(long_error.exception.code, "password_too_long")

    def test_rejects_local_common_password(self):
        with self.assertRaises(PasswordPolicyError) as error:
            validate_password_locally("password123")
        self.assertEqual(error.exception.code, "password_compromised")

    async def test_rejects_password_reported_by_pwned_passwords(self):
        with patch(
            "services.password_security.is_pwned_password",
            AsyncMock(return_value=True),
        ):
            with self.assertRaises(PasswordPolicyError) as error:
                await validate_new_password("unique-password-value")
        self.assertEqual(error.exception.code, "password_compromised")


if __name__ == "__main__":
    unittest.main()
