from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from shared.services import lemma_service as _shared_module


for _name in dir(_shared_module):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_shared_module, _name)


__all__ = [name for name in dir(_shared_module) if not name.startswith("__")]
