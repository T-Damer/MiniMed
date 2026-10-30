#!/usr/bin/env python3
"""Prototype skin-photo classifier: EfficientNet-B0, optionally fused with patient details.

Trains on PAD-UFES-20 (CC BY 4.0) and SCIN (SCIN Data Use License) outside the app (owner
2026-10-29), splits by patient / case so no person is in two splits, and reports top-1 / top-3,
balanced accuracy, per-class recall and the malignant-lesion sensitivity at a threshold chosen on
validation. Data, cache and weights stay local (data/raw/derm, data/build/derm).
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import io
import json
import random
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFilter, ImageOps
from sklearn.metrics import balanced_accuracy_score, f1_score, roc_auc_score
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

HERE = Path(__file__).resolve().parent
# The class list is the app's declared data: the model's output order is its order.
CLASSES = HERE.parents[1] / "apps/app/src/features/skin/skin-classes.json"
CACHE_SIDE = 288
INPUT_SIDE = 224

# ---- patient details: one vector for both datasets, every field may be unknown ----
AGE_BUCKETS = ("lt18", "18_29", "30_39", "40_49", "50_59", "60_69", "70plus")
SITES = ("head_neck", "arm", "hand", "torso", "genital", "buttocks", "leg", "foot")
SYMPTOMS = ("itch", "bleed", "grew", "pain", "changed", "raised")
DURATIONS = ("lt_week", "1_4_weeks", "1_12_months", "gt_year")
META_SIZE = (
    (len(AGE_BUCKETS) + 1)
    + 3
    + (len(SITES) + 1)
    + 2 * len(SYMPTOMS)
    + (len(DURATIONS) + 1)
    + 7
)


@dataclass
class Details:
    age: str | None = None
    sex: str | None = None  # "male" | "female"
    sites: tuple[str, ...] = ()
    symptoms: dict[str, bool] | None = None
    duration: str | None = None
    fitzpatrick: int | None = None


def encode(details: Details) -> np.ndarray:
    parts: list[np.ndarray] = []

    def one_hot(values: tuple[str, ...], value: str | None) -> np.ndarray:
        vector = np.zeros(len(values) + 1, dtype=np.float32)
        vector[values.index(value) if value in values else len(values)] = 1
        return vector

    parts.append(one_hot(AGE_BUCKETS, details.age))
    parts.append(one_hot(("male", "female"), details.sex))
    sites = np.zeros(len(SITES) + 1, dtype=np.float32)
    for site in details.sites:
        sites[SITES.index(site)] = 1
    if not details.sites:
        sites[-1] = 1
    parts.append(sites)
    symptoms = np.zeros(2 * len(SYMPTOMS), dtype=np.float32)
    for index, name in enumerate(SYMPTOMS):
        value = (details.symptoms or {}).get(name)
        if value is not None:
            symptoms[2 * index] = 1  # known
            symptoms[2 * index + 1] = float(value)
    parts.append(symptoms)
    parts.append(one_hot(DURATIONS, details.duration))
    fitz = np.zeros(7, dtype=np.float32)
    fitz[details.fitzpatrick - 1 if details.fitzpatrick in range(1, 7) else 6] = 1
    parts.append(fitz)
    vector = np.concatenate(parts)
    assert vector.shape == (META_SIZE,)
    return vector


def drop_details(details: Details, rng: random.Random) -> Details:
    """Training sees partial or no details, so the model works with whatever the doctor enters."""
    if rng.random() < 0.3:
        return Details()
    keep = lambda: rng.random() > 0.25
    return Details(
        age=details.age if keep() else None,
        sex=details.sex if keep() else None,
        sites=details.sites if keep() else (),
        symptoms={k: v for k, v in (details.symptoms or {}).items() if keep()},
        duration=details.duration if keep() else None,
        fitzpatrick=details.fitzpatrick if keep() else None,
    )


def age_bucket(age: float | None) -> str | None:
    if age is None:
        return None
    for limit, name in (
        (18, "lt18"),
        (30, "18_29"),
        (40, "30_39"),
        (50, "40_49"),
        (60, "50_59"),
        (70, "60_69"),
    ):
        if age < limit:
            return name
    return "70plus"


@dataclass
class Record:
    image: Path
    label: int
    group: str
    details: Details
    source: str


def split_of(group: str) -> str:
    # Sets of augmented copies without the originals' names cannot be split safely: train only.
    if group.startswith("train-only:"):
        return "train"
    bucket = int(hashlib.sha1(group.encode()).hexdigest(), 16) % 100
    return "train" if bucket < 70 else "val" if bucket < 85 else "test"


def flag(value: str) -> bool | None:
    return {"TRUE": True, "FALSE": False, "YES": True, "NO": False}.get(
        value.strip().upper()
    )


PAD_SITES = {
    "FACE": "head_neck",
    "NOSE": "head_neck",
    "EAR": "head_neck",
    "LIP": "head_neck",
    "NECK": "head_neck",
    "SCALP": "head_neck",
    "FOREARM": "arm",
    "ARM": "arm",
    "HAND": "hand",
    "CHEST": "torso",
    "BACK": "torso",
    "ABDOMEN": "torso",
    "THIGH": "leg",
    "FOOT": "foot",
}


def pad_records(root: Path, label_of: dict[str, int]) -> list[Record]:
    images = {path.name: path for path in (root / "images").rglob("*.png")}
    records: list[Record] = []
    with (root / "metadata.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            label = label_of.get(f"pad:{row['diagnostic']}")
            path = images.get(row["img_id"])
            if label is None or path is None:
                continue
            fitz = row["fitspatrick"].strip()
            details = Details(
                age=age_bucket(float(row["age"])) if row["age"].strip() else None,
                sex={"MALE": "male", "FEMALE": "female"}.get(
                    row["gender"].strip().upper()
                ),
                sites=(PAD_SITES[row["region"]],) if row["region"] in PAD_SITES else (),
                symptoms={
                    name: value
                    for name, key in (
                        ("itch", "itch"),
                        ("bleed", "bleed"),
                        ("grew", "grew"),
                        ("pain", "hurt"),
                        ("changed", "changed"),
                        ("raised", "elevation"),
                    )
                    if (value := flag(row[key])) is not None
                },
                fitzpatrick=int(float(fitz)) if fitz else None,
            )
            records.append(
                Record(path, label, f"pad:{row['patient_id']}", details, "pad")
            )
    return records


SCIN_AGES = {
    "AGE_0_TO_17": "lt18",
    "AGE_18_TO_29": "18_29",
    "AGE_30_TO_39": "30_39",
    "AGE_40_TO_49": "40_49",
    "AGE_50_TO_59": "50_59",
    "AGE_60_TO_69": "60_69",
    "AGE_70_TO_79": "70plus",
    "AGE_80_OR_ABOVE": "70plus",
}
SCIN_SITES = {
    "body_parts_head_or_neck": "head_neck",
    "body_parts_arm": "arm",
    "body_parts_palm": "hand",
    "body_parts_back_of_hand": "hand",
    "body_parts_torso_front": "torso",
    "body_parts_torso_back": "torso",
    "body_parts_genitalia_or_groin": "genital",
    "body_parts_buttocks": "buttocks",
    "body_parts_leg": "leg",
    "body_parts_foot_top_or_side": "foot",
    "body_parts_foot_sole": "foot",
}
SCIN_DURATIONS = {
    "ONE_DAY": "lt_week",
    "LESS_THAN_ONE_WEEK": "lt_week",
    "ONE_TO_FOUR_WEEKS": "1_4_weeks",
    "ONE_TO_THREE_MONTHS": "1_12_months",
    "THREE_TO_TWELVE_MONTHS": "1_12_months",
    "MORE_THAN_ONE_YEAR": "gt_year",
    "MORE_THAN_FIVE_YEARS": "gt_year",
}


def scin_records(
    root: Path, label_of: dict[str, int], min_weight: float
) -> list[Record]:
    labels: dict[str, int] = {}
    with (root / "scin_labels.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            weighted = ast.literal_eval(
                row["weighted_skin_condition_label"].strip() or "{}"
            )
            if not weighted:
                continue
            name, weight = max(weighted.items(), key=lambda item: item[1])
            label = label_of.get(f"scin:{name}")
            if label is not None and weight >= min_weight:
                labels[row["case_id"]] = label
    records: list[Record] = []
    with (root / "scin_cases.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            label = labels.get(row["case_id"])
            if label is None:
                continue
            fitz = row["fitzpatrick_skin_type"].strip().upper()
            details = Details(
                age=SCIN_AGES.get(row["age_group"]),
                sex={"MALE": "male", "FEMALE": "female"}.get(
                    row["sex_at_birth"].strip().upper()
                ),
                sites=tuple(
                    sorted({site for key, site in SCIN_SITES.items() if flag(row[key])})
                ),
                symptoms={
                    name: True
                    for name, key in (
                        ("itch", "condition_symptoms_itching"),
                        ("bleed", "condition_symptoms_bleeding"),
                        ("grew", "condition_symptoms_increasing_size"),
                        ("pain", "condition_symptoms_pain"),
                        ("changed", "condition_symptoms_darkening"),
                        ("raised", "textures_raised_or_bumpy"),
                    )
                    if flag(row[key])
                },
                duration=SCIN_DURATIONS.get(row["condition_duration"]),
                fitzpatrick=int(fitz[-1])
                if fitz.startswith("FST") and fitz[-1].isdigit()
                else None,
            )
            for column in ("image_1_path", "image_2_path", "image_3_path"):
                relative = row[column].strip()
                if relative:
                    path = root / relative.removeprefix("dataset/")
                    if path.exists():
                        records.append(
                            Record(
                                path, label, f"scin:{row['case_id']}", details, "scin"
                            )
                        )
    return records


def all_records(
    data: Path, classes: list[dict], scin_min_weight: float = 0.5
) -> list[Record]:
    """Every labelled photo: SCIN and PAD-UFES-20 (phones, with details) and the extra sources."""
    from derm_sources import extra_records, label_map

    label_of = label_map(classes, ("scin", "pad"))
    return (
        pad_records(data / "pad-ufes-20", label_of)
        + scin_records(data / "scin", label_of, scin_min_weight)
        + extra_records(data, classes)
    )


class PhoneDegrade:
    """Pushes an atlas photo towards what a phone in a clinic gives: lower resolution, JPEG,
    slight blur, noise and a white-balance cast. Applied with probability `p`."""

    def __init__(self, p: float, rng: random.Random) -> None:
        self.p = p
        self.rng = rng

    def __call__(self, image: Image.Image) -> Image.Image:
        rng = self.rng
        if rng.random() >= self.p:
            return image
        if rng.random() < 0.7:
            side = rng.randint(96, 200)
            small = image.resize(
                (side, round(side * image.height / image.width)), Image.BILINEAR
            )
            image = small.resize(image.size, Image.BILINEAR)
        if rng.random() < 0.5:
            image = image.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
        if rng.random() < 0.6:
            gains = [rng.uniform(0.9, 1.1) for _ in range(3)]
            array = np.asarray(image, dtype=np.float32) * np.array(
                gains, dtype=np.float32
            )
            if rng.random() < 0.5:
                array += np.random.default_rng(rng.randint(0, 1 << 30)).normal(
                    0, rng.uniform(2, 7), array.shape
                )
            image = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))
        if rng.random() < 0.7:
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=rng.randint(35, 85))
            buffer.seek(0)
            image = Image.open(buffer).convert("RGB")
        return image


def cache_one(job: tuple[str, str]) -> str:
    source, target = job
    target_path = Path(target)
    if not target_path.exists():
        try:
            image = ImageOps.exif_transpose(Image.open(source)).convert("RGB")
        except OSError:
            # Truncated or not an image (web sources): the record is dropped by build_cache.
            return ""
        image.thumbnail((CACHE_SIDE * 2, CACHE_SIDE * 2))
        scale = CACHE_SIDE / min(image.size)
        image = image.resize(
            (
                max(CACHE_SIDE, round(image.width * scale)),
                max(CACHE_SIDE, round(image.height * scale)),
            )
        )
        target_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(target_path, quality=92)
    return target


def build_cache(records: list[Record], cache: Path, workers: int) -> list[Record]:
    """Resizes every photo once into the cache; returns the records that could be read."""
    jobs = []
    for record in records:
        key = hashlib.sha1(str(record.image).encode()).hexdigest()
        target = cache / key[:2] / f"{key}.jpg"
        jobs.append((str(record.image), str(target)))
        record.image = target
    with ProcessPoolExecutor(workers) as pool:
        done = list(pool.map(cache_one, jobs, chunksize=32))
    kept = [record for record, result in zip(records, done) if result]
    if len(kept) < len(records):
        print(json.dumps({"unreadable_images": len(records) - len(kept)}), flush=True)
    return kept


class SkinDataset(Dataset):
    def __init__(
        self,
        records: list[Record],
        train: bool,
        use_details: bool,
        seed: int,
        teacher: dict[str, np.ndarray] | None = None,
        classes: int = 0,
    ) -> None:
        self.records = records
        self.train = train
        self.use_details = use_details
        self.teacher = teacher or {}
        self.classes = classes
        self.rng = random.Random(seed)
        from derm_sources import PHONE_SOURCES

        self.phone_sources = PHONE_SOURCES
        self.degrade_atlas = PhoneDegrade(0.6, self.rng)
        self.degrade_phone = PhoneDegrade(0.15, self.rng)
        normalize = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        self.transform = (
            transforms.Compose(
                [
                    transforms.RandomResizedCrop(INPUT_SIDE, scale=(0.55, 1.0)),
                    transforms.RandomHorizontalFlip(),
                    transforms.RandomVerticalFlip(),
                    transforms.RandomRotation(20),
                    transforms.ColorJitter(0.25, 0.25, 0.15, 0.03),
                    transforms.ToTensor(),
                    normalize,
                ]
            )
            if train
            else transforms.Compose(
                [
                    transforms.Resize(INPUT_SIDE + 16),
                    transforms.CenterCrop(INPUT_SIDE),
                    transforms.ToTensor(),
                    normalize,
                ]
            )
        )

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(
        self, index: int
    ) -> tuple[torch.Tensor, torch.Tensor, int, torch.Tensor]:
        record = self.records[index]
        # The teacher's class probabilities for this photo; a photo it has none for falls back
        # to its own label.
        soft = self.teacher.get(str(record.image))
        if soft is None:
            soft = np.eye(max(self.classes, record.label + 1), dtype=np.float32)[
                record.label
            ]
        image = Image.open(record.image).convert("RGB")
        if self.train:
            phone = record.source in self.phone_sources
            image = (self.degrade_phone if phone else self.degrade_atlas)(image)
        image = self.transform(image)
        details = record.details if self.use_details else Details()
        if self.train and self.use_details:
            details = drop_details(details, self.rng)
        return (
            image,
            torch.from_numpy(encode(details)),
            record.label,
            torch.from_numpy(soft),
        )


class SkinNet(nn.Module):
    """EfficientNet-B0 image features, late-fused with a small network over the patient details."""

    def __init__(self, classes: int, use_details: bool, arch: str) -> None:
        super().__init__()
        if arch == "convnext_tiny":
            backbone = models.convnext_tiny(
                weights=models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1
            )
            self.features = backbone.features
            self.norm: nn.Module = nn.Sequential(nn.Flatten(1), nn.LayerNorm(768))
            width = 768
        else:
            backbone = models.efficientnet_b0(
                weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
            )
            self.features = backbone.features
            self.norm = nn.Flatten(1)
            width = 1280
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.use_details = use_details
        self.details = (
            nn.Sequential(
                nn.Linear(META_SIZE, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU()
            )
            if use_details
            else None
        )
        self.head = nn.Sequential(
            nn.Dropout(0.3), nn.Linear(width + (64 if use_details else 0), classes)
        )

    def forward(self, image: torch.Tensor, details: torch.Tensor) -> torch.Tensor:
        features = self.norm(self.pool(self.features(image)))
        if self.details is not None:
            features = torch.cat([features, self.details(details)], dim=1)
        return self.head(features)


def load_teacher(path: Path, classes: int) -> dict[str, np.ndarray]:
    """A teacher's class probabilities per cached photo (teach_dermlip.py writes them)."""
    saved = np.load(path, allow_pickle=False)
    probabilities = saved["probabilities"].astype(np.float32)
    assert probabilities.shape[1] == classes, "teacher classes differ from the app's"
    return dict(zip(saved["paths"].tolist(), probabilities))


def distill_loss(
    logits: torch.Tensor, teacher: torch.Tensor, temperature: float
) -> torch.Tensor:
    """Knowledge distillation: the student's softened distribution follows the teacher's."""
    soft = teacher.clamp_min(1e-8) ** (1 / temperature)
    soft = soft / soft.sum(1, keepdim=True)
    student = torch.log_softmax(logits / temperature, 1)
    return nn.functional.kl_div(student, soft, reduction="batchmean") * temperature**2


def predict(
    model: SkinNet, loader: DataLoader, device: torch.device
) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probabilities, labels = [], []
    with torch.no_grad():
        for image, details, label, _ in loader:
            logits = model(image.to(device), details.to(device))
            probabilities.append(torch.softmax(logits, 1).cpu().numpy())
            labels.append(label.numpy())
    return np.concatenate(probabilities), np.concatenate(labels)


def metrics(
    probabilities: np.ndarray,
    labels: np.ndarray,
    class_ids: list[str],
    malignant: list[int],
    threshold: float | None,
) -> dict[str, object]:
    top = np.argsort(-probabilities, 1)
    present = sorted(set(labels.tolist()))
    result: dict[str, object] = {
        "images": len(labels),
        "top1": float(np.mean(top[:, 0] == labels)),
        "top3": float(np.mean([label in row[:3] for label, row in zip(labels, top)])),
        "balanced_accuracy": float(balanced_accuracy_score(labels, top[:, 0])),
        "macro_f1": float(f1_score(labels, top[:, 0], labels=present, average="macro")),
        "per_class_recall": {
            class_ids[c]: {
                "recall": float(np.mean(top[labels == c, 0] == c)),
                "top3": float(np.mean([c in row[:3] for row in top[labels == c]])),
                "n": int(np.sum(labels == c)),
            }
            for c in present
        },
    }
    is_malignant = np.isin(labels, malignant)
    if is_malignant.any() and (~is_malignant).any():
        score = probabilities[:, malignant].sum(1)
        result["malignant_auc"] = float(roc_auc_score(is_malignant, score))
        if threshold is not None:
            flagged = score >= threshold
            result["malignant_threshold"] = threshold
            result["malignant_sensitivity"] = float(np.mean(flagged[is_malignant]))
            result["malignant_specificity"] = float(np.mean(~flagged[~is_malignant]))
            result["malignant_n"] = int(is_malignant.sum())
    return result


def by_group(
    probabilities: np.ndarray, labels: np.ndarray, groups: list[str]
) -> tuple[np.ndarray, np.ndarray]:
    """One answer per case: the photos of the same spot averaged (a doctor can take two or three)."""
    order: dict[str, list[int]] = {}
    for index, group in enumerate(groups):
        order.setdefault(group, []).append(index)
    indices = list(order.values())
    return np.stack([probabilities[i].mean(0) for i in indices]), np.array(
        [labels[i[0]] for i in indices]
    )


def sensitivity_threshold(
    probabilities: np.ndarray, labels: np.ndarray, malignant: list[int], target: float
) -> float:
    score = np.sort(probabilities[np.isin(labels, malignant)][:, malignant].sum(1))
    return float(score[int(np.floor((1 - target) * len(score)))]) if len(score) else 0.5


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/raw/derm"))
    parser.add_argument("--output", type=Path, default=Path("data/build/derm"))
    parser.add_argument(
        "--details", action="store_true", help="fuse the patient details"
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument(
        "--arch",
        choices=("efficientnet_b0", "convnext_tiny"),
        default="efficientnet_b0",
    )
    parser.add_argument("--batch-size", type=int, default=48)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--scin-min-weight", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--name", default="", help="run folder name (default: arch-details)"
    )
    parser.add_argument(
        "--phone-weight",
        type=float,
        default=2.0,
        help="sampling weight of phone photos vs atlas photos",
    )
    parser.add_argument(
        "--teacher", type=Path, help="teacher probabilities (.npz) to distil from"
    )
    parser.add_argument("--teacher-weight", type=float, default=0.5)
    parser.add_argument("--temperature", type=float, default=2.0)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    classes = json.loads(CLASSES.read_text(encoding="utf-8"))["classes"]
    class_ids = [entry["id"] for entry in classes]
    malignant = [index for index, entry in enumerate(classes) if entry["malignant"]]

    records = all_records(args.data, classes, args.scin_min_weight)
    run = args.output / (
        args.name or f"{args.arch}-{'details' if args.details else 'photo'}"
    )
    run.mkdir(parents=True, exist_ok=True)
    records = build_cache(records, args.output / "cache", args.workers)
    splits = {
        name: [r for r in records if split_of(r.group) == name]
        for name in ("train", "val", "test")
    }
    print(json.dumps({name: len(items) for name, items in splits.items()}), flush=True)
    print(
        json.dumps(
            {
                "train_by_class": {
                    class_ids[i]: int(n)
                    for i, n in enumerate(
                        np.bincount(
                            [r.label for r in splits["train"]], minlength=len(classes)
                        )
                    )
                },
                "train_by_source": {
                    s: sum(r.source == s for r in splits["train"])
                    for s in sorted({r.source for r in records})
                },
            }
        ),
        flush=True,
    )

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    counts = np.bincount(
        [r.label for r in splits["train"]], minlength=len(classes)
    ).astype(np.float64)
    # Balanced sampling instead of a weighted loss: rarer classes are drawn more often (square
    # root of the imbalance) and phone photos more than atlas photos.
    from derm_sources import PHONE_SOURCES

    class_weight = (counts.max() / np.maximum(counts, 1)) ** 0.5
    sample_weights = [
        class_weight[r.label]
        * (args.phone_weight if r.source in PHONE_SOURCES else 1.0)
        for r in splits["train"]
    ]
    sampler = torch.utils.data.WeightedRandomSampler(
        sample_weights, num_samples=len(splits["train"]), replacement=True
    )
    model = SkinNet(len(classes), args.details, args.arch).to(device)
    teacher = load_teacher(args.teacher, len(classes)) if args.teacher else None
    if teacher is not None:
        covered = sum(str(r.image) in teacher for r in splits["train"])
        print(
            json.dumps({"teacher_covers": covered, "of": len(splits["train"])}),
            flush=True,
        )
    loaders = {
        name: DataLoader(
            SkinDataset(
                items, name == "train", args.details, args.seed, teacher, len(classes)
            ),
            batch_size=args.batch_size,
            sampler=sampler if name == "train" else None,
            num_workers=args.workers,
            persistent_workers=True,
        )
        for name, items in splits.items()
    }
    optimizer = torch.optim.AdamW(model.parameters(), lr=4e-4, weight_decay=1e-4)
    schedule = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=4e-4, total_steps=args.epochs * len(loaders["train"])
    )
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)

    best, best_state = -1.0, None
    for epoch in range(args.epochs):
        model.train()
        started, total = time.time(), 0.0
        for image, details, label, soft in loaders["train"]:
            optimizer.zero_grad()
            logits = model(image.to(device), details.to(device))
            loss = loss_fn(logits, label.to(device))
            if teacher is not None:
                loss = (
                    1 - args.teacher_weight
                ) * loss + args.teacher_weight * distill_loss(
                    logits, soft.to(device), args.temperature
                )
            loss.backward()
            optimizer.step()
            schedule.step()
            total += float(loss)
        probabilities, labels = predict(model, loaders["val"], device)
        score = balanced_accuracy_score(labels, probabilities.argmax(1))
        print(
            json.dumps(
                {
                    "epoch": epoch + 1,
                    "loss": round(total / len(loaders["train"]), 4),
                    "val_balanced_accuracy": round(float(score), 4),
                    "seconds": round(time.time() - started),
                }
            ),
            flush=True,
        )
        if score > best:
            best, best_state = (
                score,
                {k: v.detach().cpu().clone() for k, v in model.state_dict().items()},
            )

    assert best_state is not None
    model.load_state_dict(best_state)
    val_p, val_y = predict(model, loaders["val"], device)
    # The malignancy threshold is set on the phone photos (SCIN, PAD-UFES-20) the app sees: with
    # Derm1M in the split, a threshold set on every source flagged far more benign phone photos.
    phone_val = np.array([r.source in ("scin", "pad") for r in splits["val"]])
    threshold = sensitivity_threshold(
        val_p[phone_val] if phone_val.any() else val_p,
        val_y[phone_val] if phone_val.any() else val_y,
        malignant,
        0.95,
    )
    test_p, test_y = predict(model, loaders["test"], device)
    test_groups = [r.group for r in splits["test"]]
    report: dict[str, object] = {
        "details": args.details,
        "arch": args.arch,
        "splits": {k: len(v) for k, v in splits.items()},
        "test": metrics(test_p, test_y, class_ids, malignant, threshold),
        "test_by_case": metrics(
            *by_group(test_p, test_y, test_groups), class_ids, malignant, threshold
        ),
    }
    # The number that matters for the app: SCIN and PAD-UFES-20, real phone photos, per case.
    phone = np.array([r.source in ("scin", "pad") for r in splits["test"]])
    if phone.any():
        report["test_phone_by_case"] = metrics(
            *by_group(
                test_p[phone],
                test_y[phone],
                [g for g, keep in zip(test_groups, phone) if keep],
            ),
            class_ids,
            malignant,
            threshold,
        )
    if args.details:
        blank = DataLoader(
            SkinDataset(splits["test"], False, False, args.seed, None, len(classes)),
            batch_size=args.batch_size,
            num_workers=args.workers,
        )
        blank_p, blank_y = predict(model, blank, device)
        report["test_without_details"] = metrics(
            blank_p, blank_y, class_ids, malignant, threshold
        )
        report["test_by_case_without_details"] = metrics(
            *by_group(blank_p, blank_y, test_groups), class_ids, malignant, threshold
        )
    torch.save(best_state, run / "model.pt")
    (run / "metrics.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    export_onnx(model.cpu(), run, args.details, threshold, class_ids)
    for key in (
        "test",
        "test_by_case",
        "test_without_details",
        "test_by_case_without_details",
    ):
        if key in report:
            summary = {k: v for k, v in report[key].items() if k != "per_class_recall"}  # type: ignore[union-attr]
            print(json.dumps({key: summary}), flush=True)


def export_onnx(
    model: SkinNet,
    run: Path,
    details_input: bool,
    threshold: float,
    class_ids: list[str],
) -> None:
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic

    model.eval()
    image = torch.randn(1, 3, INPUT_SIDE, INPUT_SIDE)
    details = torch.from_numpy(encode(Details())).unsqueeze(0)
    path = run / "model.onnx"
    torch.onnx.export(
        model,
        (image, details),
        path,
        input_names=["image", "details"],
        output_names=["logits"],
        opset_version=17,
        dynamo=False,
    )
    quantized = run / "model.int8.onnx"
    quantize_dynamic(str(path), str(quantized), weight_type=QuantType.QInt8)
    sizes = {
        name: round((run / name).stat().st_size / 1e6, 2)
        for name in ("model.onnx", "model.int8.onnx")
    }
    timing = {}
    for name in ("model.onnx", "model.int8.onnx"):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        session = ort.InferenceSession(
            str(run / name), options, providers=["CPUExecutionProvider"]
        )
        available = {"image": image.numpy(), "details": details.numpy()}
        feed = {entry.name: available[entry.name] for entry in session.get_inputs()}
        session.run(None, feed)
        started = time.time()
        for _ in range(20):
            session.run(None, feed)
        timing[name] = round((time.time() - started) / 20 * 1000, 1)
    (run / "export.json").write_text(
        json.dumps({"megabytes": sizes, "cpu_1_thread_ms": timing}, indent=2),
        encoding="utf-8",
    )
    # The app reads this beside the weights (apps/app/src/features/skin/skin-model-client.ts).
    # FP32: dynamic INT8 quantisation wrecked EfficientNet (test top-1 50 % -> 7 %, eval_onnx.py).
    manifest = {
        "format": "minimed-skin-cnn",
        "version": 2,
        "models": [
            {"file": "model.onnx", "inputSide": INPUT_SIDE, "details": details_input}
        ],
        "classes": class_ids,
        "malignantThreshold": round(threshold, 4),
    }
    (run / "skin-model.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(json.dumps({"export": sizes, "cpu_1_thread_ms": timing}), flush=True)


if __name__ == "__main__":
    main()
