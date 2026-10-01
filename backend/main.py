import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn

from routers.lemmas_router import router as lemmas_router
from routers.lang_router import router as lang_router
from routers.content_router import router as content_router
from routers.library_router import router as library_router
from routers.extension_router import router as extension_router
from runtime_paths import get_frontend_dist_dir

app = FastAPI()
FRONTEND_DIST_DIR = get_frontend_dist_dir()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost",        # Electron
        "https://localhost",       # Capacitor Android WebView
        "capacitor://localhost",   # Capacitor iOS WebView
        "file://",                 # Electron file 프로토콜
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(content_router)
app.include_router(lemmas_router)
app.include_router(lang_router)
app.include_router(library_router)
app.include_router(extension_router)


@app.get("/", include_in_schema=False)
def serve_frontend_root():
    if FRONTEND_DIST_DIR is None:
        return {"status": "ok"}

    index_file = FRONTEND_DIST_DIR / "index.html"

    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")

    return FileResponse(index_file)


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_asset(full_path: str):
    if FRONTEND_DIST_DIR is None:
        raise HTTPException(status_code=404, detail="Not Found")

    candidate = (FRONTEND_DIST_DIR / full_path).resolve()

    try:
        candidate.relative_to(FRONTEND_DIST_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not Found")

    if candidate.is_file():
        return FileResponse(candidate)

    if "." in full_path.split("/")[-1]:
        raise HTTPException(status_code=404, detail="Not Found")

    index_file = FRONTEND_DIST_DIR / "index.html"

    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")

    return FileResponse(index_file)


def run() -> None:
    port = int(os.getenv("LEMA_BACKEND_PORT") or os.getenv("NAUTILUS_BACKEND_PORT", "8010"))
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    run()
