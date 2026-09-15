"""Generate tiny, explicitly synthetic databases for real-browser terminology regressions.

These are test assets, never a public clinical corpus or a source for a release build.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

from localmed_ingest.terminology_sources import sha256_file
from test_terminology_mentions import compose, discovery, pointer, source


def build(output: Path) -> None:
    if output.exists():
        raise ValueError("Choose a new fixture output directory.")
    output.mkdir(parents=True)
    try:
        for name, include_source in (("discovery", False), ("installed", True)):
            with tempfile.TemporaryDirectory(prefix="terminology-browser-") as directory:
                root = Path(directory)
                terms = discovery(root)
                original = source(root)
                catalog = pointer(root)
                database = compose(
                    root, [terms, catalog, *([original] if include_source else [])], [original]
                )
                destination = output / f"{name}.db"
                shutil.copyfile(database, destination)
                (output / f"{name}-report.json").write_text(
                    json.dumps(
                        {"outputChecksum": sha256_file(destination), "syntheticFixture": True}
                    )
                    + "\n",
                    encoding="utf-8",
                )
    except Exception:
        shutil.rmtree(output)
        raise


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_terminology_e2e.py NEW_OUTPUT_DIRECTORY")
    build(Path(sys.argv[1]))
