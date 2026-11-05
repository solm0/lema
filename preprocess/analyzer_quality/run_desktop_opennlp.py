#!/usr/bin/env python3
"""Exercise the macOS English OpenNLP sidecar against the existing pack and Stanza."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import statistics
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
backend_path = ROOT / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from language_config.model_store import (  # noqa: E402
    ensure_opennlp_model_installed,
    get_local_model_dir,
)
from sidecars.opennlp_english import sidecar  # noqa: E402
from preprocess.analyzer_quality.compare import (  # noqa: E402
    ComparisonConfig,
    Record,
    compare_records,
)


EN_DB = ROOT / "releases/en/en-v1.1.2/lemma_pack.db"
EN_CONFIG = ROOT / "preprocess/analyzer_quality/configs/en.json"


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


def opennlp_records(samples: list[tuple[str, str]], model_dir: Path) -> dict[str, Record]:
    return {
        record_id: Record(record_id, sidecar.analyze(text, model_dir))
        for record_id, text in samples
    }


def stanza_records(samples: list[tuple[str, str]]) -> tuple[dict[str, Record], float]:
    import stanza

    started = time.perf_counter()
    pipeline = stanza.Pipeline(
        lang="en",
        processors="tokenize,pos,lemma",
        use_gpu=False,
        dir=str(get_local_model_dir("en")),
        download_method=None,
    )
    load_ms = (time.perf_counter() - started) * 1000
    output: dict[str, Record] = {}
    for record_id, text in samples:
        tokens: list[dict[str, Any]] = []
        document = pipeline(text)
        for sentence in document.sentences:
            words = list(sentence.words)
            word_index = 0
            for surface in sentence.text.split():
                matched = []
                joined = ""
                while word_index < len(words):
                    word = words[word_index]
                    word_index += 1
                    joined += word.text
                    matched.append(word)
                    if joined == surface:
                        break
                main = matched[0] if joined == surface and matched else None
                tokens.append({
                    "surface": surface,
                    "lemma": main.lemma.lower() if main and main.lemma else None,
                    "pos": main.upos if main else None,
                })
        output[record_id] = Record(record_id, tokens)
    return output, load_ms


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
    parser.add_argument("--sample-size", type=int, default=1000)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--mismatches-out", type=Path)
    args = parser.parse_args(argv)
    if args.sample_size <= 0 or args.iterations <= 0:
        raise SystemExit("--sample-size and --iterations must be positive")

    os.environ["LEMA_ENGLISH_ANALYZER"] = "opennlp"
    model_dir = ensure_opennlp_model_installed("en")
    samples = sample_records(EN_DB, args.sample_size)
    config = ComparisonConfig.from_dict(json.loads(EN_CONFIG.read_text(encoding="utf-8")))

    sidecar.close()
    cold_started = time.perf_counter()
    candidate = opennlp_records([samples[0]], model_dir)
    cold_load_ms = (time.perf_counter() - cold_started) * 1000
    candidate.update(opennlp_records(samples[1:], model_dir))

    from preprocess.analyzer_quality.compare import load_pack_records
    reference = load_pack_records(EN_DB, candidate)
    pack_metrics, mismatches = compare_records(reference, candidate, config, lookup_db=EN_DB, max_examples=200)

    stanza, stanza_load_ms = stanza_records(samples)
    agreement_metrics, _ = compare_records(stanza, candidate, config, lookup_db=EN_DB, max_examples=0)
    opennlp_speed = time_engine(lambda text: sidecar.analyze(text, model_dir), samples, args.iterations)

    # Stanza stays intentionally isolated to this evaluator; the production
    # backend selects the OpenNLP sidecar by default.
    import stanza as stanza_module
    stanza_pipeline = stanza_module.Pipeline(
        lang="en", processors="tokenize,pos,lemma", use_gpu=False,
        dir=str(get_local_model_dir("en")), download_method=None,
    )
    stanza_speed = time_engine(lambda text: stanza_pipeline(text), samples, args.iterations)

    sidecar_root = ROOT / "desktop-sidecar/dist"
    report = {
        "language": "en",
        "sample_size": len(samples),
        "result_agreement_with_stanza": agreement_metrics,
        "pack_compatibility": pack_metrics,
        "speed": {
            "opennlp_cold_sidecar_and_first_analysis_ms": round(cold_load_ms, 4),
            "stanza_cold_pipeline_load_ms": round(stanza_load_ms, 4),
            "opennlp_warm": opennlp_speed,
            "stanza_warm": stanza_speed,
        },
        "size": {
            "opennlp_sidecar_jar_bytes": path_size(sidecar_root / "lema-opennlp-sidecar.jar"),
            "opennlp_trimmed_runtime_bytes": path_size(sidecar_root / "runtime"),
            "torch_python_package_bytes": path_size(
                ROOT / "backend/venv/lib/python3.12/site-packages/torch"
            ),
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
