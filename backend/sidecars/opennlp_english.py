from __future__ import annotations

import atexit
import base64
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path


class OpenNlpSidecarError(RuntimeError):
    pass


class EnglishOpenNlpSidecar:
    """Persistent stdio bridge to the shared Java English analyzer."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._model_dir: Path | None = None

    def analyze(self, text: str, model_dir: Path) -> list[dict]:
        with self._lock:
            self._ensure_started(model_dir)
            assert self._process is not None
            assert self._process.stdin is not None
            assert self._process.stdout is not None
            payload = base64.b64encode(text.encode("utf-8")).decode("ascii")
            try:
                self._process.stdin.write(payload + "\n")
                self._process.stdin.flush()
                raw_response = self._process.stdout.readline()
            except OSError as exc:
                self.close()
                raise OpenNlpSidecarError(f"English analyzer sidecar stopped: {exc}") from exc
            if not raw_response:
                self.close()
                raise OpenNlpSidecarError("English analyzer sidecar stopped without a response")
            try:
                response = json.loads(raw_response)
            except json.JSONDecodeError as exc:
                raise OpenNlpSidecarError("English analyzer sidecar returned invalid JSON") from exc
            if not isinstance(response, dict):
                raise OpenNlpSidecarError("English analyzer sidecar returned an invalid response")
            if response.get("error"):
                raise OpenNlpSidecarError(str(response["error"]))
            tokens = response.get("tokens")
            if not isinstance(tokens, list):
                raise OpenNlpSidecarError("English analyzer sidecar response has no tokens")
            return [token for token in tokens if isinstance(token, dict)]

    def _ensure_started(self, model_dir: Path) -> None:
        if (
            self._process is not None
            and self._process.poll() is None
            and self._model_dir == model_dir
        ):
            return
        self.close()
        java, jar = _sidecar_paths()
        self._process = subprocess.Popen(
            [str(java), "-jar", str(jar), "--model-dir", str(model_dir)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._model_dir = model_dir

    def close(self) -> None:
        process = self._process
        self._process = None
        self._model_dir = None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def _sidecar_paths() -> tuple[Path, Path]:
    jar_value = os.getenv("LEMA_OPENNLP_SIDECAR_JAR")
    if jar_value:
        jar = Path(jar_value)
    else:
        root = Path(__file__).resolve().parents[2]
        jar = root / "desktop-sidecar" / "dist" / "lema-opennlp-sidecar.jar"
    java_value = os.getenv("LEMA_OPENNLP_SIDECAR_JAVA")
    java = Path(java_value) if java_value else Path(shutil.which("java") or "")
    if not jar.is_file():
        raise OpenNlpSidecarError(
            f"English analyzer sidecar is missing: {jar}. Run scripts/build-opennlp-sidecar.sh."
        )
    if not java.is_file():
        raise OpenNlpSidecarError("A Java runtime for the English analyzer was not found")
    return java, jar


sidecar = EnglishOpenNlpSidecar()
atexit.register(sidecar.close)
