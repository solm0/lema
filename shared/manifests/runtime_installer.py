from __future__ import annotations

from pathlib import Path

from .runtime_tracking import mark_runtime_consumers, unmark_runtime_consumers


class RuntimeDependencyError(RuntimeError):
    pass


def verify_runtime_dependencies(lang: str, dependency_ids: list[str]) -> None:
    if dependency_ids:
        raise RuntimeDependencyError(
            f"Python runtime dependencies are no longer supported for {lang}: {dependency_ids}"
        )


def ensure_runtime_ready(
    state_root: Path,
    lang: str,
    dependency_ids: list[str],
) -> None:
    verify_runtime_dependencies(lang, dependency_ids)
    mark_runtime_consumers(state_root, lang)


def release_runtime(state_root: Path, lang: str) -> None:
    unmark_runtime_consumers(state_root, lang)
