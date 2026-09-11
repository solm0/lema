from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from library_store import LibraryStore


router = APIRouter(prefix="/api/library", tags=["local-library"])


def store(x_lema_user_id: str = Header(alias="X-Lema-User-Id")) -> LibraryStore:
    try:
        return LibraryStore(user_id=x_lema_user_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


class NamePayload(BaseModel):
    name: str


class MovePayload(BaseModel):
    page_ids: list[str]
    notebook_id: str | None = None


class MetadataPayload(BaseModel):
    metadata: list[str]


class ContentPayload(BaseModel):
    content: str


@router.get("/pages")
def list_pages(library: LibraryStore = Depends(store)):
    return library.list_pages()


@router.post("/pages")
def create_page(payload: dict, library: LibraryStore = Depends(store)):
    if "result" not in payload or not payload.get("language"):
        raise HTTPException(400, "result and language are required")
    return {"id": library.create_page(payload)}


@router.get("/pages/{page_id}")
def get_page(page_id: str, library: LibraryStore = Depends(store)):
    page = library.get_page(page_id)
    if page is None:
        raise HTTPException(404, "page not found")
    return page


@router.patch("/pages/{page_id}")
def rename_page(page_id: str, payload: NamePayload, library: LibraryStore = Depends(store)):
    if not payload.name.strip():
        raise HTTPException(400, "name is required")
    if not library.rename_page(page_id, payload.name):
        raise HTTPException(404, "page not found")
    return {"ok": True}


@router.delete("/pages/{page_id}")
def delete_page(page_id: str, library: LibraryStore = Depends(store)):
    if not library.delete_page(page_id):
        raise HTTPException(404, "page not found")
    return {"ok": True}


@router.put("/pages/{page_id}/metadata")
def update_metadata(page_id: str, payload: MetadataPayload, library: LibraryStore = Depends(store)):
    try:
        return {"metadata": library.update_metadata(page_id, payload.metadata)}
    except KeyError:
        raise HTTPException(404, "page not found")


@router.post("/pages/move")
def move_pages(payload: MovePayload, library: LibraryStore = Depends(store)):
    library.move_pages(payload.page_ids, payload.notebook_id)
    return {"ok": True}


@router.get("/notebooks")
def list_notebooks(library: LibraryStore = Depends(store)):
    return library.list_notebooks()


@router.post("/notebooks")
def create_notebook(payload: NamePayload, library: LibraryStore = Depends(store)):
    if not payload.name.strip():
        raise HTTPException(400, "name is required")
    return library.create_notebook(payload.name)


@router.patch("/notebooks/{notebook_id}")
def rename_notebook(notebook_id: str, payload: NamePayload, library: LibraryStore = Depends(store)):
    if not library.rename_notebook(notebook_id, payload.name):
        raise HTTPException(404, "notebook not found")
    return {"ok": True}


@router.delete("/notebooks/{notebook_id}")
def delete_notebook(notebook_id: str, library: LibraryStore = Depends(store)):
    if not library.delete_notebook(notebook_id):
        raise HTTPException(404, "notebook not found")
    return {"ok": True}


@router.get("/annotations")
def list_annotations(library: LibraryStore = Depends(store)):
    return {"items": library.list_annotations(), "next_cursor": None}


@router.post("/annotations")
def create_annotation(payload: dict, library: LibraryStore = Depends(store)):
    try:
        return library.create_annotation(payload)
    except (KeyError, ValueError, TypeError) as error:
        raise HTTPException(400, str(error))


@router.patch("/annotations/{annotation_id}")
def update_annotation(annotation_id: str, payload: ContentPayload, library: LibraryStore = Depends(store)):
    annotation = library.update_annotation(annotation_id, payload.content)
    if annotation is None:
        raise HTTPException(404, "annotation not found")
    return annotation


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: str, library: LibraryStore = Depends(store)):
    if not library.delete_annotation(annotation_id):
        raise HTTPException(404, "annotation not found")
    return {"ok": True}


@router.get("/export")
def export_library(library: LibraryStore = Depends(store)):
    return library.export_bundle()


@router.post("/import")
def import_library(payload: dict, library: LibraryStore = Depends(store)):
    try:
        return library.import_bundle(payload)
    except ValueError as error:
        raise HTTPException(400, str(error))


@router.get("/meta/{key}")
def get_meta(key: str, library: LibraryStore = Depends(store)):
    return {"value": library.get_meta(key)}


@router.put("/meta/{key}")
def set_meta(key: str, payload: dict, library: LibraryStore = Depends(store)):
    library.set_meta(key, str(payload.get("value") or ""))
    return {"ok": True}
