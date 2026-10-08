import hashlib
import logging
import os
import unicodedata
from pathlib import Path

import httpx


MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
PWNED_PASSWORDS_URL = os.getenv(
    "PWNED_PASSWORDS_URL",
    "https://api.pwnedpasswords.com/range",
).rstrip("/")
PWNED_PASSWORDS_TIMEOUT_SECONDS = float(
    os.getenv("PWNED_PASSWORDS_TIMEOUT_SECONDS", "2")
)
COMMON_PASSWORDS_PATH = Path(__file__).resolve().parent.parent / "data" / "common_passwords.txt"
logger = logging.getLogger(__name__)


class PasswordPolicyError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_password(password: str) -> str:
    return unicodedata.normalize("NFC", password)


def _load_common_passwords() -> frozenset[str]:
    try:
        return frozenset(
            line.strip().casefold()
            for line in COMMON_PASSWORDS_PATH.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        )
    except FileNotFoundError:
        logger.error("common password list is missing: %s", COMMON_PASSWORDS_PATH)
        return frozenset()


COMMON_PASSWORDS = _load_common_passwords()


def validate_password_locally(password: str, *, email: str | None = None) -> str:
    normalized = normalize_password(password)

    if len(normalized) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            "password_too_short",
            f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    if len(normalized) > MAX_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            "password_too_long",
            f"password must be at most {MAX_PASSWORD_LENGTH} characters",
        )

    folded = normalized.casefold()
    email_local_part = email.split("@", 1)[0].casefold() if email and "@" in email else ""
    context_passwords = {
        "lemapassword",
        "lema1234",
        email_local_part,
    }
    if (
        not normalized.strip()
        or folded in COMMON_PASSWORDS
        or folded in context_passwords
    ):
        raise PasswordPolicyError(
            "password_compromised",
            "choose a less common password",
        )

    return normalized


async def is_pwned_password(password: str) -> bool:
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]

    try:
        async with httpx.AsyncClient(timeout=PWNED_PASSWORDS_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{PWNED_PASSWORDS_URL}/{prefix}",
                headers={
                    "Add-Padding": "true",
                    "User-Agent": "Lema-Password-Security",
                },
            )
            response.raise_for_status()
    except httpx.HTTPError:
        # The local list still protects the most common choices. Do not make
        # account creation or recovery unavailable because a third party is down.
        logger.warning("pwned password check unavailable", exc_info=True)
        return False

    return any(
        line.partition(":")[0].strip().upper() == suffix
        for line in response.text.splitlines()
    )


async def validate_new_password(password: str, *, email: str | None = None) -> str:
    normalized = validate_password_locally(password, email=email)
    if await is_pwned_password(normalized):
        raise PasswordPolicyError(
            "password_compromised",
            "choose a password that has not appeared in a known data breach",
        )
    return normalized
