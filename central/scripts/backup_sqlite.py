#!/usr/bin/env python3
import fcntl
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
EXPECTED_TABLES = (
    "users",
    "password_reset_tokens",
    "email_send_events",
    "user_lemmas",
)
logger = logging.getLogger("nautilus.sqlite_backup")


def positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


def absolute_path_env(name: str, *, default: str | None = None) -> Path:
    raw_value = os.getenv(name, default)
    if not raw_value:
        raise RuntimeError(f"{name} is required")
    path = Path(raw_value).expanduser()
    if not path.is_absolute():
        raise RuntimeError(f"{name} must be an absolute path")
    return path.resolve()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_source_database(path: Path) -> None:
    if not path.is_file():
        raise RuntimeError(f"SQLite database does not exist: {path}")
    if not os.access(path, os.R_OK):
        raise RuntimeError(f"SQLite database is not readable: {path}")


def database_counts(connection: sqlite3.Connection) -> dict[str, int]:
    existing_tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    missing_tables = set(EXPECTED_TABLES) - existing_tables
    if missing_tables:
        missing = ", ".join(sorted(missing_tables))
        raise RuntimeError(f"Backup is missing expected tables: {missing}")

    return {
        table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        for table in EXPECTED_TABLES
    }


def create_snapshot(
    database_path: Path,
    backup_dir: Path,
    *,
    created_at: datetime | None = None,
) -> tuple[Path, Path, dict[str, object]]:
    validate_source_database(database_path)
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not backup_dir.is_dir() or not os.access(backup_dir, os.W_OK | os.X_OK):
        raise RuntimeError(f"Backup directory is not writable: {backup_dir}")

    timestamp = created_at or datetime.now(UTC)
    timestamp = timestamp.astimezone(UTC)
    timestamp_text = timestamp.strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"user-{timestamp_text}.db"
    manifest_path = backup_path.with_suffix(".json")
    temporary_path = backup_dir / f".{backup_path.name}.tmp"

    if backup_path.exists() or manifest_path.exists():
        raise RuntimeError(f"Backup already exists for this timestamp: {backup_path}")

    source_uri = f"{database_path.as_uri()}?mode=ro"
    try:
        with sqlite3.connect(source_uri, uri=True, timeout=10) as source:
            source.execute("PRAGMA busy_timeout = 10000")
            with sqlite3.connect(temporary_path) as destination:
                source.backup(destination, pages=1_000, sleep=0.1)
                integrity = destination.execute("PRAGMA integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise RuntimeError(f"SQLite integrity check failed: {integrity}")
                counts = database_counts(destination)

        temporary_path.chmod(0o600)
        os.replace(temporary_path, backup_path)
        manifest = {
            "backup": backup_path.name,
            "created_at": timestamp.isoformat(),
            "sha256": sha256_file(backup_path),
            "size_bytes": backup_path.stat().st_size,
            "integrity_check": "ok",
            "row_counts": counts,
        }
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest_path.chmod(0o600)
        return backup_path, manifest_path, manifest
    except Exception:
        temporary_path.unlink(missing_ok=True)
        backup_path.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        raise


def upload_backups(backup_dir: Path, destination: str) -> None:
    rclone = shutil.which("rclone")
    if not rclone:
        raise RuntimeError("rclone is not installed or is not in PATH")

    include_args = ["--include", "user-*.db", "--include", "user-*.json"]
    subprocess.run(
        [
            rclone,
            "copy",
            str(backup_dir),
            destination,
            *include_args,
            "--checksum",
        ],
        check=True,
    )
    subprocess.run(
        [
            rclone,
            "check",
            str(backup_dir),
            destination,
            *include_args,
            "--checksum",
            "--one-way",
        ],
        check=True,
    )


def prune_local_backups(
    backup_dir: Path,
    *,
    retention_days: int,
    min_copies: int,
    now: datetime | None = None,
) -> list[Path]:
    cutoff = (now or datetime.now(UTC)).timestamp() - timedelta(
        days=retention_days
    ).total_seconds()
    backups = sorted(
        backup_dir.glob("user-*.db"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    removed: list[Path] = []
    for backup_path in backups[min_copies:]:
        if backup_path.stat().st_mtime >= cutoff:
            continue
        manifest_path = backup_path.with_suffix(".json")
        backup_path.unlink()
        manifest_path.unlink(missing_ok=True)
        removed.append(backup_path)
    return removed


@contextmanager
def backup_lock(backup_dir: Path):
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = backup_dir / ".backup.lock"
    with lock_path.open("a+") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("Another backup process is already running") from exc
        yield


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    load_dotenv(BASE_DIR / ".env")

    try:
        database_path = absolute_path_env("CENTRAL_DATABASE_PATH")
        backup_dir = absolute_path_env(
            "CENTRAL_BACKUP_DIR",
            default="/var/backups/nautilus",
        )
        rclone_destination = os.getenv("CENTRAL_BACKUP_RCLONE_DESTINATION")
        retention_days = positive_int_env("CENTRAL_BACKUP_RETENTION_DAYS", 35)
        min_copies = positive_int_env("CENTRAL_BACKUP_MIN_LOCAL_COPIES", 7)

        with backup_lock(backup_dir):
            backup_path, _, manifest = create_snapshot(database_path, backup_dir)
            logger.info(
                "SQLite snapshot created: %s rows=%s",
                backup_path,
                manifest["row_counts"],
            )
            if rclone_destination:
                upload_backups(backup_dir, rclone_destination)
                logger.info(
                    "Backups verified at rclone destination: %s",
                    rclone_destination,
                )
            else:
                logger.warning(
                    "Remote backup is disabled; snapshots are stored only on "
                    "this server"
                )
            removed = prune_local_backups(
                backup_dir,
                retention_days=retention_days,
                min_copies=min_copies,
            )
            if removed:
                logger.info("Pruned %d expired local backups", len(removed))
        return 0
    except Exception:
        logger.exception("SQLite backup failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
