"""Shared Android device operations for analyzer quality and performance runs."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]


def run(command: list[str], cwd: Path | None = None, capture: bool = False) -> str:
    print("+", " ".join(command), flush=True)
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if not capture:
        return ""
    return result.stdout.decode("utf-8", errors="replace").strip()


def find_adb() -> Path:
    executable = shutil.which("adb")
    if executable:
        return Path(executable)

    for variable in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
        root = os.environ.get(variable)
        if root:
            candidate = Path(root) / "platform-tools/adb"
            if candidate.is_file():
                return candidate

    properties = ROOT / "frontend/android/local.properties"
    if properties.is_file():
        for line in properties.read_text(encoding="utf-8").splitlines():
            if line.startswith("sdk.dir="):
                sdk_root = line.split("=", 1)[1].replace("\\:", ":").replace("\\\\", "\\")
                candidate = Path(sdk_root) / "platform-tools/adb"
                if candidate.is_file():
                    return candidate

    raise RuntimeError(
        "adb was not found; configure ANDROID_SDK_ROOT or frontend/android/local.properties"
    )


def build_and_install_test_apks(
    adb: Path,
    kiwi_model_archive: Path | None = None,
) -> None:
    android_root = ROOT / "frontend/android"
    gradle_command = ["./gradlew"]
    if kiwi_model_archive is not None:
        gradle_command.append(f"-PkiwiModelArchive={kiwi_model_archive.resolve()}")
    gradle_command.extend([
        ":app:assembleGradshowDebug",
        ":app:assembleGradshowDebugAndroidTest",
    ])
    run(
        gradle_command,
        cwd=android_root,
    )
    app_apk = android_root / "app/build/outputs/apk/gradshow/debug/app-gradshow-debug.apk"
    test_apk = (
        android_root
        / "app/build/outputs/apk/androidTest/gradshow/debug/app-gradshow-debug-androidTest.apk"
    )
    run([str(adb), "install", "-r", str(app_apk)])
    run([str(adb), "install", "-r", str(test_apk)])


def run_instrumentation(
    adb: Path,
    test_application_id: str,
    test_class: str,
    arguments: dict[str, str | int] | None = None,
) -> None:
    command = [
        str(adb),
        "shell",
        "am",
        "instrument",
        "-w",
        "-e",
        "class",
        test_class,
    ]
    for key, value in (arguments or {}).items():
        command.extend(["-e", key, str(value)])
    command.append(f"{test_application_id}/androidx.test.runner.AndroidJUnitRunner")
    run(command)


def pull_app_file(
    adb: Path,
    application_id: str,
    remote_path: str,
    destination: Path,
) -> None:
    result = subprocess.run(
        [
            str(adb),
            "exec-out",
            "run-as",
            application_id,
            "cat",
            remote_path,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    destination.write_bytes(result.stdout)
    if destination.stat().st_size == 0:
        raise RuntimeError(f"Android export was empty: {remote_path}")


def adb_property(adb: Path, name: str) -> str:
    return run([str(adb), "shell", "getprop", name], capture=True)


def device_info(adb: Path) -> dict[str, str]:
    return {
        "manufacturer": adb_property(adb, "ro.product.manufacturer"),
        "model": adb_property(adb, "ro.product.model"),
        "android_version": adb_property(adb, "ro.build.version.release"),
        "api_level": adb_property(adb, "ro.build.version.sdk"),
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
