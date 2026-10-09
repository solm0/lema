from fastapi import APIRouter, BackgroundTasks
import uuid
import httpx
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()
from services.installer import (
    get_install_state,
    install_pack,
    uninstall_pack,
    progress_map,
)

router = APIRouter(prefix="/api/lang", tags=["lang"])

CENTRAL_API = (os.getenv("CENTRAL_API") or "https://nautilus.solmi.wiki/api").rstrip("/")
ROOT_DIR = Path(__file__).resolve().parents[2]

if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from shared.manifests import PACKS


# -----------------------------
# PACK LIST FROM CENTRAL
# -----------------------------

def fetch_packs():
    supported_languages = {pack["lang"] for pack in PACKS}

    try:
        with httpx.Client(http2=False, timeout=10.0) as client:
            res = client.get(f"{CENTRAL_API}/lang/packs")
            res.raise_for_status()
            return [
                pack
                for pack in res.json()
                if pack.get("lang") in supported_languages
            ]
    except Exception as exc:
        print(f"[lang_router] failed to fetch packs from {CENTRAL_API}: {exc}")
        return PACKS

# -----------------------------
# INSTALLED STATUS
# -----------------------------
@router.get("/installed")
def get_installed():
    packs = fetch_packs()

    result = []

    for p in packs:
        state = get_install_state(p["lang"], p["version"])

        result.append({
            "lang": p["lang"],
            "version": p["version"],
            **state,
        })

    return result


# -----------------------------
# INSTALL
# -----------------------------
@router.post("/install")
def install(data: dict, bg: BackgroundTasks):
    task_id = str(uuid.uuid4())

    def job():
        install_pack(
            data["lang"],
            data["version"],
            data.get("filename"),
            task_id,
            data.get("download_url"),
        )

    bg.add_task(job)

    return {"task_id": task_id}


# -----------------------------
# UNINSTALL
# -----------------------------
@router.post("/uninstall")
def uninstall(data: dict):
    uninstall_pack(data["lang"], data["version"])
    return {"status": "ok"}


# -----------------------------
# PROGRESS
# -----------------------------
@router.get("/progress/{task_id}")
def progress(task_id: str):
    return progress_map.get(task_id, {
        "progress": 0,
        "status": "unknown"
    })
