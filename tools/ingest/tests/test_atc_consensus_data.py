"""ATC3 data test: every consensus node of the patched ЕСКЛП modules is well formed.

Reads `documents.metadata_json` of the databases `scripts/build_atc_fill.py apply` writes (local
only, git-ignored: skipped where they are absent, e.g. in CI). `apply` runs the same check and
refuses to write invalid fields; this test re-reads the result.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
from pathlib import Path

import pytest

from localmed_ingest.atc_fill import consensus_problems

EXPECTED_CONSENSUS_NODES = 26


def main_checkout() -> Path:
    here = Path(__file__).resolve().parent
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=here,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    return Path(common).parent if common else here.parents[2]


def patched_databases() -> list[Path]:
    out = main_checkout() / "data" / "build" / "atc-fill"
    return sorted(out.glob("out*/patched/minimed.medications.*.ru.db"))[-15:]


@pytest.mark.skipif(
    not patched_databases(), reason="no patched ЕСКЛП modules in data/build/atc-fill"
)
def test_every_consensus_node_has_a_valid_code_and_two_independent_sources() -> None:
    problems: list[str] = []
    nodes = 0
    for path in patched_databases():
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            for document_id, raw in connection.execute("SELECT id, metadata_json FROM documents"):
                metadata = json.loads(raw)
                problems.extend(consensus_problems(metadata, document_id))
                nodes += sum(
                    1 for node in metadata.get("smnnNodes", []) if node.get("atcConsensus")
                )
        finally:
            connection.close()
    assert problems == []
    assert nodes == EXPECTED_CONSENSUS_NODES
