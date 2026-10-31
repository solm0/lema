from db import Base
from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
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
    # Each meaningful interaction offsets 30 days of accumulated decay.
    decay_reduction_days = Column(Integer, nullable=False, default=0)
    # A successful Revival resets decay from this moment, rather than merely
    # subtracting a fixed number of days from a very old lemma.
    last_recap_succeeded_at = Column(DateTime, nullable=True)
    last_recap_failed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "lemma_key"),
        Index("ix_user_lemmas_user_updated", "user_id", "updated_at"),
    )


class UserLemmaMilestone(Base):
    """A small, append-only history of known-word milestones."""

    __tablename__ = "user_lemma_milestones"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    language = Column(String(16), nullable=False)
    known_count = Column(Integer, nullable=False)
    achieved_at = Column(DateTime, nullable=False, default=utc_now_naive)

    __table_args__ = (
        UniqueConstraint("user_id", "language", "known_count"),
        Index("ix_user_lemma_milestones_recent", "user_id", "language", "achieved_at"),
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


class UserRecapWeek(Base):
    """The immutable weekly showcase and its following week's test queue."""

    __tablename__ = "user_recap_weeks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Monday in the user's device timezone, kept as a calendar value rather
    # than a timestamp so a weekly group never moves with a clock conversion.
    week_start = Column(String(10), nullable=False)
    completed_at = Column(DateTime, nullable=True)
    expired_at = Column(DateTime, nullable=True)
    last_session_date = Column(String(10), nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now_naive)

    __table_args__ = (
        UniqueConstraint("user_id", "week_start"),
        Index("ix_user_recap_weeks_user_week", "user_id", "week_start"),
    )


class UserRecapItem(Base):
    __tablename__ = "user_recap_items"

    id = Column(Integer, primary_key=True)
    recap_week_id = Column(Integer, ForeignKey("user_recap_weeks.id"), nullable=False, index=True)
    lemma_key = Column(String, nullable=False, index=True)
    # showcase rows are displayed this week; test rows are copied from the
    # previous week's showcase and may be answered this week.
    kind = Column(String(12), nullable=False)
    position = Column(Integer, nullable=False)
    status = Column(String(12), nullable=False, default="pending")
    session_date = Column(String(10), nullable=True)
    question_json = Column(String, nullable=True)
    answered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now_naive)

    __table_args__ = (
        UniqueConstraint("recap_week_id", "kind", "lemma_key"),
        Index("ix_user_recap_items_week_kind_position", "recap_week_id", "kind", "position"),
    )
