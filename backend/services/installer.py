import os
import requests
import zipfile
import tempfile
import io
import re
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv
import shutil
from language_config.model_store import ensure_model_installed, model_installed, remove_models
from language_config.registry import invalidate_language as invalidate_nlp_language
from language_config.sqlite_pack import (
    LEMMA_TABLES,
    find_lemma_db,
    has_required_tables,
)
from runtime_paths import get_runtime_state_root, get_static_data_root
from shared.manifests import (
    get_runtime_state_snapshot,
    mark_runtime_consumers,
    release_runtime,
)
from shared.services.lemma_service import invalidate_language as invalidate_lemma_language

load_dotenv()

DATA_DIR = get_static_data_root()
STATE_ROOT = get_runtime_state_root()

progress_map = {}
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
TQDM_PERCENT_RE = re.compile(r"(?P<percent>\d{1,3})%\|")
TQDM_BYTES_RE = re.compile(
    r"(?P<current>\d+(?:\.\d+)?[KMG]?)/(?P<total>\d+(?:\.\d+)?[KMG]?)"
)
DOWNLOAD_URL_RE = re.compile(r"Downloading\s+(?P<url>https?://\S+?)(?::\s|$)")


def get_install_state(lang: str, version: str):
    path = DATA_DIR / lang / version
    lemma_db_path = find_lemma_db(path)
    model_ready = model_installed(lang)

    lemma_data_ready = (
        lemma_db_path is not None
        and has_required_tables(lemma_db_path, LEMMA_TABLES)
    )
    lemma_installed = lemma_data_ready and model_ready
    return {
        # The lemma database belongs to this exact pack version, while the
        # analyzer model is shared by every version of the same language.
        "lemma_data_installed": lemma_data_ready,
        "lemma_installed": lemma_installed,
        "model_installed": model_ready,
        "installed": lemma_installed and model_ready,
        "runtime_state": get_runtime_state_snapshot(STATE_ROOT, lang),
    }


def invalidate_runtime(lang: str):
    invalidate_nlp_language(lang)
    invalidate_lemma_language(lang)


def clear_existing_install_target(lang: str, version: str):
    path = DATA_DIR / lang / version

    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def set_progress(task_id: str, progress: float, status: str, **extra):
    payload = {
        "progress": max(0.0, min(progress, 1.0)),
        "status": status,
    }
    payload.update(extra)
    progress_map[task_id] = payload


def parse_model_download_output(text: str):
    line = ANSI_ESCAPE_RE.sub("", text).strip()

    if not line:
        return None

    normalized = " ".join(line.split())
    percent_match = TQDM_PERCENT_RE.search(normalized)
    bytes_match = TQDM_BYTES_RE.search(normalized)
    model_name = extract_model_name(normalized)

    if not percent_match and not bytes_match:
        if model_name is None:
            return None

        return {
            "detail": normalized,
            "model_name": model_name,
        }

    parsed = {
        "detail": normalized,
        "model_name": model_name,
    }

    if percent_match:
        parsed["percent"] = max(
            0,
            min(100, int(percent_match.group("percent"))),
        )

    if bytes_match:
        parsed["bytes"] = f"{bytes_match.group('current')}/{bytes_match.group('total')}"

    return parsed


def extract_model_name(text: str) -> str | None:
    url_match = DOWNLOAD_URL_RE.search(text)

    if not url_match:
        return None

    url_path = urlparse(url_match.group("url")).path
    basename = Path(url_path).name.strip()

    if not basename:
        return None

    if basename.endswith(".zip"):
        return basename[:-4]

    return basename


class ProgressCaptureStream(io.TextIOBase):
    def __init__(self, task_id: str):
        self.task_id = task_id
        self._buffer = ""

    def writable(self):
        return True

    def write(self, text):
        if not text:
            return 0

        self._buffer += text
        self._flush_complete_segments()
        return len(text)

    def flush(self):
        self._flush_buffer(force=True)

    def _flush_complete_segments(self):
        segments = re.split(r"[\r\n]", self._buffer)

        if len(segments) <= 1:
            return

        for segment in segments[:-1]:
            self._publish(segment)

        self._buffer = segments[-1]

    def _flush_buffer(self, force=False):
        if force and self._buffer:
            self._publish(self._buffer)
            self._buffer = ""

    def _publish(self, raw_text: str):
        parsed = parse_model_download_output(raw_text)

        if not parsed:
            return

        detail = parsed.get("detail")
        percent = parsed.get("percent")
        bytes_text = parsed.get("bytes")
        model_name = parsed.get("model_name")

        if percent is None:
            set_progress(
                self.task_id,
                progress_map[self.task_id]["progress"],
                "installing_model",
                phase="model",
                detail=detail,
                bytes=bytes_text,
                model_name=model_name,
            )
            return

        base_progress = 0.94
        span = 0.05
        model_progress = base_progress + span * (percent / 100)

        set_progress(
            self.task_id,
            model_progress,
            "installing_model",
            phase="model",
            detail=detail,
            bytes=bytes_text,
            model_percent=percent,
            model_name=model_name,
        )


def install_model_with_progress(lang: str, task_id: str):
    capture = ProgressCaptureStream(task_id)

    with redirect_stderr(capture), redirect_stdout(capture):
        ensure_model_installed(lang)

    capture.flush()
    mark_runtime_consumers(STATE_ROOT, lang)


def install_pack(
    lang: str,
    version: str,
    filename: str | None,
    task_id: str,
    download_url: str | None = None,
):
    set_progress(task_id, 0.0, "downloading_pack", phase="pack")

    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        invalidate_runtime(lang)

        if not filename:
            raise Exception("filename is required for pack install")

        clear_existing_install_target(lang, version)

        if not download_url:
            raise Exception("download_url is required")

        # 1. download
        r = requests.get(download_url, stream=True)

        if r.status_code != 200:
            raise Exception(f"download failed: {r.status_code}")

        total = int(r.headers.get("content-length", 0))
        downloaded = 0

        tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")

        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                tmp_zip.write(chunk)
                downloaded += len(chunk)

                if total:
                    set_progress(
                        task_id,
                        downloaded / total,
                        "downloading_pack",
                        phase="pack",
                    )
                else:
                    current_progress = progress_map[task_id]["progress"]
                    set_progress(
                        task_id,
                        min(0.9, current_progress + 0.01),
                        "downloading_pack",
                        phase="pack",
                    )

        tmp_zip.close()

        set_progress(
            task_id,
            max(progress_map[task_id]["progress"], 0.92),
            "extracting_pack",
            phase="pack",
        )

        # 2. unzip
        extract_path = DATA_DIR / lang / version
        os.makedirs(extract_path, exist_ok=True)

        with zipfile.ZipFile(tmp_zip.name, "r") as zip_ref:
            for member in zip_ref.infolist():
                name = member.filename

                if name.startswith("__MACOSX/") or "/__MACOSX/" in name:
                    continue

                if member.is_dir():
                    continue

                parts = name.split("/", 1)
                new_name = parts[1] if len(parts) == 2 else parts[0]

                if not new_name or new_name.strip() == "":
                    continue

                if ".." in new_name:
                    continue

                target_path = extract_path / new_name
                target_path.parent.mkdir(parents=True, exist_ok=True)
                if target_path.exists():
                    target_path.unlink()

                with zip_ref.open(member, "r") as src, open(target_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)

        # tmp 파일 삭제
        os.remove(tmp_zip.name)

        if not verify_install(lang, version):
            raise Exception("install corrupted")

        set_progress(task_id, 0.94, "installing_model", phase="model")
        install_model_with_progress(lang, task_id)
        set_progress(task_id, 0.99, "verifying_install", phase="finalizing")

        set_progress(task_id, 1.0, "done", phase="done")

        invalidate_runtime(lang)

        return str(extract_path)

    except Exception as e:
        set_progress(task_id, 0.0, "error", error=str(e))
        raise e


def language_has_installed_lemma_pack(lang: str) -> bool:
    lang_root = DATA_DIR / lang

    if not lang_root.exists():
        return False

    for version_dir in lang_root.iterdir():
        if not version_dir.is_dir():
            continue

        lemma_db_path = find_lemma_db(version_dir)
        if lemma_db_path is None:
            continue

        if has_required_tables(lemma_db_path, LEMMA_TABLES):
            return True

    return False


def uninstall_pack(lang: str, version: str):
    invalidate_runtime(lang)
    path = DATA_DIR / lang / version

    if path.exists():
        shutil.rmtree(path, ignore_errors=True)

    if not language_has_installed_lemma_pack(lang):
        release_runtime(STATE_ROOT, lang)
        remove_models(lang)

def is_installed(lang: str, version: str):
    return get_install_state(lang, version)["installed"]


def verify_install(lang: str, version: str):
    path = DATA_DIR / lang / version

    lemma_db_path = find_lemma_db(path)
    if lemma_db_path is None:
        return False
    return has_required_tables(lemma_db_path, LEMMA_TABLES)
