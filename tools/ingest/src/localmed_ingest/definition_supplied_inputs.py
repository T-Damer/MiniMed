"""Receipt-bound supplied excerpts for the ordinary knowledge edition, not a second store.

A matching PDF hash identifies the input; it does not establish clinical correctness or
prove that arbitrary prepared prose is faithful. Replay/review remains a separate gate.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from .definition_reference_pack import MAX_INPUT_BYTES, Projection, obj, seq, text

FORMAT = "minimed-supplied-reference-v1"
MAX_SOURCE_BYTES = 512 * 1024 * 1024
MAX_INPUTS = 32


@dataclass(frozen=True)
class SuppliedInput:
    payload: bytes
    sha256: str
    entries: int
    definitions: int
    abbreviations: int


def _relative(root: Path, value: object) -> Path:
    name = text(value, 4096)
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError("Supplied input must be relative to its configured root")
    actual = (root / path).resolve(strict=True)
    if not actual.is_relative_to(root.resolve(strict=True)) or not actual.is_file():
        raise ValueError("Supplied input escapes its configured root")
    return actual


def _sha(value: object) -> str:
    result = text(value, 64)
    if not re.fullmatch(r"[0-9a-f]{64}", result):
        raise ValueError("Invalid supplied-source checksum")
    return result


def _size(value: object, maximum: int) -> int:
    if type(value) is not int or not 0 < value <= maximum:
        raise ValueError("Invalid supplied-source byte budget")
    return value


def _verified_file(root: Path, receipt: dict[str, object], maximum: int) -> Path:
    if set(receipt) != {"path", "sha256", "bytes"}:
        raise ValueError("Invalid supplied-source receipt fields")
    path = _relative(root, receipt["path"])
    size = _size(receipt["bytes"], maximum)
    if path.stat().st_size != size:
        raise ValueError("Supplied-source byte count differs from its receipt")
    with path.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    if checksum != _sha(receipt["sha256"]):
        raise ValueError("Supplied-source checksum differs from its receipt")
    return path


def load_supplied_inputs(root: Path, manifest: Path) -> tuple[SuppliedInput, ...]:
    """Validate all declared originals and V3 excerpts before returning immutable snapshots."""
    root = root.resolve(strict=True)
    path = _relative(root, manifest.as_posix())
    if path.stat().st_size > 65536:
        raise ValueError("Supplied-source manifest exceeds its budget")
    config = obj(json.loads(path.read_bytes()))
    if (
        set(config) != {"format", "publicationState", "sources", "inputs"}
        or config["format"] != FORMAT
        or config["publicationState"] != "local-dev"
    ):
        raise ValueError("Unsupported supplied-source manifest")
    originals: dict[str, str] = {}
    for value in seq(config["sources"], MAX_INPUTS):
        receipt = obj(value)
        original = _verified_file(root, receipt, MAX_SOURCE_BYTES)
        with original.open("rb") as stream:
            if original.suffix.lower() != ".pdf" or not stream.read(5).startswith(b"%PDF-"):
                raise ValueError("Supplied original must be a PDF")
        checksum = _sha(receipt["sha256"])
        if checksum in originals:
            raise ValueError("Duplicate supplied original")
        originals[checksum] = original.name
    if not originals:
        raise ValueError("Missing supplied originals")
    results: list[SuppliedInput] = []
    used: set[str] = set()
    seen: set[str] = set()
    validation = Projection()
    for value in seq(config["inputs"], MAX_INPUTS):
        receipt = obj(value)
        prepared = _verified_file(root, receipt, MAX_INPUT_BYTES)
        payload = prepared.read_bytes()
        checksum = hashlib.sha256(payload).hexdigest()
        # Recheck the exact immutable bytes to close replacement between verify and read.
        if checksum != receipt["sha256"] or len(payload) != receipt["bytes"]:
            raise ValueError("Supplied excerpt changed while being read")
        if checksum in seen:
            raise ValueError("Duplicate supplied excerpt")
        seen.add(checksum)
        catalog = obj(json.loads(payload))
        if catalog.get("version") != 3:
            raise ValueError("Supplied excerpts must use the source-preserving V3 format")
        for entry in seq(catalog.get("sources"), MAX_INPUTS):
            descriptor = obj(entry)
            source_hash = _sha(descriptor.get("sourceSha256"))
            if (
                descriptor.get("sourceType") != "owner-pdf"
                or descriptor.get("releaseEligible") is not False
                or descriptor.get("baseUrl") != ""
                or descriptor.get("path", "") != ""
                or source_hash not in originals
                or descriptor.get("fileName") != originals[source_hash]
            ):
                raise ValueError("Excerpt is not bound to its declared local PDF")
            used.add(source_hash)
        validation.add(catalog, checksum)
        definitions = abbreviations = 0
        terms = seq(catalog.get("terms"), 50000)
        for term in terms:
            row = obj(term)
            if row.get("extractionRole") == "abbreviation-expansion":
                abbreviations += 1
            elif row.get("coverage") in {"definition", "explicit-definition"}:
                definitions += 1
        results.append(SuppliedInput(payload, checksum, len(terms), definitions, abbreviations))
    if not results or used != set(originals):
        raise ValueError("Missing excerpts or an unused supplied original")
    return tuple(results)


def register_supplied_inputs(
    root: Path, manifest: Path, inputs: tuple[Path, ...], originals: tuple[Path, ...]
) -> dict[str, object]:
    """Register selected existing files; never copy, edit or upload their original contents."""
    import os
    import tempfile

    root = root.resolve(strict=True)
    if manifest.is_absolute() or ".." in manifest.parts or "\\" in str(manifest):
        raise ValueError("Manifest must be relative to its configured root")
    target = (root / manifest).resolve()
    if not target.is_relative_to(root.resolve(strict=True)) or target.exists():
        raise ValueError("Choose a new manifest inside the supplied root")
    if not 1 <= len(inputs) <= MAX_INPUTS or not 1 <= len(originals) <= MAX_INPUTS:
        raise ValueError("Choose 1..32 supplied inputs and originals")

    def receipt(path: Path, maximum: int) -> dict[str, object]:
        actual = _relative(root, path.as_posix())
        size = _size(actual.stat().st_size, maximum)
        with actual.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        return {"path": path.as_posix(), "bytes": size, "sha256": checksum}

    config: dict[str, object] = {
        "format": FORMAT,
        "publicationState": "local-dev",
        "sources": [receipt(p, MAX_SOURCE_BYTES) for p in originals],
        "inputs": [receipt(p, MAX_INPUT_BYTES) for p in inputs],
    }
    with tempfile.TemporaryDirectory(prefix=".supplied-reference-", dir=root) as directory:
        staged = Path(directory) / "manifest.json"
        staged.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        load_supplied_inputs(root, staged.relative_to(root.resolve()))
        target.parent.mkdir(parents=True, exist_ok=True)
        os.link(staged, target)
    return config


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--source", type=Path, action="append", required=True)
    args = parser.parse_args()
    register_supplied_inputs(
        args.root.resolve(), args.manifest, tuple(args.input), tuple(args.source)
    )
    print(
        json.dumps(
            {"status": "registered", "inputs": len(args.input), "originals": len(args.source)}
        )
    )


if __name__ == "__main__":
    main()
