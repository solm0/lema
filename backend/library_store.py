from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = 1
_MIGRATION_LOCK = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _library_root() -> Path:
    override = os.getenv("LEMA_LIBRARY_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    legacy_override = os.getenv("LEMA_LIBRARY_DB_PATH")
    if legacy_override:
        return Path(legacy_override).expanduser().resolve().parent
    return Path(__file__).resolve().parent


def _validated_user_id(user_id: str) -> str:
    value = str(user_id).strip()
    if not value.isdecimal() or int(value) <= 0:
        raise ValueError("a valid library user id is required")
    return value


def get_library_db_path(user_id: str) -> Path:
    return _library_root() / "users" / _validated_user_id(user_id) / "lema.sqlite"


def _legacy_library_db_path() -> Path:
    override = os.getenv("LEMA_LIBRARY_DB_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return _library_root() / "lema.sqlite"


def _check_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        result = connection.execute("PRAGMA quick_check").fetchone()
    if not result or result[0] != "ok":
        raise sqlite3.DatabaseError(f"library database check failed: {path}")


def _remove_obsolete_migration_meta(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            DELETE FROM library_meta
            WHERE key LIKE 'central_migration_v%'
               OR key = 'legacy_nautilus_offline_library_v1'
            """
        )
        connection.commit()


def prepare_user_library(user_id: str) -> Path:
    """Claim the old device-wide DB once, then use only the account DB.

    No migration marker is needed: successful migration removes the legacy DB.
    """
    target = get_library_db_path(user_id)
    legacy = _legacy_library_db_path()
    with _MIGRATION_LOCK:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not legacy.exists():
            return target

        created_target = not target.exists()
        temporary = target.with_name("lema.migrating.sqlite")
        try:
            if created_target:
                for suffix in ("", "-wal", "-shm"):
                    Path(f"{temporary}{suffix}").unlink(missing_ok=True)
                with sqlite3.connect(legacy) as source, sqlite3.connect(temporary) as destination:
                    source.backup(destination)
                _check_database(temporary)
                os.replace(temporary, target)
                for suffix in ("-wal", "-shm"):
                    Path(f"{temporary}{suffix}").unlink(missing_ok=True)

            _check_database(target)
            _remove_obsolete_migration_meta(target)
        except Exception:
            for suffix in ("-wal", "-shm", ""):
                Path(f"{temporary}{suffix}").unlink(missing_ok=True)
            if created_target:
                target.unlink(missing_ok=True)
            raise
        for suffix in ("-wal", "-shm", ""):
            Path(f"{legacy}{suffix}").unlink(missing_ok=True)
    return target


class LibraryStore:
    def __init__(self, path: Path | None = None, user_id: str | None = None) -> None:
        if path is None and user_id is None:
            raise ValueError("user_id is required when no library path is supplied")
        self.path = path or prepare_user_library(str(user_id))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;

                CREATE TABLE IF NOT EXISTS library_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS notebooks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pages (
                    id TEXT PRIMARY KEY,
                    notebook_id TEXT REFERENCES notebooks(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    language TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'user',
                    metadata_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_pages_created_at
                    ON pages(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_pages_notebook_id
                    ON pages(notebook_id);

                CREATE TABLE IF NOT EXISTS annotations (
                    id TEXT PRIMARY KEY,
                    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                    type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    start_index INTEGER NOT NULL,
                    end_index INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_annotations_page_id
                    ON annotations(page_id);
                CREATE INDEX IF NOT EXISTS idx_annotations_created_at
                    ON annotations(created_at DESC);
                """
            )
            connection.execute(
                "INSERT OR IGNORE INTO library_meta(key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            connection.execute(
                "INSERT OR IGNORE INTO library_meta(key, value) VALUES ('library_id', ?)",
                (str(uuid.uuid4()),),
            )
            connection.commit()

    @staticmethod
    def _parse_json(value: str, fallback: Any) -> Any:
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return fallback

    @classmethod
    def _page_summary(cls, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "notebook_id": row["notebook_id"],
            "language": row["language"],
            "source": row["source"],
            "metadata": cls._parse_json(row["metadata_json"], []),
        }

    @staticmethod
    def _notebook(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _annotation(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "page_id": row["page_id"],
            "type": row["type"],
            "content": row["content"],
            "start_index": row["start_index"],
            "end_index": row["end_index"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_pages(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM pages ORDER BY created_at DESC, id DESC"
            ).fetchall()
        return [self._page_summary(row) for row in rows]

    def list_notebooks(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM notebooks ORDER BY created_at DESC, id DESC"
            ).fetchall()
        return [self._notebook(row) for row in rows]

    def get_page(self, page_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM pages WHERE id = ?", (page_id,)
            ).fetchone()
            if row is None:
                return None
            annotations = connection.execute(
                "SELECT * FROM annotations WHERE page_id = ? ORDER BY created_at DESC, id DESC",
                (page_id,),
            ).fetchall()
        result = self._page_summary(row)
        result["result"] = self._parse_json(row["result_json"], {})
        result["annotations"] = [self._annotation(item) for item in annotations]
        return result

    def create_page(self, payload: dict[str, Any]) -> str:
        page_id = str(payload.get("id") or uuid.uuid4())
        now = utc_now()
        created_at = str(payload.get("created_at") or now)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO pages(
                    id, notebook_id, name, result_json, language, source,
                    metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    page_id,
                    payload.get("notebook_id"),
                    str(payload.get("name") or ""),
                    json.dumps(payload["result"], ensure_ascii=False),
                    str(payload["language"]),
                    str(payload.get("source") or "user"),
                    json.dumps(payload.get("metadata") or [], ensure_ascii=False),
                    created_at,
                    str(payload.get("updated_at") or created_at),
                ),
            )
            connection.commit()
        return page_id

    def create_notebook(self, name: str, notebook_id: str | None = None) -> dict[str, Any]:
        next_id = notebook_id or str(uuid.uuid4())
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO notebooks(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (next_id, name.strip(), now, now),
            )
            connection.commit()
        return {"id": next_id, "name": name.strip(), "created_at": now, "updated_at": now}

    def rename_page(self, page_id: str, name: str) -> bool:
        return self._update_name("pages", page_id, name)

    def rename_notebook(self, notebook_id: str, name: str) -> bool:
        return self._update_name("notebooks", notebook_id, name)

    def _update_name(self, table: str, item_id: str, name: str) -> bool:
        if table not in {"pages", "notebooks"}:
            raise ValueError("invalid table")
        with self.connect() as connection:
            cursor = connection.execute(
                f"UPDATE {table} SET name = ?, updated_at = ? WHERE id = ?",
                (name.strip(), utc_now(), item_id),
            )
            connection.commit()
        return cursor.rowcount > 0

    def delete_page(self, page_id: str) -> bool:
        return self._delete("pages", page_id)

    def delete_notebook(self, notebook_id: str) -> bool:
        return self._delete("notebooks", notebook_id)

    def _delete(self, table: str, item_id: str) -> bool:
        if table not in {"pages", "notebooks"}:
            raise ValueError("invalid table")
        with self.connect() as connection:
            cursor = connection.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
            connection.commit()
        return cursor.rowcount > 0

    def move_pages(self, page_ids: list[str], notebook_id: str | None) -> None:
        now = utc_now()
        with self.connect() as connection:
            connection.executemany(
                "UPDATE pages SET notebook_id = ?, updated_at = ? WHERE id = ?",
                [(notebook_id, now, page_id) for page_id in page_ids],
            )
            connection.commit()

    def update_metadata(self, page_id: str, metadata: list[str]) -> list[str]:
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE pages SET metadata_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(metadata, ensure_ascii=False), utc_now(), page_id),
            )
            connection.commit()
        if cursor.rowcount == 0:
            raise KeyError(page_id)
        return metadata

    def create_annotation(self, payload: dict[str, Any]) -> dict[str, Any]:
        annotation_id = str(payload.get("id") or uuid.uuid4())
        now = utc_now()
        created_at = str(payload.get("created_at") or now)
        annotation = {
            "id": annotation_id,
            "page_id": str(payload["page_id"]),
            "type": str(payload["type"]),
            "content": str(payload["content"]),
            "start_index": int(payload["start_index"]),
            "end_index": int(payload["end_index"]),
            "created_at": created_at,
            "updated_at": str(payload.get("updated_at") or created_at),
        }
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO annotations(
                    id, page_id, type, content, start_index, end_index,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                tuple(annotation.values()),
            )
            connection.commit()
        return annotation

    def update_annotation(self, annotation_id: str, content: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE annotations SET content = ?, updated_at = ? WHERE id = ?",
                (content, utc_now(), annotation_id),
            )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM annotations WHERE id = ?", (annotation_id,)
            ).fetchone()
        return self._annotation(row) if row else None

    def delete_annotation(self, annotation_id: str) -> bool:
        return self._delete_annotation(annotation_id)

    def _delete_annotation(self, annotation_id: str) -> bool:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM annotations WHERE id = ?", (annotation_id,)
            )
            connection.commit()
        return cursor.rowcount > 0

    def list_annotations(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT a.*, p.name AS page_name, p.source AS page_source, p.result_json
                FROM annotations a
                JOIN pages p ON p.id = a.page_id
                ORDER BY a.created_at DESC, a.id DESC
                """
            ).fetchall()
        items = []
        for row in rows:
            result = self._parse_json(row["result_json"], {})
            text = str(result.get("text") or "")
            tokens = text.split()
            source = " ".join(tokens[row["start_index"] : row["end_index"] + 1])
            annotation = self._annotation(row)
            annotation.update({
                "page_name": row["page_name"],
                "source": source or row["page_source"],
            })
            items.append(annotation)
        return items

    def get_meta(self, key: str) -> str | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT value FROM library_meta WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO library_meta(key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )
            connection.commit()

    def export_bundle(self) -> dict[str, Any]:
        with self.connect() as connection:
            notebooks = [dict(row) for row in connection.execute("SELECT * FROM notebooks")]
            pages = [dict(row) for row in connection.execute("SELECT * FROM pages")]
            annotations = [dict(row) for row in connection.execute("SELECT * FROM annotations")]
        for page in pages:
            page["result"] = self._parse_json(page.pop("result_json"), {})
            page["metadata"] = self._parse_json(page.pop("metadata_json"), [])
        return {
            "format": "lema-library",
            "version": SCHEMA_VERSION,
            "library_id": self.get_meta("library_id"),
            "exported_at": utc_now(),
            "notebooks": notebooks,
            "pages": pages,
            "annotations": annotations,
        }

    @staticmethod
    def _content_hash(item: dict[str, Any], ignored: set[str] | None = None) -> str:
        omitted = ignored or set()
        value = {key: item[key] for key in sorted(item) if key not in omitted}
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def import_bundle(self, bundle: dict[str, Any]) -> dict[str, int]:
        if bundle.get("format") != "lema-library":
            raise ValueError("unsupported library format")
        if int(bundle.get("version") or 0) > SCHEMA_VERSION:
            raise ValueError("library was created by a newer version of Lema")

        self._backup_before_import()
        counts = {"notebooks": 0, "pages": 0, "annotations": 0, "conflicts": 0}
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                notebook_id_map: dict[str, str] = {}
                for item in bundle.get("notebooks") or []:
                    inserted_id, inserted = self._merge_notebook(connection, item, counts)
                    notebook_id_map[str(item["id"])] = inserted_id
                    counts["notebooks"] += inserted
                page_id_map: dict[str, str] = {}
                for item in bundle.get("pages") or []:
                    next_item = dict(item)
                    notebook_id = item.get("notebook_id")
                    if notebook_id is not None:
                        next_item["notebook_id"] = notebook_id_map.get(
                            str(notebook_id), str(notebook_id)
                        )
                    inserted_id, inserted = self._merge_page(connection, next_item, counts)
                    page_id_map[str(item["id"])] = inserted_id
                    counts["pages"] += inserted
                for item in bundle.get("annotations") or []:
                    next_item = dict(item)
                    next_item["page_id"] = page_id_map.get(
                        str(item["page_id"]), str(item["page_id"])
                    )
                    counts["annotations"] += self._merge_annotation(connection, next_item, counts)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return counts

    def _backup_before_import(self) -> None:
        backup_dir = self.path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = backup_dir / f"lema-before-import-{timestamp}.sqlite"
        with self.connect() as source, sqlite3.connect(backup_path) as destination:
            source.backup(destination)

    def _merge_notebook(
        self, connection: sqlite3.Connection, item: dict[str, Any], counts: dict[str, int]
    ) -> tuple[str, int]:
        existing = connection.execute(
            "SELECT * FROM notebooks WHERE id = ?", (str(item["id"]),)
        ).fetchone()
        normalized = {
            "id": str(item["id"]),
            "name": str(item.get("name") or ""),
            "created_at": str(item.get("created_at") or utc_now()),
            "updated_at": str(item.get("updated_at") or item.get("created_at") or utc_now()),
        }
        if existing and self._content_hash(dict(existing)) == self._content_hash(normalized):
            return normalized["id"], 0
        if existing:
            normalized["id"] = str(uuid.uuid4())
            normalized["name"] = f"{normalized['name']} (imported conflict)"
            counts["conflicts"] += 1
        connection.execute(
            "INSERT INTO notebooks(id, name, created_at, updated_at) VALUES (:id, :name, :created_at, :updated_at)",
            normalized,
        )
        return normalized["id"], 1

    def _merge_page(
        self, connection: sqlite3.Connection, item: dict[str, Any], counts: dict[str, int]
    ) -> tuple[str, int]:
        original_id = str(item["id"])
        existing = connection.execute("SELECT * FROM pages WHERE id = ?", (original_id,)).fetchone()
        normalized = {
            "id": original_id,
            "notebook_id": item.get("notebook_id"),
            "name": str(item.get("name") or ""),
            "result_json": json.dumps(item.get("result") or {}, ensure_ascii=False),
            "language": str(item.get("language") or ""),
            "source": str(item.get("source") or "user"),
            "metadata_json": json.dumps(item.get("metadata") or [], ensure_ascii=False),
            "created_at": str(item.get("created_at") or utc_now()),
            "updated_at": str(item.get("updated_at") or item.get("created_at") or utc_now()),
        }
        if existing and self._content_hash(dict(existing)) == self._content_hash(normalized):
            return original_id, 0
        if existing:
            normalized["id"] = str(uuid.uuid4())
            normalized["name"] = f"{normalized['name']} (imported conflict)"
            counts["conflicts"] += 1
        connection.execute(
            """
            INSERT INTO pages(
                id, notebook_id, name, result_json, language, source,
                metadata_json, created_at, updated_at
            ) VALUES (
                :id, :notebook_id, :name, :result_json, :language, :source,
                :metadata_json, :created_at, :updated_at
            )
            """,
            normalized,
        )
        return normalized["id"], 1

    def _merge_annotation(
        self, connection: sqlite3.Connection, item: dict[str, Any], counts: dict[str, int]
    ) -> int:
        existing = connection.execute(
            "SELECT * FROM annotations WHERE id = ?", (str(item["id"]),)
        ).fetchone()
        normalized = {
            "id": str(item["id"]),
            "page_id": str(item["page_id"]),
            "type": str(item.get("type") or "memo"),
            "content": str(item.get("content") or ""),
            "start_index": int(item.get("start_index") or 0),
            "end_index": int(item.get("end_index") or 0),
            "created_at": str(item.get("created_at") or utc_now()),
            "updated_at": str(item.get("updated_at") or item.get("created_at") or utc_now()),
        }
        if existing and self._content_hash(dict(existing)) == self._content_hash(normalized):
            return 0
        if existing:
            normalized["id"] = str(uuid.uuid4())
            counts["conflicts"] += 1
        connection.execute(
            """
            INSERT INTO annotations(
                id, page_id, type, content, start_index, end_index,
                created_at, updated_at
            ) VALUES (
                :id, :page_id, :type, :content, :start_index, :end_index,
                :created_at, :updated_at
            )
            """,
            normalized,
        )
        return 1
