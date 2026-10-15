"""Install the English SQLite pack required by the public landing demo.

This intentionally does not install NLP models or packs for the mobile app.
Those packs are installed on Android devices, while Electron uses its local
backend installer.
"""

from __future__ import annotations

import shutil
import sqlite3
import sys
import zipfile
from pathlib import Path

import requests


CENTRAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = CENTRAL_DIR.parent
DATA_DIR = CENTRAL_DIR / "data" / "static" / "en"
TEMP_DIR = CENTRAL_DIR / "tmp_packs"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from shared.manifests import PACKS  # noqa: E402
from language_config.sqlite_pack import find_pack_db  # noqa: E402


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def latest_english_pack() -> dict:
    candidates = [pack for pack in PACKS if pack["lang"] == "en"]
    if not candidates:
        raise RuntimeError("The shared manifest does not contain an English pack")
    return max(candidates, key=lambda pack: version_key(pack["version"]))


def has_valid_pack(version_dir: Path) -> bool:
    db_path = find_pack_db(version_dir)
    if db_path is None:
        return False

    try:
        with sqlite3.connect(db_path) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
    except sqlite3.Error:
        return False

    return {"lines", "lemma_stats"}.issubset(tables)


def download(url: str, destination: Path) -> None:
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    output.write(chunk)


def extract(zip_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()

    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            target = (destination / member.filename).resolve()
            if not target.is_relative_to(destination_root):
                raise RuntimeError(f"Refusing unsafe archive path: {member.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def remove_other_versions(keep: str) -> None:
    if not DATA_DIR.exists():
        return
    for path in DATA_DIR.iterdir():
        if path.is_dir() and path.name != keep:
            shutil.rmtree(path)


def main() -> None:
    pack = latest_english_pack()
    version = pack["version"]
    destination = DATA_DIR / version

    if has_valid_pack(destination):
        remove_other_versions(version)
        print(f"English landing pack is current ({version})")
        return

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = TEMP_DIR / pack["lemma_filename"]

    try:
        print(f"Downloading English landing pack {version}")
        download(pack["lemma_download_url"], archive_path)
        shutil.rmtree(destination, ignore_errors=True)
        extract(archive_path, destination)
    finally:
        archive_path.unlink(missing_ok=True)

    if not has_valid_pack(destination):
        raise RuntimeError(f"English pack {version} is incomplete after installation")

    remove_other_versions(version)
    print(f"Installed English landing pack {version}")


if __name__ == "__main__":
    main()
