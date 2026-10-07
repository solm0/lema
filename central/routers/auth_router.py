from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from jose import jwt, JWTError
import secrets
import datetime
import logging
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
import os
from dotenv import load_dotenv
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import date
from db import get_db
from models import (
  User,
  UserLemma,
)
from services.auth_rate_limits import (
  email_send_limiter,
  login_attempt_limiter,
  normalize_email,
)

# -----------------------------
# config
# -----------------------------

load_dotenv()

SECRET_KEY = os.getenv('SECRET_KEY')
ALGORITHM = "HS256"
DATABASE_URL = os.getenv('DATABASE_URL')
PUBLIC_API_BASE_URL = os.getenv("PUBLIC_API_BASE_URL", "http://localhost:8000/api")

pwd_context = CryptContext(schemes=["bcrypt"])
DUMMY_PASSWORD_HASH = pwd_context.hash(secrets.token_urlsafe(32))
logger = logging.getLogger(__name__)

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
  return pwd_context.hash(password)

def verify_password(password: str, hash):
  return pwd_context.verify(password, hash)

def create_token(user_id: int):
  payload = {
      "user_id": user_id,
      "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=7)
  }
  return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

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


def render_auth_page(title: str, body: str) -> HTMLResponse:
  html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
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
  safe_token = token.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
  body = f"""
      <h1>Reset password</h1>
      <p>Enter a new password for your Lema account.</p>
      <form id="reset-form">
        <label>
          <input id="password" type="password" minlength="1" autocomplete="new-password" required />
        </label>
        <button id="submit-button" type="submit">Change password</button>
      </form>
      <div id="message" class="message"></div>
      <script>
        const token = "{safe_token}";
        const form = document.getElementById("reset-form");
        const passwordInput = document.getElementById("password");
        const submitButton = document.getElementById("submit-button");
        const message = document.getElementById("message");

        form.addEventListener("submit", async (event) => {{
          event.preventDefault();

          const password = passwordInput.value.trim();

          if (!password) {{
            message.textContent = "Enter a new password.";
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
            const error = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;

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
    password_hash=hash_password(data.password),
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
  password_matches = verify_password(data.password, password_hash)

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

  if not user.email_verified:
      raise api_error(400, "email_not_verified", "email not verified")

  token = create_token(user.id)

  return {
    "access_token": token,
    "token_type": "bearer"
  }

# -----------------------------
# request password reset
# -----------------------------

@router.post("/request-password-reset", status_code=status.HTTP_202_ACCEPTED)
async def request_reset(data: ResetRequest, db: Session = Depends(get_db)):

  email = normalize_email(str(data.email))

  user = db.query(User).filter(func.lower(User.email) == email).first()

  if not user:
    return {"message": "if email exists, reset link sent"}

  reservation = email_send_limiter.reserve(
    db,
    email=email,
    purpose="password_reset",
  )
  if not reservation.allowed:
    return {"message": "if email exists, reset link sent"}

  token = secrets.token_urlsafe(32)

  user.reset_token = token

  db.commit()

  link = f"{PUBLIC_API_BASE_URL}/reset-password?token={token}"

  try:
    await send_email(user.email, link, "password_reset")
  except Exception:
    logger.exception("password reset email delivery failed")

  return {"message": "if email exists, reset link sent"}

# -----------------------------
# reset password
# -----------------------------

@router.get("/reset-password")
def reset_password_page(token: str):
  return render_reset_page(token)

@router.post("/reset-password")
def reset_password(data: ResetPassword, db: Session = Depends(get_db)):

  user = db.query(User).filter(User.reset_token == data.token).first()

  if not user:
    raise api_error(400, "invalid_token", "invalid token")

  user.password_hash = hash_password(data.new_password)
  user.reset_token = None

  db.commit()

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
        if not user_id:
            raise api_error(401, "invalid_token", "invalid token")
    except JWTError:
        raise api_error(401, "invalid_token", "invalid token")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise api_error(401, "user_not_found", "user not found")
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
