#!/usr/bin/env python3
"""Compare candidate analyzer output with the existing language-pack analysis."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class Record:
    record_id: str
    tokens: list[dict[str, Any]]


@dataclass(frozen=True)
class ComparisonConfig:
    language: str = "unknown"
    unicode_form: str = "NFC"
    casefold_lemmas: bool = False
    reference_pos_map: dict[str, str] | None = None
    candidate_pos_map: dict[str, str] | None = None
    reference_lemma_map: dict[str, str] | None = None
    candidate_lemma_map: dict[str, str] | None = None
    exclude_pos: frozenset[str] = frozenset()
    exclude_lemmas: frozenset[str] = frozenset()

    @classmethod
    def from_dict(cls, value: dict[str, Any] | None) -> "ComparisonConfig":
        value = value or {}
        unicode_form = str(value.get("unicode_form", "NFC"))
        if unicode_form not in {"NFC", "NFD", "NFKC", "NFKD"}:
            raise ValueError(f"Unsupported unicode_form: {unicode_form}")

        return cls(
            language=str(value.get("language", "unknown")),
            unicode_form=unicode_form,
            casefold_lemmas=bool(value.get("casefold_lemmas", False)),
            reference_pos_map=_string_map(value.get("reference_pos_map")),
            candidate_pos_map=_string_map(value.get("candidate_pos_map")),
            reference_lemma_map=_string_map(value.get("reference_lemma_map")),
            candidate_lemma_map=_string_map(value.get("candidate_lemma_map")),
            exclude_pos=frozenset(_string_list(value.get("exclude_pos"))),
            exclude_lemmas=frozenset(_string_list(value.get("exclude_lemmas"))),
        )


def _string_map(value: Any) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("Mapping settings must be JSON objects")
    return {str(key): str(item) for key, item in value.items()}


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Exclusion settings must be JSON arrays")
    return [str(item) for item in value]


def _extract_tokens(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [payload.get("tokens")]
    result = payload.get("result")
    if isinstance(result, dict):
        candidates.append(result.get("tokens"))

    for candidate in candidates:
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]

    block_candidates = [payload.get("blocks")]
    if isinstance(result, dict):
        block_candidates.append(result.get("blocks"))
    for blocks in block_candidates:
        if not isinstance(blocks, list):
            continue
        tokens: list[dict[str, Any]] = []
        for block in blocks:
            if not isinstance(block, dict) or not isinstance(block.get("tokens"), list):
                continue
            tokens.extend(item for item in block["tokens"] if isinstance(item, dict))
        return tokens

    raise ValueError("Record has no tokens or blocks array")


def _record_id(payload: dict[str, Any], line_number: int) -> str:
    for key in ("id", "line_id", "sample_id"):
        if key in payload and payload[key] is not None:
            return str(payload[key])
    raise ValueError(f"Line {line_number} has no id, line_id, or sample_id")


def load_jsonl(path: Path) -> dict[str, Record]:
    records: dict[str, Record] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            if not raw_line.strip():
                continue
            try:
                payload = json.loads(raw_line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON at {path}:{line_number}: {exc}") from exc
            if not isinstance(payload, dict):
                raise ValueError(f"Expected an object at {path}:{line_number}")
            record_id = _record_id(payload, line_number)
            if record_id in records:
                raise ValueError(f"Duplicate record id {record_id!r} in {path}")
            records[record_id] = Record(record_id, _extract_tokens(payload))
    return records


def load_pack_records(db_path: Path, record_ids: Iterable[str]) -> dict[str, Record]:
    numeric_ids: list[int] = []
    for record_id in record_ids:
        try:
            numeric_ids.append(int(record_id))
        except ValueError as exc:
            raise ValueError(
                "Pack database references require numeric candidate record ids"
            ) from exc

    records: dict[str, Record] = {}
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for start in range(0, len(numeric_ids), 900):
            chunk = numeric_ids[start:start + 900]
            placeholders = ",".join("?" for _ in chunk)
            rows = connection.execute(
                f"SELECT line_id, payload FROM lines WHERE line_id IN ({placeholders})",
                chunk,
            )
            for line_id, raw_payload in rows:
                payload = json.loads(raw_payload)
                if not isinstance(payload, dict):
                    continue
                record_id = str(line_id)
                records[record_id] = Record(record_id, _extract_tokens(payload))
    finally:
        connection.close()
    return records


def _normalized_text(value: Any, config: ComparisonConfig) -> str:
    return unicodedata.normalize(config.unicode_form, str(value or ""))


def _surface(token: dict[str, Any], config: ComparisonConfig) -> str:
    return _normalized_text(token.get("surface"), config)


def _lookup_units(
    token: dict[str, Any],
    side: str,
    config: ComparisonConfig,
) -> tuple[tuple[str, str], ...]:
    morphs = token.get("morphs")
    sources = morphs if isinstance(morphs, list) and morphs else [token]
    pos_map = config.reference_pos_map if side == "reference" else config.candidate_pos_map
    lemma_map = (
        config.reference_lemma_map if side == "reference" else config.candidate_lemma_map
    )
    pos_map = pos_map or {}
    lemma_map = lemma_map or {}
    output: list[tuple[str, str]] = []

    for source in sources:
        if not isinstance(source, dict):
            continue
        lemma_value = source.get("lemma")
        pos_value = source.get("pos")
        if lemma_value is None or pos_value is None:
            continue
        lemma = _normalized_text(lemma_value, config).strip()
        pos = _normalized_text(pos_value, config).strip()
        if config.casefold_lemmas:
            lemma = lemma.casefold()
        lemma = lemma_map.get(lemma, lemma)
        pos = pos_map.get(pos, pos)
        if not lemma or not pos or lemma in config.exclude_lemmas or pos in config.exclude_pos:
            continue
        output.append((lemma, pos))

    return tuple(output)


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator * 100.0 / denominator, 4)


def _database_hits(db_path: Path, keys: set[str]) -> set[str]:
    if not keys:
        return set()
    hits: set[str] = set()
    ordered_keys = sorted(keys)
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for start in range(0, len(ordered_keys), 900):
            chunk = ordered_keys[start:start + 900]
            placeholders = ",".join("?" for _ in chunk)
            rows = connection.execute(
                f"SELECT lemma_key FROM lemma_stats WHERE lemma_key IN ({placeholders})",
                chunk,
            )
            hits.update(str(row[0]) for row in rows)
    finally:
        connection.close()
    return hits


def compare_records(
    reference: dict[str, Record],
    candidate: dict[str, Record],
    config: ComparisonConfig,
    lookup_db: Path | None = None,
    max_examples: int = 100,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    shared_ids = sorted(set(reference) & set(candidate), key=_sortable_id)
    exact_surface_records = 0
    reference_token_count = 0
    aligned_token_count = 0
    annotated_reference_tokens = 0
    exact_annotation_tokens = 0
    candidate_key_counts: Counter[str] = Counter()
    examples: list[dict[str, Any]] = []

    for record_id in shared_ids:
        reference_record = reference[record_id]
        candidate_record = candidate[record_id]
        reference_surfaces = [_surface(token, config) for token in reference_record.tokens]
        candidate_surfaces = [_surface(token, config) for token in candidate_record.tokens]
        reference_token_count += len(reference_surfaces)

        if reference_surfaces == candidate_surfaces:
            exact_surface_records += 1
        elif len(examples) < max_examples:
            examples.append({
                "id": record_id,
                "kind": "surface_sequence",
                "reference": reference_surfaces,
                "candidate": candidate_surfaces,
            })

        matcher = SequenceMatcher(
            None,
            reference_surfaces,
            candidate_surfaces,
            autojunk=False,
        )
        for match in matcher.get_matching_blocks():
            for offset in range(match.size):
                reference_index = match.a + offset
                candidate_index = match.b + offset
                aligned_token_count += 1
                reference_units = _lookup_units(
                    reference_record.tokens[reference_index], "reference", config
                )
                candidate_units = _lookup_units(
                    candidate_record.tokens[candidate_index], "candidate", config
                )
                if not reference_units:
                    continue
                annotated_reference_tokens += 1
                if reference_units == candidate_units:
                    exact_annotation_tokens += 1
                elif len(examples) < max_examples:
                    examples.append({
                        "id": record_id,
                        "kind": "annotation",
                        "surface": reference_surfaces[reference_index],
                        "reference": reference_units,
                        "candidate": candidate_units,
                    })

        for token in candidate_record.tokens:
            for lemma, pos in _lookup_units(token, "candidate", config):
                candidate_key_counts[f"{lemma}_{pos}"] += 1

    database_metrics: dict[str, Any] = {
        "candidate_lookup_occurrences": sum(candidate_key_counts.values()),
        "candidate_lookup_unique_keys": len(candidate_key_counts),
        "hit_occurrences": None,
        "hit_unique_keys": None,
        "occurrence_hit_rate": None,
        "unique_key_hit_rate": None,
    }
    if lookup_db is not None:
        hits = _database_hits(lookup_db, set(candidate_key_counts))
        hit_occurrences = sum(candidate_key_counts[key] for key in hits)
        database_metrics.update({
            "hit_occurrences": hit_occurrences,
            "hit_unique_keys": len(hits),
            "occurrence_hit_rate": _rate(
                hit_occurrences, sum(candidate_key_counts.values())
            ),
            "unique_key_hit_rate": _rate(len(hits), len(candidate_key_counts)),
        })

    metrics = {
        "language": config.language,
        "records": {
            "reference": len(reference),
            "candidate": len(candidate),
            "compared": len(shared_ids),
            "missing_candidate": len(set(reference) - set(candidate)),
            "extra_candidate": len(set(candidate) - set(reference)),
        },
        "surface": {
            "exact_records": exact_surface_records,
            "exact_record_rate": _rate(exact_surface_records, len(shared_ids)),
            "reference_tokens": reference_token_count,
            "aligned_tokens": aligned_token_count,
            "aligned_token_rate": _rate(aligned_token_count, reference_token_count),
        },
        "annotation": {
            "reference_content_tokens": annotated_reference_tokens,
            "exact_content_tokens": exact_annotation_tokens,
            "exact_content_rate": _rate(
                exact_annotation_tokens, annotated_reference_tokens
            ),
        },
        "database": database_metrics,
    }
    return metrics, examples


def _sortable_id(value: str) -> tuple[int, int | str]:
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)


def _format_rate(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}%"


def print_report(metrics: dict[str, Any], failures: list[str]) -> None:
    records = metrics["records"]
    surface = metrics["surface"]
    annotation = metrics["annotation"]
    database = metrics["database"]
    print(f"Analyzer quality report: {metrics['language']}")
    print(
        f"Samples compared: {records['compared']} "
        f"(missing {records['missing_candidate']}, extra {records['extra_candidate']})"
    )
    print(f"Exact surface sequences: {_format_rate(surface['exact_record_rate'])}")
    print(f"Aligned surface tokens: {_format_rate(surface['aligned_token_rate'])}")
    print(f"Exact lemma+POS content tokens: {_format_rate(annotation['exact_content_rate'])}")
    if database["occurrence_hit_rate"] is not None:
        print(f"Pack DB hits (occurrences): {_format_rate(database['occurrence_hit_rate'])}")
        print(f"Pack DB hits (unique keys): {_format_rate(database['unique_key_hit_rate'])}")
    if failures:
        print("Quality gate: FAIL")
        for failure in failures:
            print(f"- {failure}")
    else:
        print("Quality gate: PASS")


def _threshold_failures(metrics: dict[str, Any], args: argparse.Namespace) -> list[str]:
    checks = [
        ("surface.exact_record_rate", metrics["surface"]["exact_record_rate"], args.min_surface_exact),
        (
            "annotation.exact_content_rate",
            metrics["annotation"]["exact_content_rate"],
            args.min_annotation_exact,
        ),
        (
            "database.occurrence_hit_rate",
            metrics["database"]["occurrence_hit_rate"],
            args.min_db_hit,
        ),
    ]
    failures = []
    for name, actual, minimum in checks:
        if minimum is None:
            continue
        if actual is None or actual < minimum:
            rendered = "n/a" if actual is None else f"{actual:.2f}%"
            failures.append(f"{name} is {rendered}; minimum is {minimum:.2f}%")
    return failures


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    reference = parser.add_mutually_exclusive_group(required=True)
    reference.add_argument("--reference", type=Path, help="Desktop/reference JSONL")
    reference.add_argument(
        "--reference-db",
        type=Path,
        help="Existing lemma_pack.db; rows are selected using candidate ids",
    )
    parser.add_argument("--candidate", type=Path, required=True, help="Mobile/candidate JSONL")
    parser.add_argument("--lookup-db", type=Path, help="lemma_pack.db used for lookup coverage")
    parser.add_argument("--config", type=Path, help="Language normalization JSON")
    parser.add_argument("--json-out", type=Path, help="Write full metrics as JSON")
    parser.add_argument("--mismatches-out", type=Path, help="Write mismatch examples as JSON")
    parser.add_argument("--max-examples", type=int, default=100)
    parser.add_argument("--min-surface-exact", type=float)
    parser.add_argument("--min-annotation-exact", type=float)
    parser.add_argument("--min-db-hit", type=float)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config_value = None
        if args.config:
            config_value = json.loads(args.config.read_text(encoding="utf-8"))
            if not isinstance(config_value, dict):
                raise ValueError("Config must contain a JSON object")
        config = ComparisonConfig.from_dict(config_value)
        candidate = load_jsonl(args.candidate)
        reference = (
            load_jsonl(args.reference)
            if args.reference
            else load_pack_records(args.reference_db, candidate)
        )
        lookup_db = args.lookup_db or args.reference_db
        metrics, examples = compare_records(
            reference,
            candidate,
            config,
            lookup_db=lookup_db,
            max_examples=max(0, args.max_examples),
        )
        failures = _threshold_failures(metrics, args)
        metrics["quality_gate"] = {"passed": not failures, "failures": failures}
        print_report(metrics, failures)
        if args.json_out:
            _write_json(args.json_out, metrics)
        if args.mismatches_out:
            _write_json(args.mismatches_out, examples)
        return 1 if failures else 0
    except (OSError, ValueError, sqlite3.Error, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

