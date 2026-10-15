# Central Guide

## Purpose

`central` is the shared FastAPI server for accounts, vocabulary-state sync, landing content, and release metadata.

## Start here

- `main.py`: app boot, schema setup, router registration, landing mount
- `routers/auth_router.py`: authentication flows
- `routers/lemmas_router.py`: account vocabulary-state sync APIs
- `db.py`, `models.py`: persistence layer

## When to use this folder

- Login, signup, password reset, account flows
- Mobile account and vocabulary-state sync calls that should hit the cloud API
- Landing page hosting from `static/landing`

## Important boundaries

- Mobile and Electron perform language-pack analysis and lookup on-device; central never receives analyzed text. The only SQLite exception is the read-only English pack used by the public landing-demo lookup endpoints.
- Desktop Electron should still use the local `backend` for local language analysis

## Notes

- Schema bootstrap happens in app startup, so database-related changes can affect boot behavior
