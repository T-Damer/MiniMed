"""LEAF1 for the manufacturer-site instruction workspace.

The manufacturer builder reads one prepared Markdown per document from the first workspace of
`PREPARED_DIRS` that holds it. This re-renders the documents whose extraction holds a leaflet
contents list (`grls_contents_lists.py`) into `prepared-contents`, which comes first; the other
workspaces and the raw files are left alone.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .grls_contents_lists import BodyNotReproducedError, rerender_contents
from .manufacturer_instruction_modules import CONTENTS_DIR, PREPARED_DIRS
from .models import ExtractedSource


def rerender_manufacturer(workspace: Path | None) -> dict[str, Any]:
    if workspace is None:
        raise SystemExit("--workspace is required.")
    sources = [workspace / name for name in PREPARED_DIRS if name != CONTENTS_DIR]
    target = workspace / CONTENTS_DIR
    if target.exists():
        shutil.rmtree(target)
    seen: set[str] = set()
    written: list[str] = []
    not_reproduced: list[str] = []
    documents = 0
    for directory in sources:
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.md")):
            document_id = path.stem
            if document_id in seen:
                continue
            seen.add(document_id)
            documents += 1
            extraction = directory / ".localmed" / "extractions" / f"{document_id}.json"
            try:
                result = rerender_contents(
                    document_id,
                    path.read_text(encoding="utf-8"),
                    ExtractedSource.model_validate_json(extraction.read_text(encoding="utf-8")),
                )
            except BodyNotReproducedError:
                not_reproduced.append(document_id)
                continue
            if result is None:
                continue
            target.mkdir(exist_ok=True)
            (target / f"{document_id}.md").write_text(result.markdown, encoding="utf-8")
            written.append(document_id)
    return {
        "workspace": str(target),
        "documents": documents,
        "withContentsList": len(written),
        "notReproduced": not_reproduced,
        "documentIds": written,
    }
