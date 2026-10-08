import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from db import (
    SQLITE_BUSY_TIMEOUT_MS,
    create_sqlite_engine,
    resolve_database_path,
    validate_database_path,
)


class DatabaseConfigurationTests(unittest.TestCase):
    def test_configured_database_path_must_be_absolute(self):
        with patch.dict(
            os.environ,
            {"CENTRAL_DATABASE_PATH": "relative/user.db"},
        ):
            with self.assertRaisesRegex(RuntimeError, "must be an absolute path"):
                resolve_database_path()

    def test_configured_database_must_already_exist(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.db"

            with self.assertRaisesRegex(RuntimeError, "refusing to create"):
                validate_database_path(path, require_existing=True)

            self.assertFalse(path.exists())

    def test_database_directory_must_exist(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing" / "user.db"

            with self.assertRaisesRegex(RuntimeError, "does not exist"):
                validate_database_path(path, require_existing=True)

    def test_database_directory_must_be_writable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "user.db"
            path.touch()

            with patch("db.os.access", return_value=False):
                with self.assertRaisesRegex(RuntimeError, "is not writable"):
                    validate_database_path(path, require_existing=True)

    def test_sqlite_connections_enable_operational_pragmas(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.db"
            engine = create_sqlite_engine(path)
            try:
                with engine.connect() as connection:
                    journal_mode = connection.exec_driver_sql(
                        "PRAGMA journal_mode"
                    ).scalar_one()
                    busy_timeout = connection.exec_driver_sql(
                        "PRAGMA busy_timeout"
                    ).scalar_one()
                    foreign_keys = connection.exec_driver_sql(
                        "PRAGMA foreign_keys"
                    ).scalar_one()

                self.assertEqual(journal_mode.lower(), "wal")
                self.assertEqual(busy_timeout, SQLITE_BUSY_TIMEOUT_MS)
                self.assertEqual(foreign_keys, 1)
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
