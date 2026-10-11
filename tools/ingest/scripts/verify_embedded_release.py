# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2"]
# ///
"""Verify a published embedding release end to end (STATE KD1): app pins, mirror branches, modules.

Read-only. Nothing is downloaded in bulk: a mirror file is compared with its local release copy
through the git blob SHA-1 the GitHub tree API reports (`gh` must be logged in).

- Query model: every file pinned in `apps/app/src/features/semantic/e5-model.ts` (size, SHA-256,
  parts) against `--model-dir`, and every published file against the mirror branch of the pinned
  revision.
- Modules: every catalog module whose version carries `--marker`: its archive in one of `--source`
  directories has the catalog SHA-256 and size and the same bytes on its `datasets/<tag>` branch;
  decoded, it has the catalog decoded SHA-256 and size, passes `PRAGMA quick_check`, holds exactly
  the expected embedding profile, and one 384-byte int8 vector with a consistent norm for every
  chunk of its family (all chunks of a recommendation, the indication sections of a drug module).

    uv run tools/ingest/scripts/verify_embedded_release.py --marker kd1 \\
      --source output/module-zstd-kd1-2026-10-11 --source output/module-zstd-drug-kd1-2026-10-11 \\
      --model-dir data/build/kd1/query-encoder
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
CATALOG = REPO / "apps/app/src/features/modules/catalog.preview.json"
MODEL_PINS = REPO / "apps/app/src/features/semantic/e5-model.ts"
PROFILE_SOURCE = REPO / "packages/search-semantic/src/profile.ts"
OWNER_REPO = "T-Damer/MiniMed"
INDICATIONS = """WHERE s.section_type = 'indications'
                  OR s.title IN ('Показания', 'Показания к применению', 'ПОКАЗАНИЯ К ПРИМЕНЕНИЮ')"""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def git_blob(path: Path) -> str:
    return subprocess.run(
        ["git", "hash-object", str(path)], check=True, capture_output=True, text=True
    ).stdout.strip()


def mirror_tree(tag: str) -> dict[str, tuple[int, str]]:
    """path → (size, blob sha1) of the `datasets/<tag>` branch."""
    out = subprocess.run(
        ["gh", "api", f"repos/{OWNER_REPO}/git/trees/datasets/{tag}?recursive=1"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    tree = json.loads(out)
    if tree.get("truncated"):
        raise SystemExit(f"tree of datasets/{tag} is truncated")
    return {
        item["path"]: (item["size"], item["sha"]) for item in tree["tree"] if item["type"] == "blob"
    }


def expected_profile() -> dict[str, str]:
    """id and fingerprint of KD1_PROFILE as the app declares them."""
    text = PROFILE_SOURCE.read_text()
    block = text[text.index("export const KD1_PROFILE") :]
    found = {
        key: re.search(rf"{key}:\s*'([^']+)'", block)
        for key in ("id", "generator", "generatorVersion")
    }
    fingerprint = re.search(r"fingerprint:\s*'([^']+)'", block, re.S) or re.search(
        r"fingerprint:\s*\n\s*'([^']+)'", block
    )
    if not all(found.values()) or not fingerprint:
        raise SystemExit("could not read KD1_PROFILE")
    return {key: match.group(1) for key, match in found.items() if match} | {
        "fingerprint": fingerprint.group(1)
    }


def check_model(model_dir: Path, problems: list[str]) -> None:
    text = MODEL_PINS.read_text()
    revision = re.search(r"E5_MODEL_REVISION = '([^']+)'", text)
    if not revision:
        problems.append("model: no E5_MODEL_REVISION")
        return
    entries = re.findall(
        r"path: '([^']+)',\s*sizeBytes: ([\d_]+),\s*sha256: '([0-9a-f]{64})'", text
    )
    tree = mirror_tree(revision.group(1))
    checked = 0
    for path, size, digest in entries:
        size_value = int(size.replace("_", ""))
        local = model_dir / path
        if path == "onnx/model_quantized.onnx":
            parts = sorted(model_dir.glob("onnx/model_quantized.onnx.part-*"))
            joined = hashlib.sha256()
            total = 0
            for part in parts:
                data = part.read_bytes()
                joined.update(data)
                total += len(data)
            if total != size_value or joined.hexdigest() != digest:
                problems.append(f"model: joined {path} differs from the pin")
            checked += 1
            continue
        if not local.exists():
            problems.append(f"model: {path} missing locally")
            continue
        if local.stat().st_size != size_value or sha256(local) != digest:
            problems.append(f"model: {path} differs from the pin")
        mirrored = tree.get(f"models/kd1-query-encoder/{path}")
        if not mirrored or mirrored[1] != git_blob(local):
            problems.append(f"model: {path} differs on the mirror")
        checked += 1
    for local in sorted(model_dir.rglob("*")):
        if local.is_file():
            rel = local.relative_to(model_dir).as_posix()
            mirrored = tree.get(f"models/kd1-query-encoder/{rel}")
            if not mirrored or mirrored[1] != git_blob(local):
                problems.append(f"model: {rel} differs on the mirror")
    print(f"model {revision.group(1)}: {checked} pinned files, {len(tree)} mirrored files checked")


def check_module(
    module: dict, archive: Path, profile: dict[str, str], tree_entry: tuple[int, str] | None
) -> list[str]:
    problems: list[str] = []
    artifact = next(a for a in module["artifacts"] if a["kind"] == "index")
    name = module["id"]
    if archive.stat().st_size != artifact["sizeBytes"]:
        problems.append(f"{name}: archive size")
    if f"sha256:{sha256(archive)}" != artifact["sha256"]:
        problems.append(f"{name}: archive sha256")
    if tree_entry is None or tree_entry[1] != git_blob(archive):
        problems.append(f"{name}: mirror blob differs or is missing")
    with tempfile.TemporaryDirectory() as scratch:
        decoded = Path(scratch) / "module.db"
        subprocess.run(["zstd", "-dqf", "--long=27", str(archive), "-o", str(decoded)], check=True)
        if decoded.stat().st_size != artifact["decodedSizeBytes"]:
            problems.append(f"{name}: decoded size")
        if f"sha256:{sha256(decoded)}" != artifact["decodedSha256"]:
            problems.append(f"{name}: decoded sha256")
        db = sqlite3.connect(f"file:{decoded}?mode=ro", uri=True)
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            problems.append(f"{name}: quick_check")
        profiles = db.execute(
            "SELECT id, generator, generator_version, fingerprint FROM embedding_profiles"
        ).fetchall()
        wanted = (
            profile["id"],
            profile["generator"],
            profile["generatorVersion"],
            profile["fingerprint"],
        )
        if profiles != [wanted]:
            problems.append(f"{name}: embedding profiles {profiles}")
        family = "" if name.startswith("minimed.clinical.") else INDICATIONS
        expected = {
            row[0]
            for row in db.execute(
                f"""SELECT c.id FROM chunks c JOIN sections s ON s.id = c.section_id {family}"""
            )
        }
        rows = db.execute(
            "SELECT profile_id, chunk_id, vector, vector_norm FROM chunk_embeddings"
        ).fetchall()
        db.close()
    embedded = {row[1] for row in rows}
    if embedded != expected or len(rows) != len(expected):
        problems.append(
            f"{name}: {len(rows)} vectors for {len(expected)} chunks "
            f"({len(expected - embedded)} missing, {len(embedded - expected)} extra)"
        )
    for profile_id, chunk_id, vector, norm in rows:
        values = np.frombuffer(vector, dtype=np.int8).astype(np.int32)
        if profile_id != profile["id"] or len(vector) != 384:
            problems.append(f"{name}: {chunk_id} vector shape or profile")
            break
        if not values.any() or abs(math.sqrt(float(values @ values)) - norm) > 1e-3:
            problems.append(f"{name}: {chunk_id} zero vector or norm mismatch")
            break
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--marker", required=True)
    parser.add_argument("--source", type=Path, action="append", default=[])
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    problems: list[str] = []
    check_model(args.model_dir, problems)
    profile = expected_profile()
    catalog = json.loads(CATALOG.read_text())
    modules = [m for m in catalog["modules"] if m["version"].endswith(f".{args.marker}")]
    archives = {p.name: p for source in args.source for p in source.rglob("*.db.zst")}
    trees: dict[str, dict[str, tuple[int, str]]] = {}
    jobs = []
    for module in modules:
        artifact = next(a for a in module["artifacts"] if a["kind"] == "index")
        tag, file_name = artifact["url"].split("/releases/download/", 1)[1].split("/", 1)
        if tag not in trees:
            trees[tag] = mirror_tree(tag)
        prefix = (
            "apps/app/public/content/clinical"
            if module["id"].startswith("minimed.clinical.")
            else "modules"
        )
        archive = archives.get(file_name)
        if archive is None:
            problems.append(f"{module['id']}: no local release copy of {file_name}")
            continue
        jobs.append((module, archive, trees[tag].get(f"{prefix}/{file_name}")))
    with ThreadPoolExecutor(args.workers) as pool:
        for found in pool.map(lambda job: check_module(job[0], job[1], profile, job[2]), jobs):
            problems.extend(found)
    print(
        f"modules: {len(modules)} with marker .{args.marker}, {len(jobs)} checked "
        f"on {len(trees)} mirror branches; profile {profile['id']}"
    )
    for problem in problems:
        print(f"PROBLEM {problem}")
    print("OK" if not problems else f"{len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
