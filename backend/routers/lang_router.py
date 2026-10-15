from fastapi import APIRouter, BackgroundTasks
import uuid
import sys
from pathlib import Path
from services.installer import (
    get_install_state,
    install_pack,
    uninstall_pack,
    progress_map,
)

router = APIRouter(prefix="/api/lang", tags=["lang"])

ROOT_DIR = Path(__file__).resolve().parents[2]

if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from shared.manifests import PACKS


# -----------------------------
# PACK CATALOG
# -----------------------------

def fetch_packs():
    return PACKS


@router.get("/packs")
def get_packs():
    return fetch_packs()

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
