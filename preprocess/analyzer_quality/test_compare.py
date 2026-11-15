import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from preprocess.analyzer_quality.compare import (
    ComparisonConfig,
    Record,
    compare_records,
    load_jsonl,
    load_pack_records,
)


class AnalyzerQualityTest(unittest.TestCase):
    def test_compares_tagsets_exclusions_and_database_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_path = root / "reference.jsonl"
            candidate_path = root / "candidate.jsonl"
            db_path = root / "lemma_pack.db"
            reference_path.write_text(
                "\n".join([
                    json.dumps({
                        "id": 1,
                        "tokens": [
                            {"surface": "Dogs", "lemma": "dog", "pos": "NOUN"},
                            {"surface": "run", "lemma": "run", "pos": "VERB"},
                        ],
                    }),
                    json.dumps({
                        "id": 2,
                        "tokens": [
                            {"surface": "The", "lemma": None, "pos": "DET"},
                            {"surface": "cats", "lemma": "cat", "pos": "NOUN"},
                        ],
                    }),
                ]) + "\n",
                encoding="utf-8",
            )
            candidate_path.write_text(
                "\n".join([
                    json.dumps({
                        "id": 1,
                        "tokens": [
                            {"surface": "Dogs", "lemma": "DOG", "pos": "NNS"},
                            {"surface": "run", "lemma": "sprint", "pos": "VBG"},
                        ],
                    }),
                    json.dumps({
                        "id": 2,
                        "tokens": [
                            {"surface": "The", "lemma": "the", "pos": "DT"},
                            {"surface": "cats", "lemma": "CAT", "pos": "NNS"},
                        ],
                    }),
                ]) + "\n",
                encoding="utf-8",
            )
            connection = sqlite3.connect(db_path)
            try:
                connection.executescript(
                    """
                    CREATE TABLE lemma_stats (lemma_key TEXT PRIMARY KEY, payload TEXT NOT NULL);
                    INSERT INTO lemma_stats VALUES ('dog_NOUN', '{}');
                    INSERT INTO lemma_stats VALUES ('cat_NOUN', '{}');
                    """
                )
            finally:
                connection.close()

            config = ComparisonConfig.from_dict({
                "language": "en",
                "casefold_lemmas": True,
                "candidate_pos_map": {
                    "NNS": "NOUN",
                    "VBG": "VERB",
                    "DT": "DET",
                },
                "exclude_pos": ["DET"],
            })
            metrics, examples = compare_records(
                load_jsonl(reference_path),
                load_jsonl(candidate_path),
                config,
                lookup_db=db_path,
            )

            self.assertEqual(100.0, metrics["surface"]["exact_record_rate"])
            self.assertAlmostEqual(
                66.6667, metrics["annotation"]["exact_content_rate"], places=4
            )
            self.assertAlmostEqual(
                66.6667, metrics["database"]["occurrence_hit_rate"], places=4
            )
            self.assertTrue(any(item["kind"] == "annotation" for item in examples))

    def test_compares_morphs_instead_of_duplicate_parent_annotation(self):
        tokens = [{
            "surface": "첫마디로",
            "lemma": "첫마디",
            "pos": "NOUN",
            "morphs": [
                {"surface": "첫마디", "lemma": "첫마디", "pos": "NOUN"},
                {"surface": "로", "lemma": "로", "pos": "ADP"},
            ],
        }]
        records = {"1": Record("1", tokens)}
        config = ComparisonConfig.from_dict({
            "language": "ko",
            "exclude_pos": ["ADP"],
        })

        metrics, _ = compare_records(records, records, config)

        self.assertEqual(100.0, metrics["annotation"]["exact_content_rate"])
        self.assertEqual(1, metrics["database"]["candidate_lookup_occurrences"])

    def test_excludes_punctuation_numeric_surfaces_and_x_pos(self):
        reference = {
            "1": Record("1", [
                {"surface": "Dogs", "lemma": "dog", "pos": "NOUN"},
                {"surface": "(", "lemma": "(", "pos": "NOUN"},
                {"surface": "2026", "lemma": "2026", "pos": "NUM"},
                {"surface": "unknown", "lemma": "unknown", "pos": "X"},
            ])
        }
        candidate = {
            "1": Record("1", [
                {"surface": "Dogs", "lemma": "dog", "pos": "NOUN"},
                {"surface": "[", "lemma": "[", "pos": "PUNCT"},
                {"surface": "7", "lemma": "7", "pos": "NUM"},
                {"surface": "different", "lemma": "different", "pos": "X"},
            ])
        }
        config = ComparisonConfig.from_dict({
            "exclude_punctuation_surfaces": True,
            "exclude_numeric_surfaces": True,
            "exclude_pos": ["X"],
            "exclude_x_pos_tokens": True,
        })

        metrics, examples = compare_records(reference, candidate, config)

        self.assertEqual(100.0, metrics["surface"]["exact_record_rate"])
        self.assertEqual(1, metrics["annotation"]["reference_content_tokens"])
        self.assertEqual(100.0, metrics["annotation"]["exact_content_rate"])
        self.assertEqual([], examples)

    def test_loads_pack_rows_for_candidate_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "lemma_pack.db"
            connection = sqlite3.connect(db_path)
            try:
                connection.executescript(
                    """
                    CREATE TABLE lines (line_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                    INSERT INTO lines VALUES (4, '{"tokens":[{"surface":"x"}]}');
                    INSERT INTO lines VALUES (8, '{"tokens":[{"surface":"y"}]}');
                    """
                )
            finally:
                connection.close()

            records = load_pack_records(db_path, ["8"])

            self.assertEqual(["8"], list(records))
            self.assertEqual("y", records["8"].tokens[0]["surface"])


if __name__ == "__main__":
    unittest.main()
