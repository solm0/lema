import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SQLITE_BUSY_TIMEOUT_MS = 10_000


def resolve_database_path() -> tuple[Path, bool]:
    configured_path = os.getenv("CENTRAL_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path).expanduser()
        if not path.is_absolute():
            raise RuntimeError("CENTRAL_DATABASE_PATH must be an absolute path")
        return path.resolve(), True

    return (BASE_DIR / "user.db").resolve(), False


def validate_database_path(path: Path, *, require_existing: bool) -> None:
    parent = path.parent
    if not parent.exists():
        raise RuntimeError(f"Database directory does not exist: {parent}")
    if not parent.is_dir():
        raise RuntimeError(f"Database parent is not a directory: {parent}")
    if not os.access(parent, os.W_OK | os.X_OK):
        raise RuntimeError(f"Database directory is not writable: {parent}")

    if not path.exists():
        if require_existing:
            raise RuntimeError(
                "Configured database file does not exist; refusing to create an "
                f"empty database: {path}"
            )
        return

    if not path.is_file():
        raise RuntimeError(f"Database path is not a regular file: {path}")
    if not os.access(path, os.R_OK | os.W_OK):
        raise RuntimeError(f"Database file is not readable and writable: {path}")


def create_sqlite_engine(path: Path):
    sqlite_engine = create_engine(
        f"sqlite:///{path}",
        connect_args={
            "check_same_thread": False,
            "timeout": SQLITE_BUSY_TIMEOUT_MS / 1000,
        },
    )

    @event.listens_for(sqlite_engine, "first_connect")
    def enable_wal(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        try:
            journal_mode = cursor.execute("PRAGMA journal_mode = WAL").fetchone()[0]
            if str(journal_mode).lower() != "wal":
                raise RuntimeError(
                    f"Failed to enable SQLite WAL mode for database: {path}"
                )
        finally:
            cursor.close()

    @event.listens_for(sqlite_engine, "connect")
    def set_connection_pragmas(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
            cursor.execute("PRAGMA foreign_keys = ON")
        finally:
            cursor.close()

    return sqlite_engine


DATABASE_PATH, DATABASE_PATH_IS_CONFIGURED = resolve_database_path()
validate_database_path(
    DATABASE_PATH,
    require_existing=DATABASE_PATH_IS_CONFIGURED,
)
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

engine = create_sqlite_engine(DATABASE_PATH)

SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
