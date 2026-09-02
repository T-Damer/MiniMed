#!/usr/bin/env python3
"""Train a five-label direct-image ECG CNN and evaluate real phone photos."""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
import random
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import wfdb
from PIL import Image, ImageDraw, ImageOps
from sklearn.metrics import f1_score, roc_auc_score
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

LABELS = ("NORM", "MI", "STTC", "CD", "HYP")


@dataclass(frozen=True)
class Record:
    ecg_id: int
    path: str
    fold: int
    labels: tuple[int, ...]


def diagnostic_map(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    with path.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            diagnostic = str(row.get("diagnostic", "")).strip().lower()
            target = str(row.get("diagnostic_class", "")).strip()
            if diagnostic in {"1", "1.0", "true"} and target in LABELS:
                code = str(row.get("") or row.get("Unnamed: 0") or "").strip()
                if code:
                    result[code] = target
    return result


def load_records(root: Path, excluded_ecg_ids: set[int]) -> list[Record]:
    mapping = diagnostic_map(root / "scp_statements.csv")
    records: list[Record] = []
    with (root / "ptbxl_database.csv").open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
        excluded_patients = {
            row["patient_id"] for row in rows if int(row["ecg_id"]) in excluded_ecg_ids
        }
        for row in rows:
            if row["patient_id"] in excluded_patients:
                continue
            age = float(row["age"] or "nan")
            if not np.isfinite(age) or age < 18:
                continue
            codes = ast.literal_eval(row["scp_codes"])
            labels = tuple(
                int(any(mapping.get(code) == label for code in codes)) for label in LABELS
            )
            if not any(labels):
                continue
            records.append(
                Record(
                    ecg_id=int(row["ecg_id"]),
                    path=row["filename_lr"],
                    fold=int(row["strat_fold"]),
                    labels=labels,
                )
            )
    return records


def render_record(task: tuple[str, str, int]) -> str:
    source, destination, seed = task
    output = Path(destination)
    if output.exists():
        return destination
    signal, _meta = wfdb.rdsamp(source)
    width, height = 768, 768
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 8):
        color = (244, 214, 214) if x % 40 else (228, 170, 170)
        draw.line((x, 0, x, height), fill=color, width=1)
    for y in range(0, height, 8):
        color = (244, 214, 214) if y % 40 else (228, 170, 170)
        draw.line((0, y, width, y), fill=color, width=1)
    rng = random.Random(seed)
    row_height = height / 12
    for lead in range(min(12, signal.shape[1])):
        baseline = (lead + 0.5) * row_height
        values = np.nan_to_num(signal[:, lead], nan=0.0, posinf=0.0, neginf=0.0)
        points = [
            (
                round(index * (width - 1) / max(1, len(values) - 1)),
                round(baseline - float(value) * row_height * 0.28),
            )
            for index, value in enumerate(values)
        ]
        draw.line(points, fill=(22 + rng.randrange(8), 22, 22), width=2)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.jpg")
    image.save(temporary, "JPEG", quality=90, optimize=True)
    temporary.replace(output)
    return destination


def render_all(root: Path, cache: Path, records: list[Record], workers: int) -> None:
    tasks = [
        (str(root / record.path), str(cache / f"{record.ecg_id:05d}.jpg"), record.ecg_id)
        for record in records
    ]
    with ProcessPoolExecutor(max_workers=workers) as executor:
        for index, _ in enumerate(executor.map(render_record, tasks, chunksize=16), start=1):
            if index % 1000 == 0:
                print(json.dumps({"rendered": index, "total": len(tasks)}), flush=True)


class SquarePad:
    def __call__(self, image: Image.Image) -> Image.Image:
        size = max(image.size)
        result = Image.new("RGB", (size, size), "white")
        result.paste(image, ((size - image.width) // 2, (size - image.height) // 2))
        return result


class EcgDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    def __init__(self, records: list[Record], cache: Path, training: bool) -> None:
        self.records = records
        augment = (
            [
                transforms.RandomPerspective(distortion_scale=0.18, p=0.6),
                transforms.RandomRotation(4, fill=255),
                transforms.ColorJitter(brightness=0.25, contrast=0.25, saturation=0.15),
                transforms.RandomApply([transforms.GaussianBlur(3, (0.1, 1.2))], p=0.2),
            ]
            if training
            else []
        )
        self.transform = transforms.Compose(
            [
                SquarePad(),
                *augment,
                transforms.Resize((384, 384), antialias=True),
                transforms.ToTensor(),
                transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
            ]
        )
        self.cache = cache

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        record = self.records[index]
        with Image.open(self.cache / f"{record.ecg_id:05d}.jpg") as image:
            tensor = self.transform(image.convert("RGB"))
        return tensor, torch.tensor(record.labels, dtype=torch.float32)


@torch.inference_mode()
def predict(
    model: nn.Module, loader: DataLoader, device: torch.device
) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probabilities: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    for images, labels in loader:
        logits = model(images.to(device, non_blocking=True))
        probabilities.append(logits.sigmoid().cpu().numpy())
        targets.append(labels.numpy())
    return np.concatenate(probabilities), np.concatenate(targets)


def thresholds_for(probabilities: np.ndarray, targets: np.ndarray) -> list[float]:
    result: list[float] = []
    for column in range(len(LABELS)):
        candidates = np.linspace(0.1, 0.9, 33)
        result.append(
            float(
                max(
                    candidates,
                    key=lambda value: f1_score(
                        targets[:, column], probabilities[:, column] >= value, zero_division=0
                    ),
                )
            )
        )
    return result


def metrics(
    probabilities: np.ndarray, targets: np.ndarray, thresholds: list[float]
) -> dict[str, object]:
    aucs = {
        label: float(roc_auc_score(targets[:, index], probabilities[:, index]))
        for index, label in enumerate(LABELS)
        if len(np.unique(targets[:, index])) > 1
    }
    predictions = probabilities >= np.asarray(thresholds)
    f1 = {
        label: float(f1_score(targets[:, index], predictions[:, index], zero_division=0))
        for index, label in enumerate(LABELS)
    }
    return {
        "auc": aucs,
        "macro_auc": float(np.mean(list(aucs.values()))),
        "f1": f1,
        "macro_f1": float(np.mean(list(f1.values()))),
        "count": int(len(targets)),
    }


def phone_predictions(
    model: nn.Module,
    phone_dir: Path,
    device: torch.device,
    thresholds: list[float],
    truth: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    transform = EcgDataset([], Path(), False).transform
    results: list[dict[str, object]] = []
    model.eval()
    for path in sorted(phone_dir.iterdir()):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        with Image.open(path) as image:
            tensor = (
                transform(ImageOps.exif_transpose(image).convert("RGB")).unsqueeze(0).to(device)
            )
        with torch.inference_mode():
            values = model(tensor).sigmoid()[0].cpu().tolist()
        results.append(
            {
                "file": path.name,
                "truth": truth.get(path.name),
                "probabilities": dict(zip(LABELS, values, strict=True)),
                "positive": [
                    label
                    for label, value, threshold in zip(LABELS, values, thresholds, strict=True)
                    if value >= threshold
                ],
            }
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--phone-dir", type=Path, required=True)
    parser.add_argument("--phone-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()
    torch.manual_seed(20260902)
    np.random.seed(20260902)
    args.output.mkdir(parents=True, exist_ok=True)
    cache = args.output / "renders"
    holdout = json.loads(args.phone_manifest.read_text(encoding="utf-8"))
    truth = {str(item["file"]): item for item in holdout}
    excluded_ecg_ids = {int(item["ecg_id"]) for item in holdout}
    records = load_records(args.data_root, excluded_ecg_ids)
    if not records:
        raise RuntimeError("No labelled adult PTB-XL records were loaded")
    render_all(args.data_root, cache, records, args.workers)
    splits = {
        "train": [record for record in records if record.fold <= 8],
        "validation": [record for record in records if record.fold == 9],
        "test": [record for record in records if record.fold == 10],
    }
    device = torch.device("cuda")
    model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
    model.fc = nn.Linear(model.fc.in_features, len(LABELS))
    model.to(device)
    train_targets = np.asarray([record.labels for record in splits["train"]])
    positives = train_targets.sum(axis=0)
    pos_weight = torch.tensor(
        (len(train_targets) - positives) / np.maximum(1, positives), device=device
    )
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
    train_loader = DataLoader(
        EcgDataset(splits["train"], cache, True),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=True,
        persistent_workers=args.workers > 0,
    )
    for epoch in range(args.epochs):
        model.train()
        total_loss = 0.0
        for images, labels in train_loader:
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                loss = criterion(
                    model(images.to(device, non_blocking=True)),
                    labels.to(device, non_blocking=True),
                )
            loss.backward()
            optimizer.step()
            total_loss += float(loss.detach())
        print(json.dumps({"epoch": epoch + 1, "loss": total_loss / len(train_loader)}), flush=True)
    evaluation_loaders = {
        name: DataLoader(
            EcgDataset(values, cache, False),
            batch_size=args.batch_size,
            num_workers=args.workers,
            pin_memory=True,
        )
        for name, values in splits.items()
        if name != "train"
    }
    validation_probabilities, validation_targets = predict(
        model, evaluation_loaders["validation"], device
    )
    thresholds = thresholds_for(validation_probabilities, validation_targets)
    test_probabilities, test_targets = predict(model, evaluation_loaders["test"], device)
    report = {
        "architecture": "resnet18-direct-image",
        "labels": LABELS,
        "splits": {name: len(values) for name, values in splits.items()},
        "excluded_phone_holdout_ecg_ids": sorted(excluded_ecg_ids),
        "thresholds": dict(zip(LABELS, thresholds, strict=True)),
        "validation": metrics(validation_probabilities, validation_targets, thresholds),
        "test": metrics(test_probabilities, test_targets, thresholds),
    }
    checkpoint = args.output / "ecg-image-resnet18.pt"
    torch.save({"state_dict": model.state_dict(), "report": report}, checkpoint)
    (args.output / "metrics.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    phone = phone_predictions(model, args.phone_dir, device, thresholds, truth)
    (args.output / "phone_predictions.json").write_text(
        json.dumps(phone, indent=2) + "\n", encoding="utf-8"
    )
    model.eval()
    torch.onnx.export(
        model.cpu(),
        torch.zeros(1, 3, 384, 384),
        args.output / "ecg-image-resnet18.onnx",
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )
    artifacts = [
        checkpoint,
        args.output / "metrics.json",
        args.output / "phone_predictions.json",
        args.output / "ecg-image-resnet18.onnx",
    ]
    with (args.output / "SHA256SUMS").open("w", encoding="utf-8") as handle:
        for path in artifacts:
            handle.write(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")
    print(json.dumps({"completed": True, "output": str(args.output), "phone": phone}), flush=True)


if __name__ == "__main__":
    main()
