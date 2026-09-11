# Central Guide

## Purpose

`central` is the shared FastAPI server for accounts, pages, landing content, and mobile API endpoints.

## Start here

- `main.py`: app boot, model download, schema setup, router registration, landing mount
- `routers/auth_router.py`: authentication flows
- `routers/mobile_router.py`: mobile analyze and lookup APIs
- `db.py`, `models.py`: persistence layer

## When to use this folder

- Login, signup, password reset, account flows
- Mobile app calls that should hit the cloud API
- Landing page hosting from `static/landing`

## Important boundaries

- Mobile uses `central` for account/content calls and `/api/mobile/*`
- Desktop Electron should still use the local `backend` for local language analysis
- If behavior should match both local and central servers, compare with `shared` before changing duplicated service code
- Do not assume language packs or lemma DBs live under `backend/data/static` when working on `central`
- For `central`, prefer `central/data/static` or an explicit runtime override such as `NAUTILUS_DATA_STATIC_ROOT`

## Notes

- `main.py` may download language models during startup
- Schema bootstrap happens in app startup, so database-related changes can affect boot behavior
- `central` currently aims to keep one latest installed pack version per language under `central/data/static`
- `central/install_packs.py` prewarms all languages, while runtime dependency definitions still come from `shared/manifests`
- `central` writes runtime state/refcount files under `central/data_runtime/state` to stay consistent with desktop/backend tracking
- If a central-only service imports `shared`, make sure repo-root bootstrap/import path setup still works under systemd or other service runners
