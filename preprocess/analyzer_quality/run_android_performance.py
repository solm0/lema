#!/usr/bin/env python3
"""Measure Android analyzer load time, retained heap, and short-text latency."""

from __future__ import annotations

import argparse
import json
import statistics
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


LANGUAGES: dict[str, dict[str, Any]] = {
    "de": {
        "application_id": "com.solmi.lema.gradshow.debug",
        "test_application_id": "com.solmi.lema.gradshow.debug.test",
        "test_class": (
            "com.solmi.lema.GermanNlpAnalyzerInstrumentedTest"
            "#loadsModelsAndAnalyzesOnAndroidRuntime"
        ),
        "remote_report": "cache/analyzer-quality/de-android-performance.json",
        "baseline": (
            ROOT
            / "preprocess/analyzer_quality/baselines/de-android-opennlp-performance.json"
        ),
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
            "com.solmi.lema.EnglishNlpAnalyzerInstrumentedTest"
            "#loadsModelsAndAnalyzesOnAndroidRuntime"
        ),
        "remote_report": "cache/analyzer-quality/en-android-performance.json",
        "baseline": (
            ROOT
            / "preprocess/analyzer_quality/baselines/en-android-opennlp-performance.json"
        ),
        "analyzer": {
            "engine": "Apache OpenNLP",
            "runtime_version": "2.5.3",
            "model_package_version": "1.3.0",
        },
    },
    "ko": {
        "application_id": "com.solmi.lema.gradshow.debug",
        "test_application_id": "com.solmi.lema.gradshow.debug.test",
        "test_class": (
            "com.solmi.lema.KoreanNlpAnalyzerInstrumentedTest"
            "#loadsModelsAndAnalyzesOnAndroidRuntime"
        ),
        "remote_report": "cache/analyzer-quality/ko-android-performance.json",
        "baseline": (
            ROOT
            / "preprocess/analyzer_quality/baselines/ko-android-kiwi-performance.json"
        ),
        "analyzer": {
            "engine": "Kiwi Android",
            "runtime_version": "0.24.0",
            "model_version": "0.24.0-base",
        },
    },
    "ru": {
        "application_id": "com.solmi.lema.gradshow.debug",
        "test_application_id": "com.solmi.lema.gradshow.debug.test",
        "test_class": (
            "com.solmi.lema.RussianNlpAnalyzerInstrumentedTest"
            "#loadsModelsAndAnalyzesOnAndroidRuntime"
        ),
        "remote_report": "cache/analyzer-quality/ru-android-performance.json",
        "baseline": (
            ROOT
            / "preprocess/analyzer_quality/baselines/ru-android-opennlp-performance.json"
        ),
        "analyzer": {
            "engine": "Apache OpenNLP",
            "runtime_version": "2.5.3",
            "model_package_version": "1.3.0",
            "model_treebank": "UD Russian GSD",
        },
    },
}


def metric_summary(runs: list[dict[str, Any]], key: str) -> dict[str, float]:
    values = [float(run[key]) for run in runs]
    return {
        "median": round(statistics.median(values), 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def gate_failures(summary: dict[str, Any], args: argparse.Namespace) -> list[str]:
    checks = [
        ("cold_model_load_ms", args.max_load_ms),
        ("retained_heap_mb", args.max_heap_mb),
        ("native_pss_mb", args.max_native_pss_mb),
        ("total_pss_mb", args.max_total_pss_mb),
        ("analysis_average_ms", args.max_analysis_average_ms),
    ]
    failures = []
    for metric, maximum in checks:
        if maximum is None:
            continue
        if metric not in summary:
            failures.append(f"{metric} was not reported by the analyzer test")
            continue
        actual = float(summary[metric]["median"])
        if actual > maximum:
            failures.append(f"{metric} median is {actual:.2f}; maximum is {maximum:.2f}")
    return failures


def print_report(summary: dict[str, Any], failures: list[str]) -> None:
    load = summary["cold_model_load_ms"]
    heap = summary["retained_heap_mb"]
    analysis = summary["analysis_average_ms"]
    print(f"Android analyzer performance: {summary['language']}")
    print(f"Runs: {summary['run_count']}; iterations per run: {summary['iterations_per_run']}")
    print(
        "Cold model load: "
        f"median {load['median']:.2f} ms (min {load['min']:.2f}, max {load['max']:.2f})"
    )
    print(
        "Retained heap: "
        f"median {heap['median']:.2f} MB (min {heap['min']:.2f}, max {heap['max']:.2f})"
    )
    for metric, label in (
        ("native_pss_mb", "Native PSS"),
        ("total_pss_mb", "Total PSS"),
    ):
        if metric not in summary:
            continue
        value = summary[metric]
        print(
            f"{label}: median {value['median']:.2f} MB "
            f"(min {value['min']:.2f}, max {value['max']:.2f})"
        )
    print(
        "12-token analysis: "
        f"median {analysis['median']:.2f} ms "
        f"(min {analysis['min']:.2f}, max {analysis['max']:.2f})"
    )
    if failures:
        print("Performance gate: FAIL")
        for failure in failures:
            print(f"- {failure}")
    elif any(
        value is not None
        for value in (
            summary["thresholds"]["max_load_ms"],
            summary["thresholds"]["max_heap_mb"],
            summary["thresholds"]["max_native_pss_mb"],
            summary["thresholds"]["max_total_pss_mb"],
            summary["thresholds"]["max_analysis_average_ms"],
        )
    ):
        print("Performance gate: PASS")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=sorted(LANGUAGES), default="en")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--iterations", type=int, default=100)
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument(
        "--kiwi-model-archive",
        type=Path,
        help="Official kiwi_model_v0.24.0_base.tgz used for Korean device tests",
    )
    parser.add_argument("--baseline-out", type=Path)
    parser.add_argument("--max-load-ms", type=float)
    parser.add_argument("--max-heap-mb", type=float)
    parser.add_argument("--max-native-pss-mb", type=float)
    parser.add_argument("--max-total-pss-mb", type=float)
    parser.add_argument("--max-analysis-average-ms", type=float)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.runs <= 0 or args.iterations <= 0:
        raise SystemExit("--runs and --iterations must be positive")

    settings = LANGUAGES[args.language]
    adb = find_adb()
    if not args.skip_build:
        if args.language == "ko" and (
            args.kiwi_model_archive is None
            or not args.kiwi_model_archive.is_file()
        ):
            raise SystemExit(
                "Korean device run requires --kiwi-model-archive "
                "pointing to kiwi_model_v0.24.0_base.tgz"
            )
        build_and_install_test_apks(adb, args.kiwi_model_archive)

    reports: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix=f"lema-{args.language}-performance-") as directory:
        for run_index in range(args.runs):
            run_instrumentation(
                adb,
                settings["test_application_id"],
                settings["test_class"],
                {"iterations": args.iterations},
            )
            report_path = Path(directory) / f"run-{run_index + 1}.json"
            pull_app_file(
                adb,
                settings["application_id"],
                settings["remote_report"],
                report_path,
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if not isinstance(report, dict):
                raise RuntimeError("Android performance report must be a JSON object")
            report["run"] = run_index + 1
            reports.append(report)

    summary = {
        "language": args.language,
        "run_count": len(reports),
        "iterations_per_run": args.iterations,
        "sentence": reports[0]["sentence"],
        "token_count": reports[0]["token_count"],
        "cold_model_load_ms": metric_summary(reports, "cold_model_load_ms"),
        "retained_heap_mb": metric_summary(reports, "retained_heap_mb"),
        "analysis_average_ms": metric_summary(reports, "analysis_average_ms"),
        "thresholds": {
            "max_load_ms": args.max_load_ms,
            "max_heap_mb": args.max_heap_mb,
            "max_native_pss_mb": args.max_native_pss_mb,
            "max_total_pss_mb": args.max_total_pss_mb,
            "max_analysis_average_ms": args.max_analysis_average_ms,
        },
    }
    for metric in ("native_pss_mb", "total_pss_mb"):
        if all(metric in report for report in reports):
            summary[metric] = metric_summary(reports, metric)
    failures = gate_failures(summary, args)
    print_report(summary, failures)

    baseline = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "language": args.language,
        "device": device_info(adb),
        "analyzer": settings["analyzer"],
        "summary": summary,
        "runs": reports,
        "performance_gate": {"passed": not failures, "failures": failures},
    }
    baseline_path = args.baseline_out or settings["baseline"]
    write_json(baseline_path, baseline)
    print(f"Performance baseline saved: {baseline_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
