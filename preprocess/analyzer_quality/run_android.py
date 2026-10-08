#!/usr/bin/env python3
"""Run an Android analyzer fixture on a device and save its quality baseline."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from preprocess.analyzer_quality.android_device import (  # noqa: E402
    build_and_install_test_apks,
    device_info,
    find_adb,
    pull_app_file,
    run_instrumentation,
    write_json,
)

from preprocess.analyzer_quality.compare import (  # noqa: E402
    ComparisonConfig,
    _threshold_failures,
    compare_records,
    load_jsonl,
    load_pack_records,
    print_report,
)


LANGUAGES: dict[str, dict[str, Any]] = {
    "de": {
        "application_id": "com.solmi.lema.gradshow.debug",
        "test_application_id": "com.solmi.lema.gradshow.debug.test",
        "test_class": (
            "com.solmi.lema.AnalyzerQualityExportInstrumentedTest"
            "#exportsGermanCandidateJsonl"
        ),
        "remote_candidate": "cache/analyzer-quality/de-android.jsonl",
        "reference_db": ROOT / "releases/de/de-v1.1.2/lemma_pack.db",
        "config": ROOT / "preprocess/analyzer_quality/configs/de.json",
        "baseline": ROOT / "preprocess/analyzer_quality/baselines/de-android-opennlp.json",
        "analyzer": {
            "engine": "Apache OpenNLP",
            "runtime_version": "2.5.3",
            "model_package_version": "1.3.0",
            "model_treebank": "UD German GSD",
        },
    },
    "en": {
        "application_id": "com.solmi.lema.gradshow.debug",
        "test_application_id": "com.solmi.lema.gradshow.debug.test",
        "test_class": (
            "com.solmi.lema.AnalyzerQualityExportInstrumentedTest"
            "#exportsEnglishCandidateJsonl"
        ),
        "remote_candidate": "cache/analyzer-quality/en-android.jsonl",
        "reference_db": ROOT / "releases/en/en-v1.1.2/lemma_pack.db",
        "config": ROOT / "preprocess/analyzer_quality/configs/en.json",
        "baseline": ROOT / "preprocess/analyzer_quality/baselines/en-android-opennlp.json",
        "analyzer": {
            "engine": "Apache OpenNLP",
            "runtime_version": "2.5.3",
            "model_package_version": "1.3.0",
        },
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=sorted(LANGUAGES), default="en")
    parser.add_argument("--sample-size", type=int, default=1000)
    parser.add_argument("--skip-device-run", action="store_true")
    parser.add_argument(
        "--candidate",
        type=Path,
        help="Existing candidate JSONL to reuse with --skip-device-run",
    )
    parser.add_argument("--baseline-out", type=Path)
    parser.add_argument("--mismatches-out", type=Path)
    parser.add_argument("--min-surface-exact", type=float, default=99.0)
    parser.add_argument("--min-annotation-exact", type=float, default=80.0)
    parser.add_argument("--min-db-hit", type=float, default=80.0)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.sample_size <= 0:
        raise SystemExit("--sample-size must be positive")
    settings = LANGUAGES[args.language]
    adb = find_adb()

    with tempfile.TemporaryDirectory(prefix=f"lema-{args.language}-quality-") as directory:
        candidate_path = Path(directory) / f"{args.language}-android.jsonl"
        if not args.skip_device_run:
            build_and_install_test_apks(adb)
            run_instrumentation(
                adb,
                settings["test_application_id"],
                settings["test_class"],
                {"language": args.language, "sampleSize": args.sample_size},
            )
            pull_app_file(
                adb,
                settings["application_id"],
                settings["remote_candidate"],
                candidate_path,
            )
        elif args.candidate is None or not args.candidate.is_file():
            raise SystemExit("--skip-device-run requires --candidate")
        else:
            candidate_path = args.candidate

        config_value = json.loads(settings["config"].read_text(encoding="utf-8"))
        config = ComparisonConfig.from_dict(config_value)
        candidate = load_jsonl(candidate_path)
        reference = load_pack_records(settings["reference_db"], candidate)
        metrics, examples = compare_records(
            reference,
            candidate,
            config,
            lookup_db=settings["reference_db"],
            max_examples=200,
        )
        threshold_args = argparse.Namespace(
            min_surface_exact=args.min_surface_exact,
            min_annotation_exact=args.min_annotation_exact,
            min_db_hit=args.min_db_hit,
        )
        failures = _threshold_failures(metrics, threshold_args)
        print_report(metrics, failures)

        baseline = {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "language": args.language,
            "device": device_info(adb),
            "analyzer": settings["analyzer"],
            "reference": {
                "path": str(settings["reference_db"].relative_to(ROOT)),
                "sha256": sha256(settings["reference_db"]),
            },
            "sample": {
                "requested_size": args.sample_size,
                "actual_size": metrics["records"]["compared"],
                "strategy": "evenly spaced over lines ordered by line_id",
                "input_reconstruction": "reference token surfaces joined with one space",
            },
            "thresholds": {
                "surface_exact": args.min_surface_exact,
                "annotation_exact": args.min_annotation_exact,
                "database_hit": args.min_db_hit,
            },
            "metrics": metrics,
            "quality_gate": {"passed": not failures, "failures": failures},
        }
        baseline_path = args.baseline_out or settings["baseline"]
        write_json(baseline_path, baseline)
        if args.mismatches_out:
            write_json(args.mismatches_out, examples)
        print(f"Baseline saved: {baseline_path}")
        return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
