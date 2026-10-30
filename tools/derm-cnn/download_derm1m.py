#!/usr/bin/env python3
"""Downloads Derm1M (huggingface.co/datasets/redlessone/Derm1M, gated, CC BY-NC 4.0) into
data/raw/derm/derm1m: the label tables and ontology by default, image archives by name. The owner
accepts the terms on Hugging Face; the read token comes from HF_TOKEN or the repository's .env and
is never printed."""

from __future__ import annotations

import argparse
import os
import shutil
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = "redlessone/Derm1M"
TABLES = [
    "Derm1M_v2_pretrain.csv",
    "Derm1M_v2_validation.csv",
    "ontology.json",
    "concept.csv",
]


def token() -> str:
    value = os.environ.get("HF_TOKEN", "")
    if not value:
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("HF_TOKEN="):
                value = line.removeprefix("HF_TOKEN=").strip().strip("\"'")
    if not value:
        raise SystemExit("HF_TOKEN is not set (environment or .env)")
    return value


def fetch(name: str, out: Path) -> Path:
    """Downloads one file, resuming after a stalled or dropped connection (multi-GB archives)."""
    from huggingface_hub import hf_hub_download

    for attempt in range(8):
        try:
            return Path(
                hf_hub_download(
                    REPO, name, repo_type="dataset", local_dir=out, token=token()
                )
            )
        except Exception as error:
            if attempt == 7:
                raise
            print(f"retry {name}: {type(error).__name__}", flush=True)
            time.sleep(15 * (attempt + 1))
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "archives", nargs="*", help="image archives to fetch, e.g. pubmed.zip"
    )
    parser.add_argument("--out", type=Path, default=ROOT / "data/raw/derm/derm1m")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    for name in args.archives or TABLES:
        # An archive unpacks into images/<archive name>/, the folder its rows name in the tables
        # (the archives themselves have no top folder, and file names repeat across them).
        folder = args.out / "images" / name.removesuffix(".zip")
        if name.endswith(".zip") and folder.is_dir():
            print(f"have {name}", flush=True)
            continue
        path = fetch(name, args.out)
        if path.suffix == ".zip":
            partial = folder.with_name(f"{folder.name}.partial")
            with zipfile.ZipFile(path) as bundle:
                bundle.extractall(partial)
            # Drop a single wrapping folder if an archive has one.
            inner = [entry for entry in partial.iterdir() if entry.name != "__MACOSX"]
            source = inner[0] if len(inner) == 1 and inner[0].is_dir() else partial
            source.rename(folder)
            if partial.exists():
                shutil.rmtree(partial)
            path.unlink()
        print(f"ok {name}", flush=True)


if __name__ == "__main__":
    main()
