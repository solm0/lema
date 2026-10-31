from db import Base
from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from datetime import UTC, datetime


def utc_now_naive():
    return datetime.now(UTC).replace(tzinfo=None)

class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True)
  name = Column(String, nullable=True)
  email = Column(String, unique=True)
  password_hash = Column(String)
  email_verified = Column(Boolean, default=False)
  verify_token = Column(String, nullable=True)
  # Kept temporarily so existing databases can be migrated without dropping a
  # column. New password reset tokens live in password_reset_tokens.
  reset_token = Column(String, nullable=True)
  auth_version = Column(Integer, nullable=False, default=0)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, nullable=False, default=utc_now_naive)
    expires_at = Column(DateTime, nullable=False, index=True)
    delivered_at = Column(DateTime, nullable=True)
    used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)


class EmailSendEvent(Base):
    __tablename__ = "email_send_events"

    id = Column(Integer, primary_key=True)
    recipient_hash = Column(String, nullable=False, index=True)
    purpose = Column(String, nullable=False)
    sent_at = Column(DateTime, nullable=False, default=utc_now_naive, index=True)

class UserLemma(Base):
    __tablename__ = "user_lemmas"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    lemma_key = Column(String, index=True)
    exposure_count = Column(Integer, nullable=False, default=0)
    is_known = Column(Boolean, nullable=False, default=False)
    is_interested = Column(Boolean, nullable=False, default=False)
    memo = Column(String(20), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "lemma_key"),
    )


class UserLemmaExample(Base):
    """A user-owned sentence snapshot, shared by that user's devices."""

    __tablename__ = "user_lemma_examples"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    lemma_key = Column(String, nullable=False, index=True)
    language = Column(String(16), nullable=False)
    text = Column(String, nullable=False)
    tokens_json = Column(String, nullable=False)
    match_indices_json = Column(String, nullable=False)
    content_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now_naive)
    last_seen_at = Column(DateTime, nullable=False, default=utc_now_naive)

    __table_args__ = (
        UniqueConstraint("user_id", "lemma_key", "content_hash"),
    )
