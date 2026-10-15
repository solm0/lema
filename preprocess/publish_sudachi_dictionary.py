#!/usr/bin/env python3
"""Publish the verified Android Sudachi core dictionary to the pack dataset."""

from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from huggingface_hub import HfApi, hf_hub_url

from preprocess.publish_releases import call_with_retry, ensure_repo_exists, load_env


DICTIONARY_ENTRY = "system_core.dic"
DEFAULT_FILENAME = "sudachi-dictionary-20240409-core.zip"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--version", default="1.1.2")
    parser.add_argument("--filename", default=DEFAULT_FILENAME)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    archive = args.archive.resolve()
    if not archive.is_file():
        raise FileNotFoundError(f"Missing Sudachi dictionary archive: {archive}")
    with zipfile.ZipFile(archive) as bundle:
        if DICTIONARY_ENTRY not in bundle.namelist():
            raise ValueError(f"Archive must contain {DICTIONARY_ENTRY}")

    token, repo_id, repo_type = load_env()
    filename = Path(args.filename).name
    if not filename.endswith(".zip"):
        raise ValueError("--filename must be a ZIP filename")
    destination = f"language-packs/ja/{args.version}/{filename}"
    print(f"Uploading {archive.name} -> {destination}")
    print(f"SHA-256: {sha256(archive)}")

    api = HfApi(token=token)
    ensure_repo_exists(api, repo_id=repo_id, repo_type=repo_type)
    call_with_retry(
        "upload_file:sudachi-dictionary",
        api.upload_file,
        path_or_fileobj=str(archive),
        path_in_repo=destination,
        repo_id=repo_id,
        repo_type=repo_type,
        commit_message="Upload Japanese Sudachi dictionary for Android",
    )
    print(hf_hub_url(repo_id=repo_id, repo_type=repo_type, revision="main", filename=destination))


if __name__ == "__main__":
    main()
