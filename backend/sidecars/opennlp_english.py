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


class OpenNlpSidecar:
    """Persistent stdio bridge to a shared Java OpenNLP analyzer."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._signature: tuple[Path, str, Path | None] | None = None

    def analyze(self, text: str, model_dir: Path, language: str = "en", lemma_keys: Path | None = None) -> list[dict]:
        with self._lock:
            self._ensure_started(model_dir, language, lemma_keys)
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
                raise OpenNlpSidecarError(f"Java analyzer sidecar stopped: {exc}") from exc
            if not raw_response:
                details = ""
                if self._process.stderr is not None:
                    details = self._process.stderr.read().strip()
                self.close()
                message = "Java analyzer sidecar stopped without a response"
                if details:
                    message += f": {details}"
                raise OpenNlpSidecarError(message)
            try:
                response = json.loads(raw_response)
            except json.JSONDecodeError as exc:
                raise OpenNlpSidecarError("Java analyzer sidecar returned invalid JSON") from exc
            if not isinstance(response, dict):
                raise OpenNlpSidecarError("Java analyzer sidecar returned an invalid response")
            if response.get("error"):
                raise OpenNlpSidecarError(str(response["error"]))
            tokens = response.get("tokens")
            if not isinstance(tokens, list):
                raise OpenNlpSidecarError("Java analyzer sidecar response has no tokens")
            return [token for token in tokens if isinstance(token, dict)]

    def _ensure_started(self, model_dir: Path, language: str, lemma_keys: Path | None) -> None:
        if (
            self._process is not None
            and self._process.poll() is None
            and self._signature == (model_dir, language, lemma_keys)
        ):
            return
        self.close()
        java, jar = _sidecar_paths()
        self._process = subprocess.Popen(
            [str(java), "-jar", str(jar), "--language", language, "--model-dir", str(model_dir)]
            + (["--lemma-keys", str(lemma_keys)] if lemma_keys else []),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._signature = (model_dir, language, lemma_keys)

    def close(self) -> None:
        process = self._process
        self._process = None
        self._signature = None
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
        # Gradle output is current during backend development. Packaged builds
        # always pass LEMA_OPENNLP_SIDECAR_JAR and use desktop-sidecar/dist.
        development_jar = root / "nlp-java" / "desktop-sidecar" / "build" / "libs" / "lema-opennlp-sidecar-1.0.0.jar"
        packaged_dev_jar = root / "desktop-sidecar" / "dist" / "lema-opennlp-sidecar.jar"
        jar = development_jar if development_jar.is_file() else packaged_dev_jar
    java_value = os.getenv("LEMA_OPENNLP_SIDECAR_JAVA")
    java = Path(java_value) if java_value else Path(shutil.which("java") or "")
    if not jar.is_file():
        raise OpenNlpSidecarError(
            f"Java analyzer sidecar is missing: {jar}. Run scripts/build-opennlp-sidecar.sh."
        )
    if not java.is_file():
        raise OpenNlpSidecarError("A Java runtime for the Java analyzer was not found")
    return java, jar


sidecar = OpenNlpSidecar()
atexit.register(sidecar.close)
