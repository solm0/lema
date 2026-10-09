# Electron Guide

## Purpose

`electron` is the desktop shell. It starts the local backend, opens the frontend, handles deep links, and integrates with desktop now-playing sources.

## Start here

- `main.js`: process lifecycle, backend launch, deep links, desktop integrations
- `preload.js`: renderer bridge if the task touches IPC or window APIs
- `package.json`: desktop run and packaging scripts

## When to use this folder

- Desktop app boot issues
- Packaged app behavior
- Deep-link routing
- Local music player integration on macOS
- Backend process launch or port conflicts in desktop flows

## Important boundaries

- UI rendering usually lives in `frontend`
- Local API logic usually lives in `backend`
- Packaged backend resources come from `../backend-dist`

## Notes

- `main.js` contains local now-playing integration and deep-link dispatch
- Electron uses the local backend instead of the central mobile API for language analysis
- Packaged Electron builds store downloaded language packs and NLP models in user app-data paths, while dev continues to use `backend/data/static` and `backend/models`
- When touching desktop language-pack paths, prefer `backend/runtime_paths.py` instead of hardcoding repo-relative directories
- Only packaged desktop should rely on the backend runtime overlay in user app-data
- If a change affects what gets bundled versus copied into user runtime, inspect both `electron/main.js` and `scripts/build-electron.sh`
