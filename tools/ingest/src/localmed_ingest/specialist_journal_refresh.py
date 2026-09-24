"""Offline source replay, conservative label intake and ordinary reference selection.

Article text, identities and dates are never reconciled with another medical source.
Acquisition evidence and rejected label proposals stay outside runtime inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from collections import Counter
from pathlib import Path

from .definition_reference_pack import encoded, normalized_name, number, obj, seq, text
from .definition_source_manifest import read_source_manifest, write_source_manifest
from .definition_source_policy import require_active_definition_source
from .specialist_journal_admission import admit_article
from .specialist_journal_intake import compose


def compose_selected(collections: tuple[Path, ...], output: Path) -> dict[str, object]:
    if output.exists() or not 1 <= len(collections) <= 4:
        raise ValueError("Use 1..4 explicit collections and a new output directory")
    if len({path.resolve() for path in collections}) != len(collections):
        raise ValueError("Duplicate journal acquisition collection")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="journal-selected-", dir=output.parent) as temporary:
        work = Path(temporary)
        selected = work / "selected"
        selected.mkdir()
        counts: Counter[str] = Counter()
        outcomes: list[dict[str, object]] = []
        identities: set[str] = set()
        filenames: set[str] = set()
        for index, collection in enumerate(collections):
            replay_dir = work / f"replay-{index}"
            replay = compose(collection, replay_dir)
            for value in seq(replay.get("articles"), 24):
                row = obj(value)
                if row.get("status") != "selected-requires-clinical-review":
                    outcomes.append({**row, "collection": collection.as_posix()})
                    counts["pendingArticles"] += 1
                    continue
                filename = text(row.get("prepared"), 255)
                path = (replay_dir / filename).resolve(strict=True)
                if path.parent != replay_dir.resolve() or filename in filenames:
                    raise ValueError("Conflicting or invalid article projection filename")
                filenames.add(filename)
                candidate = path.read_bytes()
                if hashlib.sha256(candidate).hexdigest() != row.get("preparedSha256"):
                    raise ValueError("Replayed article no longer matches its receipt")
                payload, admission = admit_article(json.loads(candidate))
                require_active_definition_source(payload)
                terms = [obj(item) for item in seq(payload["terms"], 5000)]
                for term in terms:
                    identity = text(term["id"], 256)
                    if identity in identities:
                        raise ValueError("An article or source record was selected twice")
                    identities.add(identity)
                data = encoded(payload).encode("utf-8")
                (selected / filename).write_bytes(data)
                counts["articles"] += 1
                for key, count in obj(admission["counts"]).items():
                    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                        raise ValueError("Invalid admission count")
                    counts[key] += count
                outcomes.append(
                    {
                        **row,
                        "collection": collection.as_posix(),
                        "prepared": filename,
                        "preparedSha256": hashlib.sha256(data).hexdigest(),
                        "replayedCandidateSha256": hashlib.sha256(candidate).hexdigest(),
                        "records": len(terms),
                        "names": [term["title"] for term in terms],
                        "distinctNormalizedNames": len(
                            {normalized_name(text(t["title"])) for t in terms}
                        ),
                        "admission": admission,
                    }
                )
        if not counts["articles"]:
            raise ValueError("No eligible source article was selected")
        report = {
            "version": 1,
            "counts": dict(counts),
            "articles": outcomes,
            "networkRequests": 0,
            "boundary": (
                "Original journal text and source-local proposals. Article overviews and "
                "contextual headings are not independent clinical concepts. Rights, author dates "
                "and all source blocks are retained; no scoring or medical approval is created."
            ),
        }
        (selected / "selection-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.rename(selected, output)
    return report


def activate(root: Path, output: Path, report: dict[str, object]) -> dict[str, object]:
    root = root.resolve()
    manifest = root / "content/definition-drafts/source-inputs.json"
    previous = manifest.read_bytes()
    paths, before_count = read_source_manifest(root, manifest)
    source_rows = [obj(value) for value in seq(obj(json.loads(previous))["inputs"], 32)]
    before_names: set[str] = set()
    previous_ids: set[str] = set()
    for path in paths:
        payload = obj(json.loads(path.read_bytes()))
        require_active_definition_source(payload)
        for item in seq(payload["terms"], 50000):
            term = obj(item)
            previous_ids.add(text(term["id"], 256))
            before_names.add(normalized_name(text(term["title"])))
    additions: list[Path] = []
    new_names: set[str] = set()
    existing_names: set[str] = set()
    new_ids: set[str] = set()
    for value in seq(report["articles"], 96):
        article = obj(value)
        if article.get("status") != "selected-requires-clinical-review":
            continue
        path = output / text(article["prepared"], 255)
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != article["preparedSha256"]:
            raise ValueError("Selected article receipt mismatch")
        payload = obj(json.loads(data))
        require_active_definition_source(payload)
        additions.append(path)
        for item in seq(payload["terms"], 5000):
            term = obj(item)
            identifier = text(term["id"], 256)
            if identifier in previous_ids or identifier in new_ids:
                raise ValueError("Already active or duplicate journal source record")
            new_ids.add(identifier)
            normalized = normalized_name(text(term["title"]))
            (existing_names if normalized in before_names else new_names).add(normalized)
    staged = output / "next-source-inputs.json"
    next_manifest = write_source_manifest(root, (*paths, *additions), staged)
    if number(next_manifest["entries"]) != before_count + len(new_ids):
        raise ValueError("New reference count does not match selected article identities")
    if manifest.read_bytes() != previous:
        raise ValueError("Source selection changed during journal preparation")
    manifest.write_bytes(staged.read_bytes())
    staged.unlink()
    refresh = {
        "previousRecords": before_count,
        "addedRecords": len(new_ids),
        "combinedRecords": before_count + len(new_ids),
        "newNormalizedNames": len(new_names),
        "existingNormalizedNamesWithNewSource": len(existing_names),
        "previousInputs": source_rows,
        "newInputs": [path.relative_to(root).as_posix() for path in additions],
        "previousManifestSha256": hashlib.sha256(previous).hexdigest(),
        "activeManifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
    }
    report["refresh"] = refresh
    (output / "selection-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--collection", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    report = compose_selected(tuple(args.collection), args.output)
    if args.activate:
        report = activate(args.root, args.output.resolve(), report)
    print(json.dumps({"counts": report["counts"], "refresh": report.get("refresh")}, indent=2))


if __name__ == "__main__":
    main()
