"""Install one independently refetched, immutable definition-completion batch."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from .clinic_definition_completions import collect, load_projection
from .definition_gap_inventory import build_gap_inventory
from .definition_name_completions import apply_name_completions
from .definition_reference_pack import Projection, encoded, obj, seq


def census(projection: Projection) -> dict[str, object]:
    return {key: value for key, value in build_gap_inventory(projection).items() if key != "rows"}


def run(root: Path, authoring: Path, batch: str) -> dict[str, object]:
    if re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,70}", batch) is None:
        raise ValueError("Invalid batch identity")
    output = root / f"content/definition-drafts/selected-completions-{batch}.json"
    receipt = root / f"docs/research/selected-completions-{batch}.json"
    manifest = root / "content/definition-drafts/completion-inputs.json"
    if output.exists() or receipt.exists():
        raise ValueError("A batch identity is immutable; select a fresh one")
    before = load_projection(root)
    before_census = census(before)
    old_identities = {
        key: (entry.title, entry.kind, list(entry.names), list(entry.links))
        for key, entry in before.entries.items()
    }
    old_blocks = {
        key: (source.id, chunk.original_text, chunk.anchor, encoded(chunk.metadata))
        for key, (source, chunk) in before.chunks.items()
    }
    bundle, acquisition = collect(root, authoring)
    report: dict[str, object] = {
        "batch": batch,
        "before": before_census,
        "acquisition": acquisition,
        "boundary": "Source-local short excerpts; not clinician reviewed, public release or clinical rules.",
    }
    receipt.parent.mkdir(parents=True, exist_ok=True)
    if acquisition["accepted"] == 0:
        report["after"] = before_census
        receipt.write_text(encoded(report) + "\n", encoding="utf-8")
        raise ValueError("No source definition accepted; reasons retained in the batch receipt")
    obj(bundle["catalog"])["id"] = f"selected-completions-{batch}"
    raw = (encoded(bundle) + "\n").encode("utf-8")
    checksum = hashlib.sha256(raw).hexdigest()
    apply_name_completions(before, bundle, checksum)
    original_manifest = manifest.read_bytes()
    payload = obj(json.loads(original_manifest))
    inputs = list(seq(payload.get("inputs"), 16))
    if len(inputs) >= 16:
        raise ValueError("Completion manifest capacity reached")
    inputs.append({"path": str(output.relative_to(root)), "bytes": len(raw), "sha256": checksum})
    payload["inputs"] = inputs
    output.write_bytes(raw)
    try:
        manifest.write_text(encoded(payload) + "\n", encoding="utf-8")
        after = load_projection(root)
        if set(after.entries) != set(old_identities):
            raise ValueError("Source identities changed during a completion-only batch")
        for key, (title, kind, names, links) in old_identities.items():
            entry = after.entries[key]
            if (entry.title, entry.kind, entry.names) != (title, kind, names):
                raise ValueError("An existing source name changed")
            if not set(links).issubset(entry.links):
                raise ValueError("An existing source link disappeared")
        for key, expected in old_blocks.items():
            source, chunk = after.chunks[key]
            if (source.id, chunk.original_text, chunk.anchor, encoded(chunk.metadata)) != expected:
                raise ValueError("An existing source block changed")
        report.update(
            {
                "after": census(after),
                "identitiesRetained": len(old_identities),
                "unchangedSourceBlocks": len(old_blocks),
                "bundleSha256": checksum,
            }
        )
        receipt.write_text(encoded(report) + "\n", encoding="utf-8")
    except Exception:
        manifest.write_bytes(original_manifest)
        output.unlink()
        raise
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--authoring", type=Path, required=True)
    parser.add_argument("--batch", required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.root.resolve(), args.authoring.resolve(), args.batch), ensure_ascii=False))


if __name__ == "__main__":
    main()
