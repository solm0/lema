import os
from pathlib import Path

import bootstrap_paths  # noqa: F401
from sqlalchemy import text

from db import engine, Base
from language_config.model_store import (
    download_model,
    ensure_model_directories,
    model_exists,
)
from packs import get_model_provider, list_languages
from runtime_paths import get_runtime_state_root
from shared.manifests import mark_runtime_consumers

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers.auth_router import router as auth_router
from routers.lemmas_router import router as lemmas_router
from routers.internal_router import router as internal_router
from routers.mobile_router import router as mobile_router
from routers.demo_router import router as demo_router
from routers.version_router import router as version_router

BASE_DIR = Path(__file__).resolve().parent
LANDING_DIR = BASE_DIR / "static" / "landing"

app = FastAPI()
STATE_ROOT = get_runtime_state_root()


def ensure_language_models():
    ensure_model_directories()

    for lang in list_languages():
        if model_exists(lang):
            print(f"[skip] model exists: {lang}")
            mark_runtime_consumers(STATE_ROOT, lang)
            continue

        try:
            if get_model_provider(lang) == "classla":
                print(f"[classla] downloading: {lang}")
                download_model(lang)

            else:
                print(f"[stanza] downloading: {lang}")
                download_model(lang)

            mark_runtime_consumers(STATE_ROOT, lang)

        except Exception as e:
            print(f"Failed downloading {lang}: {e}")


ensure_language_models()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:8010",
        "http://127.0.0.1:8010",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost",
        "https://localhost",
        "capacitor://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(lemmas_router)
app.include_router(internal_router)
app.include_router(mobile_router)
app.include_router(demo_router)
app.include_router(version_router)

Base.metadata.create_all(bind=engine)

def ensure_user_lemma_schema():
    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info(user_lemmas)").fetchall()
        }

        # Before this migration, every row represented an interested (favorite) lemma.
        if "is_interested" not in columns:
            conn.execute(text("ALTER TABLE user_lemmas ADD COLUMN is_interested BOOLEAN"))
            conn.execute(text("UPDATE user_lemmas SET is_interested = 1"))

        if "exposure_count" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE user_lemmas "
                    "ADD COLUMN exposure_count INTEGER NOT NULL DEFAULT 0"
                )
            )

        if "is_known" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE user_lemmas "
                    "ADD COLUMN is_known BOOLEAN NOT NULL DEFAULT 0"
                )
            )

        if "updated_at" not in columns:
            conn.execute(text("ALTER TABLE user_lemmas ADD COLUMN updated_at DATETIME"))
            conn.execute(text("UPDATE user_lemmas SET updated_at = CURRENT_TIMESTAMP"))

ensure_user_lemma_schema()

if LANDING_DIR.exists():
    app.mount(
        "/",
        StaticFiles(directory=str(LANDING_DIR), html=True),
        name="landing",
    )
