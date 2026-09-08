import hashlib
import math
import os
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict

from language_config.registry import get_latest_version_path
from language_config.sqlite_pack import LanguagePackDB, find_pack_db

try:
    from runtime_paths import get_static_data_root as _get_static_data_root
except ModuleNotFoundError:
    _get_static_data_root = None


def get_static_data_root() -> Path:
    override = os.getenv("LEMA_DATA_STATIC_ROOT") or os.getenv("NAUTILUS_DATA_STATIC_ROOT")
    if override:
        return Path(override).resolve()

    candidates: list[Path] = []

    if _get_static_data_root is not None:
        candidates.append(_get_static_data_root())

    repo_root = Path(__file__).resolve().parents[2]
    candidates.extend([
        repo_root / "central" / "data" / "static",
        repo_root / "backend" / "data" / "static",
    ])

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


BASE_DIR = get_static_data_root()

# lang별 캐시
_registry: Dict[str, dict] = {}


def _load_language(lang: str):
    if lang in _registry:
        return _registry[lang]

    lang_dir = BASE_DIR / lang
    pack_db = None

    if lang_dir.exists():
        try:
            version_path = get_latest_version_path(lang_dir)
        except ValueError:
            # Empty language directories are placeholders for uninstalled packs.
            version_path = None

        if version_path is not None:
            db_path = find_pack_db(version_path)
            pack_db = LanguagePackDB(db_path) if db_path else None

    data = {
        "pack_db": pack_db,
    }

    _registry[lang] = data
    return data


def invalidate_language(lang: str):
    data = _registry.pop(lang, None)

    if not data:
        return

    pack_db = data.get("pack_db")

    if hasattr(pack_db, "close"):
        pack_db.close()


# ---- helpers ----

def has_key(key: str, lang: str):
    data = _load_language(lang)
    pack_db = data["pack_db"]
    return pack_db.has_lemma_key(key) if pack_db else False


def get_line_ids(key: str, lang: str):
    data = _load_language(lang)
    pack_db = data["pack_db"]
    return pack_db.get_line_ids(key) if pack_db else []


def get_furigana(key: str, lang: str):
    data = _load_language(lang)
    pack_db = data["pack_db"]
    return pack_db.get_furigana(key) if pack_db else None


def find_match_indices(tokens, lemma, pos):
    indices = []
    for i, t in enumerate(tokens):
        if t.get("lemma") == lemma and t.get("pos") == pos:
            indices.append(i)
            continue

        for morph in t.get("morphs") or []:
            if morph.get("lemma") == lemma and morph.get("pos") == pos:
                indices.append(i)
                break

    return indices


KWIC_EXAMPLE_LIMIT = 12
KWIC_SIMILARITY_THRESHOLD = 0.85

_SIMILARITY_IGNORED_POS = {"PUNCT", "SPACE", "SYM"}


def _scorable_units(token):
    morphs = [
        morph
        for morph in token.get("morphs") or []
        if morph.get("lemma") and morph.get("pos")
    ]
    if morphs:
        return morphs
    if token.get("lemma") and token.get("pos"):
        return [token]
    return []


def _similarity_signature(line, lemma, pos):
    signature = []

    for token in line["tokens"]:
        units = token.get("morphs") or [token]

        for unit in units:
            unit_lemma = unit.get("lemma")
            unit_pos = unit.get("pos")

            # Every candidate contains the lookup target, so including it would
            # artificially inflate similarity, especially for short sentences.
            if unit_lemma == lemma and unit_pos == pos:
                continue
            if unit_pos in _SIMILARITY_IGNORED_POS:
                continue

            value = unit_lemma or unit.get("surface")
            if not isinstance(value, str):
                continue

            value = " ".join(value.casefold().split())
            if value and any(character.isalnum() for character in value):
                signature.append(value)

    return tuple(signature)


def _sentence_similarity(left, right):
    return SequenceMatcher(None, left, right, autojunk=False).ratio()


def _line_metrics(line, target_key, lang, user_lemma_states, frequency_ranks):
    familiarity = []
    frequency_priors = []
    interested_keys = set()
    known_count = 0
    exposed_count = 0

    for token in line["tokens"]:
        for unit in _scorable_units(token):
            local_key = f'{unit["lemma"]}_{unit["pos"]}'
            if local_key == target_key:
                continue

            global_key = f'{unit["lemma"]}/{unit["pos"]}/{lang}'
            state = user_lemma_states.get(global_key, {})
            frequency_prior = 0.20 + 0.70 * frequency_ranks.get(local_key, 0.0)

            if state.get("is_known") is True:
                probability = 1.0
                known_count += 1
            else:
                exposure_count = min(max(int(state.get("exposure_count") or 0), 0), 10)
                exposure_floor = 0.35 + 0.025 * exposure_count
                probability = max(frequency_prior, exposure_floor)
                exposed_count += exposure_count > 0

            familiarity.append(probability)
            frequency_priors.append(frequency_prior)
            if state.get("is_interested") is True:
                interested_keys.add(global_key)

    coverage = sum(familiarity) / len(familiarity) if familiarity else 1.0
    interest_bonus = 0.07 * min(len(interested_keys), 2)
    threshold_bonus = 0.03 if coverage >= 0.95 else 0.0

    # Stable tie-breaking keeps results from flickering within the daily pool.
    tie_hash = hashlib.blake2b(str(line["line_id"]).encode(), digest_size=4).digest()
    tie_breaker = int.from_bytes(tie_hash, "big") / (2**32) * 1e-6
    score = coverage + interest_bonus + threshold_bonus + tie_breaker
    return {
        "score": round(score, 4),
        "coverage": round(coverage, 4),
        "frequency_prior": round(
            sum(frequency_priors) / len(frequency_priors),
            4,
        ) if frequency_priors else 1.0,
        "known": known_count,
        "exposed": exposed_count,
        "interested": len(interested_keys),
        "scored_tokens": len(familiarity),
        "length": len(line["tokens"]),
    }


def _frequency_ranks(pack_db, lines):
    keys = {
        f'{unit["lemma"]}_{unit["pos"]}'
        for line in lines
        for token in line["tokens"]
        for unit in _scorable_units(token)
    }
    frequencies = pack_db.get_lemma_frequencies(list(keys))
    if not frequencies:
        return {}

    ordered = sorted(set(math.log1p(value) for value in frequencies.values()))
    if len(ordered) == 1:
        return {key: 0.5 for key in frequencies}

    rank_by_frequency = {
        value: index / (len(ordered) - 1)
        for index, value in enumerate(ordered)
    }
    return {
        key: rank_by_frequency[math.log1p(value)]
        for key, value in frequencies.items()
    }


def sample_kwic(
    line_ids,
    lemma,
    pos,
    lang: str,
    max_k=KWIC_EXAMPLE_LIMIT,
    user_lemma_states=None,
):
    data = _load_language(lang)
    pack_db = data["pack_db"]

    if pack_db is None:
        return []

    candidates = []
    target_key = f"{lemma}_{pos}"

    for line in pack_db.get_lines(line_ids):
        tokens = line["tokens"]

        indices = find_match_indices(tokens, lemma, pos)
        if not indices:
            continue
        line["match_indices"] = indices
        candidates.append(line)

    states = user_lemma_states or {}
    frequency_ranks = _frequency_ranks(pack_db, candidates)
    for line in candidates:
        line["selection_debug"] = _line_metrics(
            line,
            target_key,
            lang,
            states,
            frequency_ranks,
        )

    result = []
    selected_signatures = []

    for line in sorted(
        candidates,
        key=lambda candidate: (
            len(candidate["tokens"]),
            candidate["line_id"],
        ),
    ):
        signature = _similarity_signature(line, lemma, pos)
        if any(
            _sentence_similarity(signature, selected) >= KWIC_SIMILARITY_THRESHOLD
            for selected in selected_signatures
        ):
            continue

        result.append(line)
        selected_signatures.append(signature)

        if len(result) >= max_k:
            break

    kwic = []

    for line in result[:max_k]:
        tokens = line["tokens"]
        kwic.append({
            "line_id": line["line_id"],
            "tokens": tokens,
            "match_indices": line["match_indices"],
            "selection_debug": line["selection_debug"],
        })

    return kwic
