import json
import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from scripts.backup_sqlite import (
    create_snapshot,
    main,
    prune_local_backups,
    upload_backups,
)


class SqliteBackupTests(unittest.TestCase):
    def create_database(self, path: Path) -> None:
        with sqlite3.connect(path) as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
                CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY);
                CREATE TABLE email_send_events (id INTEGER PRIMARY KEY);
                CREATE TABLE user_lemmas (id INTEGER PRIMARY KEY, lemma_key TEXT);
                INSERT INTO users (email) VALUES ('user@example.com');
                INSERT INTO user_lemmas (lemma_key) VALUES ('example');
                """
            )

    def test_snapshot_contains_wal_data_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database_path = root / "user.db"
            backup_dir = root / "backups"
            self.create_database(database_path)

            backup_path, manifest_path, manifest = create_snapshot(
                database_path,
                backup_dir,
                created_at=datetime(2026, 10, 8, 3, 0, tzinfo=UTC),
            )

            with sqlite3.connect(backup_path) as backup:
                self.assertEqual(
                    backup.execute("PRAGMA integrity_check").fetchone()[0],
                    "ok",
                )
                self.assertEqual(
                    backup.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                    1,
                )

            self.assertEqual(manifest["row_counts"]["users"], 1)
            self.assertEqual(manifest["row_counts"]["user_lemmas"], 1)
            self.assertEqual(json.loads(manifest_path.read_text()), manifest)

    def test_upload_copies_then_checks_without_deleting_remote_files(self):
        with tempfile.TemporaryDirectory() as directory:
            backup_dir = Path(directory)
            with (
                patch("scripts.backup_sqlite.shutil.which", return_value="/usr/bin/rclone"),
                patch("scripts.backup_sqlite.subprocess.run") as run,
            ):
                upload_backups(backup_dir, "gdrive:nautilus")

            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].args[0][1], "copy")
            self.assertEqual(run.call_args_list[1].args[0][1], "check")
            self.assertNotIn("sync", run.call_args_list[0].args[0])

    def test_main_supports_local_only_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database_path = root / "user.db"
            backup_dir = root / "backups"
            self.create_database(database_path)

            with (
                patch.dict(
                    os.environ,
                    {
                        "CENTRAL_DATABASE_PATH": str(database_path),
                        "CENTRAL_BACKUP_DIR": str(backup_dir),
                        "CENTRAL_BACKUP_RETENTION_DAYS": "35",
                        "CENTRAL_BACKUP_MIN_LOCAL_COPIES": "7",
                    },
                    clear=True,
                ),
                patch("scripts.backup_sqlite.upload_backups") as upload,
            ):
                result = main()

            self.assertEqual(result, 0)
            upload.assert_not_called()
            self.assertEqual(len(list(backup_dir.glob("user-*.db"))), 1)
            self.assertEqual(len(list(backup_dir.glob("user-*.json"))), 1)

    def test_prune_keeps_minimum_number_of_local_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            backup_dir = Path(directory)
            now = datetime(2026, 10, 8, tzinfo=UTC)
            paths = []
            for index in range(4):
                path = backup_dir / f"user-2026010{index + 1}T000000Z.db"
                path.touch()
                old_timestamp = (now - timedelta(days=100 + index)).timestamp()
                os.utime(path, (old_timestamp, old_timestamp))
                paths.append(path)

            removed = prune_local_backups(
                backup_dir,
                retention_days=35,
                min_copies=2,
                now=now,
            )

            self.assertEqual(len(removed), 2)
            self.assertEqual(len(list(backup_dir.glob("user-*.db"))), 2)


if __name__ == "__main__":
    unittest.main()
