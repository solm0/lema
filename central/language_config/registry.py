from pathlib import Path
import re


def parse_version(name: str) -> tuple[int, int, int]:
    match = re.search(r"(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)$", name)
    if match is None:
        return (0, 0, 0)
    return tuple(map(int, match.groups()))


def get_latest_version_path(base: Path) -> Path:
    versions = [path for path in base.iterdir() if path.is_dir()]
    if not versions:
        raise ValueError(f"No versions for {base}")
    return max(versions, key=lambda path: parse_version(path.name))
