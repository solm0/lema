from pathlib import Path
from typing import Dict
import re

from . import de, en, ja, ko, ru
from runtime_paths import get_static_data_root


BASE_DIR = get_static_data_root()

_registry: Dict[str, dict] = {}
LANGUAGE_MODULES = {
    "de": de,
    "en": en,
    "ja": ja,
    "ko": ko,
    "ru": ru,
}


def parse_version(name: str):

    m = re.search(r"(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)$", name)

    if not m:
        return (0, 0, 0)

    return tuple(map(int, m.groups()))


def get_latest_version_path(base: Path):

    versions = [p for p in base.iterdir() if p.is_dir()]

    if not versions:
        raise ValueError(f"No versions for {base}")

    versions.sort(
        key=lambda p: parse_version(p.name)
    )

    return versions[-1]


def load_language(lang: str):
    if lang in _registry:
        return _registry[lang]

    try:
        module = LANGUAGE_MODULES[lang]
    except KeyError as exc:
        raise KeyError(f"Unsupported language: {lang}") from exc

    config = module.get_config(BASE_DIR)

    _registry[lang] = config

    return config


def invalidate_language(lang: str):
    config = _registry.pop(lang, None)

    if config:
        pack_db = config.get("pack_db")

        if hasattr(pack_db, "close"):
            pack_db.close()

    module = LANGUAGE_MODULES.get(lang)

    if module is None:
        return

    unload = getattr(module, "unload", None)

    if callable(unload):
        unload()
