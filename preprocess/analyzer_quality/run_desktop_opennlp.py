#!/usr/bin/env python3
"""Measure desktop Java analyzer compatibility with an existing language pack."""

from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
backend_path = ROOT / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from language_config.model_store import ensure_model_installed  # noqa: E402
from language_config.opennlp import analyze_text as sidecar_analyze  # noqa: E402
from sidecars.opennlp_english import sidecar  # noqa: E402
from preprocess.analyzer_quality.compare import (  # noqa: E402
    ComparisonConfig,
    Record,
    compare_records,
)


LANGUAGES = {
    "en": (ROOT / "releases/en/en-v1.1.2/lemma_pack.db", ROOT / "preprocess/analyzer_quality/configs/en.json"),
    "de": (ROOT / "releases/de/de-v1.1.2/lemma_pack.db", ROOT / "preprocess/analyzer_quality/configs/de.json"),
    "ru": (ROOT / "releases/ru/ru-v1.1.2/lemma_pack.db", ROOT / "preprocess/analyzer_quality/configs/ru.json"),
    "ja": (ROOT / "releases/ja/ja-v1.1.2/lemma_pack.db", ROOT / "preprocess/analyzer_quality/configs/ja.json"),
    "ko": (ROOT / "releases/ko/ko-v1.1.2/lemma_pack.db", ROOT / "preprocess/analyzer_quality/configs/ko.json"),
}


def sample_records(db_path: Path, sample_size: int) -> list[tuple[str, str]]:
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = connection.execute("SELECT line_id, payload FROM lines ORDER BY line_id").fetchall()
    finally:
        connection.close()
    if not rows:
        raise RuntimeError(f"No lines in {db_path}")
    indexes = {
        min(len(rows) - 1, round(index * (len(rows) - 1) / max(sample_size - 1, 1)))
        for index in range(min(sample_size, len(rows)))
    }
    output: list[tuple[str, str]] = []
    for index in sorted(indexes):
        line_id, raw_payload = rows[index]
        payload = json.loads(raw_payload)
        tokens = payload.get("tokens") if isinstance(payload, dict) else None
        if not isinstance(tokens, list):
            continue
        text = " ".join(
            str(token.get("surface", "")).strip()
            for token in tokens
            if isinstance(token, dict) and str(token.get("surface", "")).strip()
        )
        if text:
            output.append((str(line_id), text))
    return output


def opennlp_records(samples: list[tuple[str, str]], language: str, db_path: Path) -> dict[str, Record]:
    return {
        record_id: Record(record_id, sidecar_analyze(text, language, db_path))
        for record_id, text in samples
    }


def time_engine(callable_engine, samples: list[tuple[str, str]], iterations: int) -> dict[str, float]:
    timings = []
    for _ in range(iterations):
        started = time.perf_counter()
        for _, text in samples:
            callable_engine(text)
        timings.append((time.perf_counter() - started) * 1000 / len(samples))
    return {
        "mean_ms_per_sample": round(statistics.mean(timings), 4),
        "median_ms_per_sample": round(statistics.median(timings), 4),
        "p95_ms_per_sample": round(sorted(timings)[max(0, int(len(timings) * .95) - 1)], 4),
    }


def path_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=sorted(LANGUAGES), default="en")
    parser.add_argument("--sample-size", type=int, default=1000)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--mismatches-out", type=Path)
    args = parser.parse_args(argv)
    if args.sample_size <= 0 or args.iterations <= 0:
        raise SystemExit("--sample-size and --iterations must be positive")

    language = args.language
    db_path, config_path = LANGUAGES[language]
    if not db_path.is_file():
        raise RuntimeError(f"Missing language-pack DB: {db_path}")
    ensure_model_installed(language)
    samples = sample_records(db_path, args.sample_size)
    config = ComparisonConfig.from_dict(json.loads(config_path.read_text(encoding="utf-8")))

    sidecar.close()
    cold_started = time.perf_counter()
    candidate = opennlp_records([samples[0]], language, db_path)
    cold_load_ms = (time.perf_counter() - cold_started) * 1000
    candidate.update(opennlp_records(samples[1:], language, db_path))

    from preprocess.analyzer_quality.compare import load_pack_records
    reference = load_pack_records(db_path, candidate)
    pack_metrics, mismatches = compare_records(reference, candidate, config, lookup_db=db_path, max_examples=200)

    opennlp_speed = time_engine(lambda text: sidecar_analyze(text, language, db_path), samples, args.iterations)
    sidecar_root = ROOT / "desktop-sidecar/dist"
    report = {
        "language": language,
        "sample_size": len(samples),
        "pack_compatibility": pack_metrics,
        "speed": {
            "java_sidecar_cold_first_analysis_ms": round(cold_load_ms, 4),
            "java_sidecar_warm": opennlp_speed,
        },
        "size": {
            "opennlp_sidecar_jar_bytes": path_size(sidecar_root / "lema-opennlp-sidecar.jar"),
            "opennlp_trimmed_runtime_bytes": path_size(sidecar_root / "runtime"),
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.mismatches_out:
        args.mismatches_out.parent.mkdir(parents=True, exist_ok=True)
        args.mismatches_out.write_text(json.dumps(mismatches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sidecar.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
