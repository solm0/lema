# Backend Guide

## Purpose

`backend` is the local FastAPI server. Electron talks to this server on localhost for local analysis and dictionary-style features.

## Start here

- `main.py`: app setup, CORS, router registration
- `routers/`: API surface
- `services/`: local business logic
- `language_config/`: per-language setup

## When to use this folder

- Fixing local API behavior
- Desktop-local analysis or lookup issues
- Electron calling a localhost API
- Local content endpoints

## Usually do not read first

- `central` unless the same bug appears in cloud/mobile flows
- `preprocess` or `releases` unless the issue is in generated language data

## Notes

- CORS explicitly allows Electron, Capacitor localhost origins, and Chrome extensions
- Service names overlap with `shared` and `central`; confirm whether the change is local-only before copying logic across apps
- Local dev keeps using repo paths such as `backend/data/static` and `backend/models`
- Packaged desktop backend is different: it uses user app-data roots via `backend/runtime_paths.py`
- Packaged backend may materialize runtime packages into a user `runtime/site-packages` overlay; dev should not depend on that behavior
- Runtime dependency validation and refcount/state tracking are shared helpers imported from `shared/manifests`
