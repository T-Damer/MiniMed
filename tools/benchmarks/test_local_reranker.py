"""Contract tests; actual weights are exercised separately by the offline CPU smoke."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from local_reranker import FILES, MODEL_ID, REVISION, rank, validate_request, verify


def request():
    return {"query": "Как называется этот признак?", "analysisMode": "clinical", "candidates": [
        {"id": "private-id-a", "text": "Первое определение"},
        {"id": "private-id-b", "text": "Второе определение"}]}


class RankingContract(unittest.TestCase):
    def test_observe_is_default(self):
        result = rank(request(), lambda _: [0.0, 2.0])
        self.assertEqual(result["orderedIds"], ["private-id-a", "private-id-b"])
        self.assertEqual(result["experimentalIds"], ["private-id-b", "private-id-a"])
        self.assertFalse(result["applied"])

    def test_explicit_apply(self):
        self.assertEqual(rank(request(), lambda _: [0.0, 2.0], apply=True)["orderedIds"],
                         ["private-id-b", "private-id-a"])

    def test_ties_are_stable(self):
        self.assertEqual(rank(request(), lambda _: [0.5, 0.5], apply=True)["orderedIds"],
                         ["private-id-a", "private-id-b"])

    def test_input_does_not_contain_identifiers_or_labels(self):
        value = request()
        def score(pairs):
            self.assertEqual(pairs, [(value["query"], item["text"]) for item in value["candidates"]])
            self.assertNotIn("private-id", str(pairs))
            return [1.0, 0.0]
        rank(value, score)

    def test_does_not_mutate_source(self):
        value = request()
        before = deepcopy(value)
        rank(value, lambda _: [1.0, 2.0], apply=True)
        self.assertEqual(value, before)

    def test_lookup_never_invokes_model(self):
        value = request()
        value["analysisMode"] = "lookup"
        self.assertEqual(rank(value, lambda _: self.fail("model invoked"), apply=True)["status"],
                         "identity-bypass")

    def test_strict_identity_never_invokes_model(self):
        value = request()
        value["candidates"][1]["strictIdentity"] = True
        self.assertEqual(rank(value, lambda _: self.fail("model invoked"), apply=True)["status"],
                         "identity-bypass")

    def test_short_pools_do_not_invoke_model(self):
        for count in (0, 1):
            with self.subTest(count=count):
                value = request()
                value["candidates"] = value["candidates"][:count]
                self.assertEqual(rank(value, lambda _: self.fail("model invoked"))["status"],
                                 "insufficient-candidates")

    def test_bad_scores_fall_back(self):
        for scores in ([1.0], [1.0, 2.0, 3.0], [float("nan"), 0.0],
                       [float("inf"), 0.0], [True, 0.0], ["high", 0.0]):
            with self.subTest(scores=scores):
                result = rank(request(), lambda _: scores, apply=True)
                self.assertEqual(result["status"], "fallback")
                self.assertEqual(result["orderedIds"], ["private-id-a", "private-id-b"])
                self.assertNotIn("query", result)

    def test_model_exception_does_not_leak_query(self):
        def broken(_):
            raise RuntimeError("patient-private-text")
        result = rank(request(), broken, apply=True)
        self.assertEqual(result["status"], "fallback")
        self.assertNotIn("patient-private-text", json.dumps(result))

    def test_rejects_duplicate_identifier(self):
        value = request()
        value["candidates"][1]["id"] = "private-id-a"
        with self.assertRaises(ValueError):
            validate_request(value)

    def test_invalid_request_variants(self):
        mutations = [lambda x: x.update(query=""), lambda x: x.update(query="x" * 2049),
                     lambda x: x.update(query=12), lambda x: x.update(analysisMode="unknown"),
                     lambda x: x.update(candidates=None), lambda x: x.update(gold="leak"),
                     lambda x: x["candidates"][0].update(text=""),
                     lambda x: x["candidates"][0].update(text="x" * 4001),
                     lambda x: x["candidates"][0].update(strictIdentity=1),
                     lambda x: x["candidates"][0].update(relevanceGrade=3),
                     lambda x: x["candidates"][0].update(id=1)]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                value = request()
                mutate(value)
                with self.assertRaises(ValueError):
                    validate_request(value)

    def test_pool_bound(self):
        value = request()
        value["candidates"] = [{"id": str(i), "text": "definition"} for i in range(41)]
        with self.assertRaises(ValueError):
            validate_request(value)
        value["candidates"].pop()
        self.assertEqual(len(validate_request(value)["candidates"]), 40)

    def test_manifest_integrity(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            records = {}
            for name in FILES:
                data = name.encode()
                (directory / name).write_bytes(data)
                records[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            (directory / "minimed-manifest.json").write_text(json.dumps({"schemaVersion": 1,
                "modelId": MODEL_ID, "revision": REVISION, "files": records}))
            verify(directory)
            (directory / "config.json").write_text("changed")
            with self.assertRaises(ValueError):
                verify(directory)

    def test_socket_connections_are_blocked_in_subprocess(self):
        result = subprocess.run([sys.executable, "-c",
            "from local_reranker import disable_network; import socket; "
            "disable_network(); socket.create_connection(('127.0.0.1', 9), timeout=1)"],
            cwd=Path(__file__).parent, text=True, capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Network disabled", result.stderr)

    def test_missing_model_keeps_original_order(self):
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("local_reranker.py")),
                "serve", "--model-dir", str(Path(temp) / "missing")], input=json.dumps(request()) + "\n",
                text=True, capture_output=True, check=True)
            value = json.loads(result.stdout)
            self.assertEqual(value["status"], "fallback")
            self.assertEqual(value["orderedIds"], ["private-id-a", "private-id-b"])
            self.assertTrue(value["networkDisabled"])


if __name__ == "__main__":
    unittest.main()
