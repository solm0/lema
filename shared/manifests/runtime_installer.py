from __future__ import annotations

import importlib.util
from pathlib import Path

from .runtime_tracking import mark_runtime_consumers, unmark_runtime_consumers


class RuntimeDependencyError(RuntimeError):
    pass


def _get_package_root(package_name: str) -> Path:
    spec = importlib.util.find_spec(package_name)

    if spec is None:
        raise RuntimeDependencyError(f"Required package is not installed: {package_name}")

    if spec.submodule_search_locations:
        return Path(next(iter(spec.submodule_search_locations))).resolve()

    origin = spec.origin
    if not origin:
        raise RuntimeDependencyError(f"Cannot resolve package path for: {package_name}")

    return Path(origin).resolve().parent


def _require_files(package_name: str, relative_paths: list[str]) -> None:
    root = _get_package_root(package_name)
    missing = [rel for rel in relative_paths if not (root / rel).exists()]

    if missing:
        joined = ", ".join(missing)
        raise RuntimeDependencyError(
            f"Package resource is missing for {package_name}: {joined}"
        )


def _validate_torch() -> None:
    _get_package_root("torch")


def _validate_stanza() -> None:
    _require_files(
        "stanza",
        [
            "__init__.py",
            "resources/common.py",
            "pipeline/core.py",
        ],
    )


def _validate_udtools() -> None:
    _require_files(
        "udtools",
        [
            "data/data.json",
            "data/upos.json",
        ],
    )


def _validate_kiwipiepy() -> None:
    _require_files(
        "kiwipiepy",
        [
            "corpus/stopwords.txt",
        ],
    )


def _validate_kiwipiepy_model() -> None:
    _require_files(
        "kiwipiepy_model",
        [
            "default.dict",
            "typo.dict",
            "combiningRule.txt",
        ],
    )


VALIDATORS = {
    "torch": _validate_torch,
    "stanza": _validate_stanza,
    "udtools": _validate_udtools,
    "udapi": lambda: _require_files("udapi", ["__init__.py", "core/__init__.py", "block/__init__.py"]),
    "regex": lambda: _require_files("regex", ["__init__.py"]),
    "kiwipiepy": _validate_kiwipiepy,
    "kiwipiepy_model": _validate_kiwipiepy_model,
}


def verify_runtime_dependencies(lang: str, dependency_ids: list[str]) -> None:
    for dependency_id in dependency_ids:
        validator = VALIDATORS.get(dependency_id)

        if validator is None:
            raise RuntimeDependencyError(
                f"No runtime validator is registered for dependency: {dependency_id}"
            )

        try:
            validator()
        except RuntimeDependencyError:
            raise
        except Exception as exc:
            raise RuntimeDependencyError(
                f"Runtime dependency validation failed for {dependency_id}: {exc}"
            ) from exc


def ensure_runtime_ready(
    state_root: Path,
    lang: str,
    dependency_ids: list[str],
) -> None:
    verify_runtime_dependencies(lang, dependency_ids)
    mark_runtime_consumers(state_root, lang)


def release_runtime(state_root: Path, lang: str) -> None:
    unmark_runtime_consumers(state_root, lang)
