import { parseApiErrorDetail, type ApiErrorDetail } from "../../api";

const API_ERROR_MESSAGE_KEYS: Record<string, string> = {
  email_already_registered: "This email is already registered.",
  invalid_credentials: "Invalid email or password.",
  email_not_verified: "Please verify your email before logging in.",
  invalid_token: "This link is invalid or has expired.",
  user_not_found: "User not found.",
  login_rate_limited: "Too many login attempts. Please wait and try again.",
  too_many_requests: "Too many requests. Please wait and try again.",
  email_service_busy: "We can't send a verification email right now. Please try again later.",
  email_delivery_failed: "We couldn't send the verification email. Please try again in a minute.",
  password_too_short: "Use at least 8 characters for your password.",
  password_too_long: "Use no more than 128 characters for your password.",
  password_compromised: "Choose a less common password.",
  password_reset_rate_limited: "Too many password reset attempts. Please wait and try again.",
  request_failed: "Something went wrong. Please try again.",
};

const RAW_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "invalid credentials": "Invalid email or password.",
  "email already registered": "This email is already registered.",
  "email not verified": "Please verify your email before logging in.",
  "invalid token": "This link is invalid or has expired.",
  "user not found": "User not found.",
  "value is not a valid email address: An email address must have an @-sign.":
    "Enter a valid email address.",
};

function normalizeRawMessage(message: string) {
  return RAW_ERROR_MESSAGE_KEYS[message] || message;
}

export function resolveAuthMessage(detail: ApiErrorDetail) {
  const parsed = parseApiErrorDetail(detail);

  if (!parsed) {
    return "error";
  }

  if (parsed.code) {
    return API_ERROR_MESSAGE_KEYS[parsed.code] || parsed.message;
  }

  return normalizeRawMessage(parsed.message);
}
