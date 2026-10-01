from __future__ import annotations

import hmac
import os
import threading

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from library_store import LibraryStore


router = APIRouter(prefix="/api/extension", tags=["chrome-extension"])
_active_user_id: str | None = None
_session_lock = threading.Lock()


class DesktopSessionPayload(BaseModel):
    user_id: int | None = None


def _desktop_token_is_valid(value: str | None) -> bool:
    expected = os.getenv("LEMA_DESKTOP_SESSION_TOKEN", "")
    return bool(value and expected and hmac.compare_digest(value, expected))


def _active_user() -> str | None:
    with _session_lock:
        return _active_user_id


@router.put("/session", include_in_schema=False)
def update_desktop_session(
    payload: DesktopSessionPayload,
    x_lema_desktop_token: str | None = Header(default=None, alias="X-Lema-Desktop-Token"),
):
    if not _desktop_token_is_valid(x_lema_desktop_token):
        raise HTTPException(403, "Invalid desktop session token")

    global _active_user_id
    with _session_lock:
        _active_user_id = str(payload.user_id) if payload.user_id else None
    return {"ok": True}


@router.get("/status")
def extension_status():
    return {"running": True, "signed_in": _active_user() is not None}


@router.post("/pages")
def create_extension_page(payload: dict):
    user_id = _active_user()
    if user_id is None:
        raise HTTPException(401, "Sign in to Lema before saving a page from Chrome.")
    if "result" not in payload or not payload.get("language"):
        raise HTTPException(400, "result and language are required")

    return {"id": LibraryStore(user_id=user_id).create_page(payload)}
