import json
import sqlite3
import threading
from pathlib import Path


PACK_DB_SUFFIXES = (".sqlite3", ".sqlite", ".db")
LEMMA_DB_NAMES = (
    "lemma_pack.sqlite3",
    "lemma_pack.sqlite",
    "lemma_pack.db",
    "language_pack.sqlite3",
    "language_pack.sqlite",
    "language_pack.db",
    "pack.sqlite3",
    "pack.sqlite",
    "pack.db",
)


def find_pack_db(version_path: Path) -> Path | None:
    if not version_path.is_dir():
        return None

    candidates = [
        path
        for path in sorted(version_path.iterdir())
        if path.is_file() and path.suffix.lower() in PACK_DB_SUFFIXES
    ]
    preferred_order = {name: index for index, name in enumerate(LEMMA_DB_NAMES)}
    candidates = [path for path in candidates if path.name in preferred_order]
    if not candidates:
        return None
    return min(candidates, key=lambda path: (preferred_order[path.name], path.name))


class LanguagePackDB:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._local = threading.local()

    def _connection(self) -> sqlite3.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = sqlite3.connect(self.db_path, check_same_thread=False)
            connection.row_factory = sqlite3.Row
            self._local.connection = connection
        return connection

    def close(self) -> None:
        connection = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None

    def _payload(self, table: str, key_column: str, key: str):
        try:
            row = self._connection().execute(
                f"SELECT payload FROM {table} WHERE {key_column} = ?", (key,)
            ).fetchone()
        except sqlite3.Error:
            return None
        if row is None:
            return None
        try:
            return json.loads(row["payload"])
        except (TypeError, json.JSONDecodeError):
            return None

    def _payloads(self, table: str, key_column: str, keys: list[str]) -> dict:
        if not keys:
            return {}

        result = {}
        for start in range(0, len(keys), 900):
            chunk = keys[start:start + 900]
            placeholders = ",".join("?" for _ in chunk)
            try:
                rows = self._connection().execute(
                    f"SELECT {key_column} AS key, payload FROM {table} "
                    f"WHERE {key_column} IN ({placeholders})",
                    chunk,
                ).fetchall()
            except sqlite3.Error:
                continue
            for row in rows:
                try:
                    result[row["key"]] = json.loads(row["payload"])
                except (TypeError, json.JSONDecodeError):
                    continue
        return result

    def has_lemma_key(self, key: str) -> bool:
        try:
            return self._connection().execute(
                "SELECT 1 FROM lemma_stats WHERE lemma_key = ? LIMIT 1", (key,)
            ).fetchone() is not None
        except sqlite3.Error:
            return False

    def get_line_ids(self, key: str) -> list[str]:
        payload = self._payload("lemma_stats", "lemma_key", key)
        line_ids = payload.get("lines", []) if isinstance(payload, dict) else []
        return line_ids if isinstance(line_ids, list) else []

    def get_furigana(self, key: str) -> str | None:
        payload = self._payload("lemma_stats", "lemma_key", key)
        value = payload.get("furigana") if isinstance(payload, dict) else None
        return value.strip() if isinstance(value, str) and value.strip() else None

    def get_lemma_frequencies(self, keys: list[str]) -> dict[str, int]:
        result = {}
        for key, payload in self._payloads("lemma_stats", "lemma_key", keys).items():
            frequency = payload.get("freq") if isinstance(payload, dict) else None
            if isinstance(frequency, int) and frequency > 0:
                result[key] = frequency
        return result

    def get_lines(self, line_ids: list[str]) -> list[dict]:
        payloads = self._payloads("lines", "line_id", line_ids)
        result = []
        for line_id in line_ids:
            payload = payloads.get(line_id)
            if isinstance(payload, dict):
                if "line_id" not in payload:
                    payload = {"line_id": line_id, **payload}
                result.append(payload)
        return result
