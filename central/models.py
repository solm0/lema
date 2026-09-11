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
from datetime import datetime

class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True)
  name = Column(String, nullable=True)
  email = Column(String, unique=True)
  password_hash = Column(String)
  email_verified = Column(Boolean, default=False)
  verify_token = Column(String, nullable=True)
  reset_token = Column(String, nullable=True)

class UserLemma(Base):
    __tablename__ = "user_lemmas"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    lemma_key = Column(String, index=True)
    exposure_count = Column(Integer, nullable=False, default=0)
    is_known = Column(Boolean, nullable=False, default=False)
    is_interested = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "lemma_key"),
    )
