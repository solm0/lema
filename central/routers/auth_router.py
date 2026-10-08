from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Request, status
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import func
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from jose import jwt, JWTError
import asyncio
import secrets
import datetime
import hashlib
import json
import logging
import time
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
import os
from dotenv import load_dotenv
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import date
from db import get_db
from models import (
  PasswordResetToken,
  User,
  UserLemma,
)
from services.auth_rate_limits import (
  email_send_limiter,
  login_attempt_limiter,
  normalize_email,
)
from services.analysis_access import get_client_ip
from services.password_reset_limits import password_reset_attempt_limiter
from services.password_security import (
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  normalize_password,
  validate_new_password,
)

# -----------------------------
# config
# -----------------------------

load_dotenv()

SECRET_KEY = os.getenv('SECRET_KEY')
ALGORITHM = "HS256"
DATABASE_URL = os.getenv('DATABASE_URL')
PUBLIC_API_BASE_URL = os.getenv("PUBLIC_API_BASE_URL", "http://localhost:8000/api")

pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated=["bcrypt"])
DUMMY_PASSWORD_HASH = pwd_context.hash(secrets.token_urlsafe(32))
logger = logging.getLogger(__name__)
PASSWORD_RESET_TTL_MINUTES = int(os.getenv("PASSWORD_RESET_TTL_MINUTES", "30"))
if PASSWORD_RESET_TTL_MINUTES <= 0:
  raise RuntimeError("PASSWORD_RESET_TTL_MINUTES must be greater than zero")
PASSWORD_RESET_RESPONSE_MIN_MS = int(
  os.getenv("PASSWORD_RESET_RESPONSE_MIN_MS", "200")
)
if PASSWORD_RESET_RESPONSE_MIN_MS < 0:
  raise RuntimeError("PASSWORD_RESET_RESPONSE_MIN_MS cannot be negative")

conf = ConnectionConfig(
  MAIL_USERNAME=os.getenv('MAIL_USERNAME'),
  MAIL_PASSWORD=os.getenv('MAIL_PASSWORD'),
  MAIL_FROM=os.getenv('MAIL_USERNAME'),
  MAIL_PORT=587,
  MAIL_SERVER="smtp.gmail.com",
  MAIL_STARTTLS=True,
  MAIL_SSL_TLS=False,
  USE_CREDENTIALS=True,
  VALIDATE_CERTS=True
)

# -----------------------------
# schemas
# -----------------------------

class SignupRequest(BaseModel):
  email: EmailStr
  password: str
  name: str

class LoginRequest(BaseModel):
  email: EmailStr
  password: str

class ResetRequest(BaseModel):
  email: EmailStr

class ResetPassword(BaseModel):
  token: str
  new_password: str

class AccountDeletionRequest(BaseModel):
  email: EmailStr
  password: str

# -----------------------------
# helpers
# -----------------------------

def api_error(status_code: int, code: str, message: str) -> HTTPException:
  return HTTPException(
    status_code=status_code,
    detail={
      "code": code,
      "message": message,
    },
  )

def rate_limit_error(code: str, message: str, retry_after: int) -> HTTPException:
  retry_after = max(1, retry_after)
  return HTTPException(
    status_code=429,
    detail={
      "code": code,
      "message": message,
      "retry_after_seconds": retry_after,
    },
    headers={"Retry-After": str(retry_after)},
  )

def email_service_error(code: str, message: str, retry_after: int) -> HTTPException:
  retry_after = max(1, retry_after)
  return HTTPException(
    status_code=503,
    detail={
      "code": code,
      "message": message,
      "retry_after_seconds": retry_after,
    },
    headers={"Retry-After": str(retry_after)},
  )

def hash_password(password: str):
  return pwd_context.hash(normalize_password(password))

def verify_password(password: str, hash):
  matches, _ = verify_password_and_update(password, hash)
  return matches

def verify_password_and_update(password: str, password_hash: str):
  normalized = normalize_password(password)
  candidates = [password]
  if normalized != password:
    candidates.append(normalized)

  for candidate in candidates:
    matches, replacement_hash = pwd_context.verify_and_update(candidate, password_hash)
    if matches:
      return True, replacement_hash
  return False, None

def create_token(user_id: int, auth_version: int = 0):
  payload = {
      "user_id": user_id,
      "auth_version": auth_version,
      "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=7)
  }
  return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def utc_now_naive():
  return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

def hash_reset_token(token: str) -> str:
  return hashlib.sha256(token.encode("utf-8")).hexdigest()

def password_policy_error(error: PasswordPolicyError) -> HTTPException:
  return api_error(400, error.code, error.message)

async def wait_for_reset_response_window(started_at: float):
  remaining_seconds = (
    PASSWORD_RESET_RESPONSE_MIN_MS / 1000
    - (time.monotonic() - started_at)
  )
  if remaining_seconds > 0:
    await asyncio.sleep(remaining_seconds)

async def send_email(email: str, link: str, purpose: str):

  if purpose == "verify_email":
    subject = "[Lema] Verify your email"
    body = (
      "Verify your email address using the link below.\n"
      "아래 링크를 눌러 이메일 주소를 인증하세요.\n"
      f"{link}"
    )
  else:
    subject = "[Lema] Reset your password"
    body = (
      "Reset your password using the link below.\n"
      "아래 링크를 눌러 비밀번호를 재설정하세요.\n"
      f"{link}"
    )

  message = MessageSchema(
    subject=subject,
    recipients=[email],
    body=body,
    subtype="plain"
  )

  fm = FastMail(conf)

  await fm.send_message(message)


async def deliver_password_reset_email(
  token_id: int,
  email: str,
  link: str,
  session_factory,
):
  try:
    await send_email(email, link, "password_reset")
  except Exception:
    logger.exception("password reset email delivery failed")
    db = session_factory()
    try:
      token = db.query(PasswordResetToken).filter(
        PasswordResetToken.id == token_id,
        PasswordResetToken.delivered_at.is_(None),
      ).first()
      if token:
        db.delete(token)
        db.commit()
    finally:
      db.close()
    return

  db = session_factory()
  try:
    token = db.query(PasswordResetToken).filter(
      PasswordResetToken.id == token_id,
      PasswordResetToken.used_at.is_(None),
      PasswordResetToken.revoked_at.is_(None),
    ).first()
    if not token:
      return

    now = utc_now_naive()
    db.query(PasswordResetToken).filter(
      PasswordResetToken.user_id == token.user_id,
      PasswordResetToken.id != token.id,
      PasswordResetToken.used_at.is_(None),
      PasswordResetToken.revoked_at.is_(None),
    ).update({PasswordResetToken.revoked_at: now}, synchronize_session=False)
    token.delivered_at = now
    db.commit()
  finally:
    db.close()


def render_auth_page(title: str, body: str) -> HTMLResponse:
  html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>{title}</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg0: #08131a;
        --bg1: #0f2430;
        --card: rgba(7, 18, 24, 0.76);
        --border: rgba(197, 235, 255, 0.18);
        --text: #eef8ff;
        --muted: #9fbbca;
        --accent: #79d9ff;
        --accent-strong: #44c7ff;
        --danger: #ff7b86;
        --success: #8ef0b7;
      }}

      * {{
        box-sizing: border-box;
      }}

      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top, rgba(121, 217, 255, 0.18), transparent 34%),
          linear-gradient(160deg, var(--bg0), var(--bg1));
      }}

      .card {{
        width: min(100%, 420px);
        padding: 32px 28px;
        border-radius: 24px;
        border: 1px solid var(--border);
        background: var(--card);
        backdrop-filter: blur(16px);
        box-shadow: 0 22px 60px rgba(0, 0, 0, 0.32);
      }}

      h1 {{
        margin: 0 0 12px;
        font-size: 28px;
      }}

      p {{
        margin: 0;
        line-height: 1.6;
        color: var(--muted);
      }}

      form {{
        margin-top: 24px;
      }}

      label {{
        display: block;
        margin-bottom: 10px;
        font-size: 14px;
        color: var(--muted);
      }}

      input {{
        width: 100%;
        margin-top: 8px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--text);
        font-size: 16px;
      }}

      button {{
        width: 100%;
        margin-top: 14px;
        padding: 14px 16px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #06202d;
        font-weight: 700;
        font-size: 16px;
        cursor: pointer;
      }}

      button:disabled {{
        opacity: 0.72;
        cursor: wait;
      }}

      .message {{
        margin-top: 18px;
        min-height: 24px;
        font-size: 14px;
      }}

      .message.error {{
        color: var(--danger);
      }}

      .message.success {{
        color: var(--success);
      }}
    </style>
  </head>
  <body>
    <main class="card">
      {body}
    </main>
  </body>
</html>"""

  return HTMLResponse(content=html)


def render_verify_result(title: str, message: str, success: bool) -> HTMLResponse:
  status_class = "success" if success else "error"
  body = f"""
      <h1>{title}</h1>
      <p>{message}</p>
      <div class="message {status_class}">
        {"You can return to the app and sign in now." if success else "Please request a new verification email and try again."}
      </div>
    """
  return render_auth_page(title, body)


def render_reset_page(token: str) -> HTMLResponse:
  token_literal = json.dumps(token).replace("</", "<\\/")
  body = f"""
      <h1>Reset password</h1>
      <p>Enter a new password for your Lema account.</p>
      <form id="reset-form">
        <label>
          <input id="password" type="password" autocomplete="new-password" required />
        </label>
        <button id="submit-button" type="submit">Change password</button>
      </form>
      <div id="message" class="message"></div>
      <script>
        const token = {token_literal};
        window.history.replaceState(null, "", window.location.pathname);
        const form = document.getElementById("reset-form");
        const passwordInput = document.getElementById("password");
        const submitButton = document.getElementById("submit-button");
        const message = document.getElementById("message");

        form.addEventListener("submit", async (event) => {{
          event.preventDefault();

          const password = passwordInput.value;

          const passwordLength = Array.from(password.normalize("NFC")).length;
          if (passwordLength < {MIN_PASSWORD_LENGTH} || passwordLength > {MAX_PASSWORD_LENGTH}) {{
            message.textContent = "Use {MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters.";
            message.className = "message error";
            return;
          }}

          submitButton.disabled = true;
          message.textContent = "Updating password...";
          message.className = "message";

          try {{
            const response = await fetch(window.location.pathname, {{
              method: "POST",
              headers: {{
                "Content-Type": "application/json"
              }},
              body: JSON.stringify({{
                token,
                new_password: password
              }})
            }});

            const data = await response.json();
            const error = Array.isArray(data.detail)
              ? data.detail[0]?.msg
              : data.detail?.message || data.detail;

            if (!response.ok || error) {{
              message.textContent = error || "Could not reset password.";
              message.className = "message error";
              return;
            }}

            message.textContent = data.message || "Password updated.";
            message.className = "message success";
            form.style.display = "none";
          }} catch (_error) {{
            message.textContent = "Network error. Please try again.";
            message.className = "message error";
          }} finally {{
            submitButton.disabled = false;
          }}
        }});
      </script>
    """
  return render_auth_page("Reset password", body)

# -----------------------------
# router
# -----------------------------

router = APIRouter(prefix="/api")

# -----------------------------
# signup
# -----------------------------

@router.post("/signup")
async def signup(data: SignupRequest, db: Session = Depends(get_db)):

  email = normalize_email(str(data.email))

  existing = db.query(User).filter(func.lower(User.email) == email).first()

  if existing:
    raise api_error(400, "email_already_registered", "email already registered")

  try:
    password = await validate_new_password(data.password, email=email)
  except PasswordPolicyError as exc:
    raise password_policy_error(exc) from exc

  reservation = email_send_limiter.reserve(
    db,
    email=email,
    purpose="verify_email",
  )
  if not reservation.allowed:
    raise email_service_error(
      "email_service_busy",
      "verification email is temporarily unavailable",
      reservation.retry_after,
    )

  token = secrets.token_urlsafe(32)

  user = User(
    email=email,
    password_hash=hash_password(password),
    name=data.name,
    verify_token=token,
  )

  db.add(user)
  db.commit()

  link = f"{PUBLIC_API_BASE_URL}/verify-email?token={token}"

  try:
    await send_email(email, link, "verify_email")
  except Exception as exc:
    logger.exception("verification email delivery failed")
    db.delete(user)
    db.commit()
    raise email_service_error(
      "email_delivery_failed",
      "verification email could not be sent",
      60,
    ) from exc

  return {"message": "signup success. check email for verification link"}

# -----------------------------
# email verification
# -----------------------------

@router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):

  user = db.query(User).filter(User.verify_token == token).first()

  if not user:
    return render_verify_result(
      "Verification failed",
      "This verification link is invalid or has already been used.",
      False,
    )

  user.email_verified = True
  user.verify_token = None

  db.commit()

  return render_verify_result(
    "Email verified",
    "Your email address has been verified successfully.",
    True,
  )

# -----------------------------
# login
# -----------------------------

@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):

  email = normalize_email(str(data.email))
  retry_after = login_attempt_limiter.retry_after(email)
  if retry_after:
    raise rate_limit_error(
      "login_rate_limited",
      "too many login attempts",
      retry_after,
    )

  user = db.query(User).filter(func.lower(User.email) == email).first()
  password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
  password_matches, replacement_hash = verify_password_and_update(
    data.password,
    password_hash,
  )

  if not user or not password_matches:
      retry_after = login_attempt_limiter.record_failure(email)
      if retry_after:
        raise rate_limit_error(
          "login_rate_limited",
          "too many login attempts",
          retry_after,
        )
      raise api_error(400, "invalid_credentials", "invalid credentials")

  login_attempt_limiter.reset(email)

  if replacement_hash:
      user.password_hash = replacement_hash
      db.commit()

  if not user.email_verified:
      raise api_error(400, "email_not_verified", "email not verified")

  token = create_token(user.id, user.auth_version or 0)

  return {
    "access_token": token,
    "token_type": "bearer"
  }

# -----------------------------
# request password reset
# -----------------------------

@router.post("/request-password-reset", status_code=status.HTTP_202_ACCEPTED)
async def request_reset(
  data: ResetRequest,
  background_tasks: BackgroundTasks,
  db: Session = Depends(get_db),
):
  started_at = time.monotonic()

  email = normalize_email(str(data.email))

  user = db.query(User).filter(func.lower(User.email) == email).first()

  if not user:
    await wait_for_reset_response_window(started_at)
    return {"message": "if email exists, reset link sent"}

  reservation = email_send_limiter.reserve(
    db,
    email=email,
    purpose="password_reset",
  )
  if not reservation.allowed:
    await wait_for_reset_response_window(started_at)
    return {"message": "if email exists, reset link sent"}

  token = secrets.token_urlsafe(32)
  token_record = PasswordResetToken(
    user_id=user.id,
    token_hash=hash_reset_token(token),
    created_at=utc_now_naive(),
    expires_at=utc_now_naive() + datetime.timedelta(
      minutes=PASSWORD_RESET_TTL_MINUTES,
    ),
  )
  user.reset_token = None
  db.query(PasswordResetToken).filter(
    PasswordResetToken.expires_at <= utc_now_naive(),
  ).delete(synchronize_session=False)
  db.add(token_record)
  db.commit()
  db.refresh(token_record)

  link = f"{PUBLIC_API_BASE_URL}/reset-password?token={token}"
  background_tasks.add_task(
    deliver_password_reset_email,
    token_record.id,
    user.email,
    link,
    sessionmaker(bind=db.get_bind()),
  )

  await wait_for_reset_response_window(started_at)
  return {"message": "if email exists, reset link sent"}

# -----------------------------
# reset password
# -----------------------------

@router.get("/reset-password")
def reset_password_page(token: str):
  return render_reset_page(token)

@router.post("/reset-password")
async def reset_password(
  data: ResetPassword,
  request: Request,
  db: Session = Depends(get_db),
):
  retry_after = password_reset_attempt_limiter.reserve_ip_attempt(
    get_client_ip(request),
  )
  if retry_after:
    raise rate_limit_error(
      "password_reset_rate_limited",
      "too many password reset attempts",
      retry_after,
    )

  token_hash = hash_reset_token(data.token)
  retry_after = password_reset_attempt_limiter.token_retry_after(token_hash)
  if retry_after:
    raise rate_limit_error(
      "password_reset_rate_limited",
      "too many password reset attempts",
      retry_after,
    )

  now = utc_now_naive()
  token_record = db.query(PasswordResetToken).filter(
    PasswordResetToken.token_hash == token_hash,
    PasswordResetToken.delivered_at.is_not(None),
    PasswordResetToken.used_at.is_(None),
    PasswordResetToken.revoked_at.is_(None),
    PasswordResetToken.expires_at > now,
  ).first()

  if not token_record:
    retry_after = password_reset_attempt_limiter.record_token_failure(token_hash)
    if retry_after:
      raise rate_limit_error(
        "password_reset_rate_limited",
        "too many password reset attempts",
        retry_after,
      )
    raise api_error(400, "invalid_token", "invalid token")

  user = db.query(User).filter(User.id == token_record.user_id).first()
  if not user:
    raise api_error(400, "invalid_token", "invalid token")

  try:
    password = await validate_new_password(data.new_password, email=user.email)
  except PasswordPolicyError as exc:
    raise password_policy_error(exc) from exc

  completed_at = utc_now_naive()
  claimed = db.query(PasswordResetToken).filter(
    PasswordResetToken.id == token_record.id,
    PasswordResetToken.used_at.is_(None),
    PasswordResetToken.revoked_at.is_(None),
    PasswordResetToken.expires_at > completed_at,
  ).update(
    {PasswordResetToken.used_at: completed_at},
    synchronize_session=False,
  )
  if claimed != 1:
    db.rollback()
    raise api_error(400, "invalid_token", "invalid token")

  db.query(PasswordResetToken).filter(
    PasswordResetToken.user_id == user.id,
    PasswordResetToken.id != token_record.id,
    PasswordResetToken.used_at.is_(None),
    PasswordResetToken.revoked_at.is_(None),
  ).update(
    {PasswordResetToken.revoked_at: completed_at},
    synchronize_session=False,
  )
  user.password_hash = hash_password(password)
  user.auth_version = (user.auth_version or 0) + 1
  user.reset_token = None
  db.commit()
  password_reset_attempt_limiter.reset_token(token_hash)

  return {"message": "password updated"}

# -----------------------------
# get current user
# -----------------------------

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        token_auth_version = payload.get("auth_version", 0)
        if not user_id:
            raise api_error(401, "invalid_token", "invalid token")
    except JWTError:
        raise api_error(401, "invalid_token", "invalid token")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise api_error(401, "user_not_found", "user not found")
    if token_auth_version != (user.auth_version or 0):
        raise api_error(401, "invalid_token", "invalid token")
    return user

@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name
    }

# -----------------------------
# update name
# -----------------------------

class UpdateName(BaseModel):
  name: str

@router.put("/me/name")
def update_name(
    data: UpdateName,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    current_user.name = data.name
    db.commit()

    return {"name": current_user.name}


def delete_user_account(current_user: User, db: Session):
    user_id = current_user.id

    db.query(UserLemma).filter(UserLemma.user_id == user_id).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user_id,
    ).delete(synchronize_session=False)
    db.delete(current_user)
    db.commit()

    return {"ok": True}


@router.delete("/me")
def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return delete_user_account(current_user, db)


@router.post("/account-deletion")
def delete_account_with_credentials(
    data: AccountDeletionRequest,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.password_hash):
        raise api_error(400, "invalid_credentials", "invalid credentials")

    return delete_user_account(user, db)
