"""The extra photo sources of the skin model besides SCIN and PAD-UFES-20 (train_skin_cnn.py): web
atlases, small single-disease sets, Derm1M and Wikimedia Commons, all under data/raw/derm. Each loader returns `Record`s whose
labels come from the app's class list (`skin-classes.json`: a class lists the source's own names
under the source's key), grouped so that pictures of one patient or series stay in one split. None
of these sources carries patient details, so their details are all unknown."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from pathlib import Path

from PIL import Image
from train_skin_cnn import Details, Record

# Sources photographed with phones, like the app's camera; the rest are atlas or dermoscopy-era
# clinical photos and get degraded towards phone quality in training.
PHONE_SOURCES = {"scin", "pad", "scabies", "bd"}


def label_map(classes: list[dict], sources: tuple[str, ...]) -> dict[str, int]:
    return {
        f"{source}:{name}": index
        for index, entry in enumerate(classes)
        for source in sources
        for name in entry.get(source, [])
    }


def atlas_records(root: Path, label_of: dict[str, int]) -> list[Record]:
    """Atlas Dermatológico: index.csv from index_atlas.py, images/atlas<id>.jpg."""
    index = root / "index.csv"
    if not index.exists():
        return []
    records = []
    with index.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            label = label_of.get(f"atlas:{row['disease']}")
            path = root / "images" / f"{row['image_id']}.jpg"
            if label is None or not path.exists():
                continue
            # Neighbouring ids of one disease are usually one patient's series.
            number = int(row["image_id"].removeprefix("atlas"))
            group = f"atlas:{row['disease_id']}:{number // 8}"
            records.append(Record(path, label, group, Details(), "atlas"))
    return records


def dermnet_stem(name: str) -> str:
    """`acne-cystic-116.jpg` → `acne-cystic`: DermNet names a picture after its diagnosis."""
    return re.sub(r"[-_ ]?\d+[a-z]?$", "", name.rsplit(".", 1)[0].lower()).strip("-_ ")


def dermnet_records(root: Path, label_of: dict[str, int]) -> list[Record]:
    """DermNet (Hugging Face parquet copy): unpacked once into images/, labelled by file name."""
    images = root / "images"
    if not images.exists():
        import pyarrow.parquet as pq

        for part in sorted((root / "data").glob("*.parquet")):
            table = pq.read_table(part, columns=["image"])
            for entry in table.column("image").to_pylist():
                target = images / part.stem.split("-")[0] / Path(entry["path"]).name
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(entry["bytes"])
    records = []
    for path in sorted(images.rglob("*.jp*g")):
        stem = dermnet_stem(path.name)
        label = label_of.get(f"dermnet:{stem}")
        if label is None:
            continue
        number = re.search(r"(\d+)[a-z]?\.\w+$", path.name)
        series = int(number.group(1)) // 6 if number else 0
        records.append(
            Record(path, label, f"dermnet:{stem}:{series}", Details(), "dermnet")
        )
    return records


def folder_records(root: Path, source: str, label_of: dict[str, int]) -> list[Record]:
    """A set laid out as <class folder>/<image>: the folder name is the source's label."""
    records = []
    for path in sorted(root.rglob("*")):
        if (
            path.suffix.lower() not in {".jpg", ".jpeg", ".png"}
            or "__MACOSX" in path.parts
        ):
            continue
        label = label_of.get(f"{source}:{path.parent.name}")
        if label is None:
            continue
        # Augmented copies share the original's name prefix: keep them in one split.
        base = re.sub(r"(_aug.*|\(\d+\)|_\d+)$", "", path.stem.lower())
        records.append(
            Record(
                path, label, f"{source}:{path.parent.name}:{base}", Details(), source
            )
        )
    return records


ISIC_BENIGN_SAMPLE = 1500


def isic_records(root: Path, label_of: dict[str, int]) -> list[Record]:
    """ISIC 2024 (SLICE-3D crops): the histology-typed lesions, plus a fixed sample of the untyped
    benign crops as naevi. Images are unpacked from input.zip on first use."""
    supplement = root / "supplement.csv"
    archive = root / "input.zip"
    if not supplement.exists() or not archive.exists():
        return []
    chosen: dict[str, tuple[int, str]] = {}
    benign = 0
    with supplement.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            label = label_of.get(f"isic:{row['iddx_3']}") if row["iddx_3"] else None
            # Every 200th untyped benign crop: spread over the archive's patients.
            if (
                label is None
                and row["iddx_full"] == "Benign"
                and benign < ISIC_BENIGN_SAMPLE
                and int(row["isic_id"].removeprefix("ISIC_")) % 200 == 0
            ):
                label = label_of.get("isic:Benign")
                benign += label is not None
            if label is not None:
                chosen[row["isic_id"]] = (label, row["lesion_id"] or row["isic_id"])
    images = root / "images"
    images.mkdir(exist_ok=True)
    missing = {key for key in chosen if not (images / f"{key}.jpg").exists()}
    if missing:
        with zipfile.ZipFile(archive) as bundle:
            for name in bundle.namelist():
                key = Path(name).stem
                if key in missing:
                    data = bundle.read(name)
                    Image.open(io.BytesIO(data)).convert("RGB").save(
                        images / f"{key}.jpg", quality=95
                    )
    return [
        Record(images / f"{key}.jpg", label, f"isic:{lesion}", Details(), "isic")
        for key, (label, lesion) in chosen.items()
        if (images / f"{key}.jpg").exists()
    ]


DERM1M_FOLDERS = ("IIYI", "edu", "note", "pubmed", "twitter", "reddit", "youtube")
# Not clinical photos of the skin surface: dermoscopy, histology and imaging.
DERM1M_NOT_PHOTO = re.compile(
    r"dermo?scop|dermatoscop|histopath|histolog|microscop|h&e|hematoxylin|immunohisto"
    r"|radiograph|x-ray|\bct\b|\bmri\b|ultrasound",
    re.IGNORECASE,
)
DERM1M_FRAMES_PER_VIDEO = 5


def derm1m_group(filename: str) -> str:
    """One patient or series per group: a video, a PubMed article, a forum thread, a book chapter."""
    folder, name = filename.split("/", 1)
    stem = name.rsplit(".", 1)[0]
    if folder == "youtube":
        return f"derm1m:youtube:{stem.split('_frame')[0]}"
    if folder == "pubmed":
        article = re.search(r"PMC\d+", stem)
        return f"derm1m:pubmed:{article.group(0) if article else stem}"
    if folder in ("edu", "note"):
        # `<book>_<page>_<index>`: neighbouring pages of one book usually show one case.
        book, page = (
            re.match(r"(.*)_(\d+)_\d+(?:_\d+)?$", stem) or re.match(r"(.*)()", stem)
        ).groups()
        return f"derm1m:book:{book}:{int(page or 0) // 4}"
    return f"derm1m:{folder}:{stem.split('_')[0]}"


def derm1m_rows(root: Path, label_of: dict[str, int]) -> list[tuple[str, int, str]]:
    """Derm1M (redlessone/Derm1M): rows whose disease label, or every part of a hierarchical one,
    names a single app class. The `public` folder is skipped (copies of ISIC, DermNet and SCIN that
    are already sources here), as are dermoscopy, histology and dermoscopy books; a video gives at
    most a few frames per class so one lecture cannot flood a class."""
    table = root / "Derm1M_v2_pretrain.csv"
    if not table.exists():
        return []
    rows = []
    frames: dict[tuple[str, int], list[str]] = {}
    with table.open(encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            filename = row["filename"]
            folder = filename.split("/", 1)[0]
            if folder not in DERM1M_FOLDERS or DERM1M_NOT_PHOTO.search(
                row["caption"] + " " + filename
            ):
                continue
            parts = {part.strip() for part in row["disease_label"].split(",")}
            labels = {label_of.get(f"derm1m:{part}") for part in parts} - {None}
            generic = parts - {
                part for part in parts if label_of.get(f"derm1m:{part}") is not None
            }
            if len(labels) != 1 or not generic <= {"dermatitis", "keratosis"}:
                continue
            label = labels.pop()
            group = derm1m_group(filename)
            if folder == "youtube":
                frames.setdefault((group, label), []).append(filename)
                continue
            rows.append((filename, label, group))
    for (group, label), names in frames.items():
        names.sort()
        step = max(1, len(names) // DERM1M_FRAMES_PER_VIDEO)
        rows += [
            (name, label, group) for name in names[::step][:DERM1M_FRAMES_PER_VIDEO]
        ]
    return rows


def derm1m_records(root: Path, label_of: dict[str, int]) -> list[Record]:
    images = root / "images"
    return [
        Record(images / filename, label, group, Details(), "derm1m")
        for filename, label, group in derm1m_rows(root, label_of)
        if (images / filename).exists()
    ]


def commons_records(root: Path, classes: list[dict]) -> list[Record]:
    """Wikimedia Commons photos (fetch_commons.py): index.csv names each photo's class."""
    index = root / "index.csv"
    if not index.exists():
        return []
    label_of = {entry["id"]: number for number, entry in enumerate(classes)}
    with index.open(encoding="utf-8") as handle:
        return [
            Record(
                root / row["file"],
                label_of[row["class"]],
                f"commons:{row['title']}",
                Details(),
                "commons",
            )
            for row in csv.DictReader(handle)
            if row["class"] in label_of and (root / row["file"]).exists()
        ]


def extra_records(data: Path, classes: list[dict]) -> list[Record]:
    label_of = label_map(
        classes, ("atlas", "dermnet", "msid", "scabies", "bd", "isic", "derm1m")
    )
    return (
        atlas_records(data / "atlas-dermatologico", label_of)
        + dermnet_records(data / "dermnet", label_of)
        + folder_records(data / "msid" / "extracted", "msid", label_of)
        + folder_records(data / "scabies-mendeley" / "extracted", "scabies", label_of)
        + [
            Record(r.image, r.label, f"train-only:{r.group}", r.details, r.source)
            for r in folder_records(
                data / "skindiseasebd" / "extracted", "bd", label_of
            )
        ]
        + isic_records(data / "isic2024", label_of)
        + derm1m_records(data / "derm1m", label_of)
        + commons_records(data / "commons", classes)
    )
