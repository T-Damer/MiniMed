#!/usr/bin/env python3
"""Builds the skin pack the app installs: the trained model (its manifest and graphs) and a few
reference photos per class for the atlas, as one ZIP. Photos come only from sources that allow
sharing — SCIN (attribution, no re-identification), PAD-UFES-20 (CC BY 4.0) and Wikimedia Commons
(CC0 / public domain / CC BY / CC BY-SA, credited per photo). For every class the model scores the
candidates and the photos it is surest of, one per patient, are kept; SCIN cases of the genitals,
groin or buttocks are never used. `--sheet DIR` writes a contact sheet per class for review, and
`--exclude` drops photos a reviewer rejected (by the id the sheet shows)."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import eval_onnx
import train_skin_cnn as t
from derm_sources import commons_records, label_map
from PIL import Image, ImageDraw, ImageOps

FORMAT = "minimed-skin-pack"
FORMAT_VERSION = 1
SIDE = 640
PER_CLASS = 3
SCIN_PRIVATE = ("body_parts_genitalia_or_groin", "body_parts_buttocks")
SOURCES = {
    "scin": {
        "name": "SCIN (Google)",
        "licence": "SCIN Data Use License",
        "url": "https://github.com/google-research-datasets/scin",
    },
    "pad": {
        "name": "PAD-UFES-20",
        "licence": "CC BY 4.0",
        "url": "https://data.mendeley.com/datasets/zr7vgbcyr2/1",
    },
}


def scin_private_cases(root: Path) -> set[str]:
    with (root / "scin_cases.csv").open(encoding="utf-8") as handle:
        return {
            row["case_id"]
            for row in csv.DictReader(handle)
            if any(row.get(key, "").strip().upper() == "YES" for key in SCIN_PRIVATE)
        }


def commons_credits(root: Path) -> dict[str, dict[str, str]]:
    index = root / "index.csv"
    if not index.exists():
        return {}
    with index.open(encoding="utf-8") as handle:
        return {str(root / row["file"]): row for row in csv.DictReader(handle)}


def photo_id(path: Path) -> str:
    return hashlib.sha1(str(path).encode()).hexdigest()[:12]


def credit(record, commons: dict[str, dict[str, str]]) -> dict[str, str]:
    if record.source == "commons":
        row = commons[str(record.image)]
        return {
            "source": "Wikimedia Commons",
            "author": row["author"],
            "licence": row["licence"],
            "url": row["page"],
        }
    source = SOURCES[record.source]
    return {
        "source": source["name"],
        "author": "",
        "licence": source["licence"],
        "url": source["url"],
    }


def encode_avif(path: Path) -> tuple[bytes, int, int]:
    image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    image.thumbnail((SIDE, SIDE))
    out = io.BytesIO()
    image.save(out, format="AVIF", quality=55, speed=4)
    return out.getvalue(), image.width, image.height


def contact_sheet(
    target: Path, title: str, items: list[tuple[str, Path, float]]
) -> None:
    tiles = []
    for pid, path, score in items:
        tile = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        tile.thumbnail((260, 260))
        canvas = Image.new("RGB", (260, 285), "white")
        canvas.paste(tile, ((260 - tile.width) // 2, 0))
        ImageDraw.Draw(canvas).text((4, 266), f"{pid} {score:.2f}", fill="black")
        tiles.append(canvas)
    sheet = Image.new("RGB", (260 * 4, 285 * ((len(tiles) + 3) // 4) + 20), "white")
    ImageDraw.Draw(sheet).text((4, 4), title, fill="black")
    for index, tile in enumerate(tiles):
        sheet.paste(tile, (260 * (index % 4), 20 + 285 * (index // 4)))
    sheet.save(target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "run", type=Path, help="model run or ensemble with skin-model.json"
    )
    parser.add_argument("--data", type=Path, default=Path("../../data/raw/derm"))
    parser.add_argument("--out", type=Path, help="pack ZIP to write")
    parser.add_argument(
        "--cache", type=Path, default=Path("../../data/build/derm/v2/cache")
    )
    parser.add_argument("--version", default=datetime.now(UTC).strftime("%Y.%m.%d"))
    parser.add_argument("--sheet", type=Path, help="write review contact sheets here")
    parser.add_argument(
        "--candidates", type=int, default=8, help="per class on the sheet"
    )
    parser.add_argument(
        "--exclude", default="", help="comma-separated photo ids to leave out"
    )
    args = parser.parse_args()

    classes = json.loads(t.CLASSES.read_text(encoding="utf-8"))["classes"]
    ids = [entry["id"] for entry in classes]
    private = scin_private_cases(args.data / "scin")
    commons = commons_credits(args.data / "commons")
    label_of = label_map(classes, ("scin", "pad"))
    records = [
        r
        for r in t.pad_records(args.data / "pad-ufes-20", label_of)
        # Only cases the dermatologists agreed on: the guide shows what a class looks like.
        + t.scin_records(args.data / "scin", label_of, 0.8)
        + commons_records(args.data / "commons", classes)
        if not (r.source == "scin" and r.group.removeprefix("scin:") in private)
    ]
    excluded = {item.strip() for item in args.exclude.split(",") if item.strip()}
    records = [r for r in records if photo_id(r.image) not in excluded]
    # Scored from the training cache (small copies; unreadable files drop out there), exported
    # from the original photo.
    originals = {id(r): r.image for r in records}
    records = t.build_cache(records, args.cache, 8)
    sessions = eval_onnx.load_sessions([args.run], ids)
    scores = eval_onnx.predict(sessions, records, len(ids), False, True)
    for record in records:
        record.image = originals[id(record)]

    chosen: dict[str, list] = {}
    for label, class_id in enumerate(ids):
        pool = sorted(
            (
                (float(scores[i, label]), r)
                for i, r in enumerate(records)
                if r.label == label and min(Image.open(r.image).size) >= 300
            ),
            key=lambda item: -item[0],
        )
        picked, groups = [], set()
        for score, record in pool:
            if record.group in groups:
                continue
            groups.add(record.group)
            picked.append((score, record))
            if len(picked) == args.candidates:
                break
        chosen[class_id] = picked
        if args.sheet:
            args.sheet.mkdir(parents=True, exist_ok=True)
            contact_sheet(
                args.sheet / f"{class_id}.png",
                f"{class_id}: {len(pool)} candidates",
                [(photo_id(r.image), r.image, s) for s, r in picked],
            )
        print(json.dumps({class_id: len(pool), "picked": len(picked)}), flush=True)
    if not args.out:
        return

    manifest = json.loads((args.run / "skin-model.json").read_text(encoding="utf-8"))
    photos = []
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("skin-model.json", json.dumps(manifest, indent=2))
        for model in manifest["models"]:
            bundle.write(args.run / model["file"], model["file"], zipfile.ZIP_STORED)
        for class_id, picked in chosen.items():
            for _, record in picked[:PER_CLASS]:
                data, width, height = encode_avif(record.image)
                file = f"photos/{photo_id(record.image)}.avif"
                bundle.writestr(file, data, zipfile.ZIP_STORED)
                photos.append(
                    {
                        "class": class_id,
                        "file": file,
                        "width": width,
                        "height": height,
                        **credit(record, commons),
                    }
                )
        bundle.writestr(
            "photos.json", json.dumps({"photos": photos}, ensure_ascii=False, indent=2)
        )
        bundle.writestr(
            "skin-pack.json",
            json.dumps(
                {
                    "format": FORMAT,
                    "formatVersion": FORMAT_VERSION,
                    "version": args.version,
                    "name": "Кожа по фото",
                    "model": "skin-model.json",
                    "photos": "photos.json",
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
    size = args.out.stat().st_size
    digest = hashlib.sha256(args.out.read_bytes()).hexdigest()
    print(
        json.dumps(
            {
                "pack": str(args.out),
                "bytes": size,
                "sha256": digest,
                "photos": len(photos),
            }
        )
    )


if __name__ == "__main__":
    main()
