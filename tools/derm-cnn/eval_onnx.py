#!/usr/bin/env python3
"""Evaluate exported ONNX skin models on the held-out split: one model or several (averaged), with
or without a flipped view (test-time augmentation). With `--write DIR` the averaged models become
one ensemble the app can load: the graphs are copied there and the manifest's malignancy threshold
is set on the validation split for >= 95 % sensitivity, as training does for a single model."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
import train_skin_cnn as t
from PIL import Image
from torchvision import transforms


def load_sessions(runs: list[Path], class_ids: list[str]) -> list[tuple]:
    sessions = []
    for run in runs:
        manifest = json.loads((run / "skin-model.json").read_text(encoding="utf-8"))
        assert manifest["classes"] == class_ids, f"{run}: classes differ from the app's"
        for model in manifest["models"]:
            options = ort.SessionOptions()
            options.intra_op_num_threads = 4
            session = ort.InferenceSession(
                str(run / model["file"]), options, providers=["CPUExecutionProvider"]
            )
            inputs = {entry.name for entry in session.get_inputs()}
            sessions.append((run, model, session, inputs))
    return sessions


def predict(
    sessions: list[tuple], records: list, classes: int, flip: bool, blank: bool
) -> np.ndarray:
    transforms_by_side = {}
    probabilities = np.zeros((len(records), classes), dtype=np.float64)
    for index, record in enumerate(records):
        source = Image.open(record.image).convert("RGB")
        total = np.zeros(classes)
        count = 0
        for _, model, session, inputs in sessions:
            side = model["inputSide"]
            transform = transforms_by_side.setdefault(
                side,
                transforms.Compose(
                    [
                        transforms.Resize(side + 16),
                        transforms.CenterCrop(side),
                        transforms.ToTensor(),
                        transforms.Normalize(
                            [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
                        ),
                    ]
                ),
            )
            image = transform(source).numpy()[None]
            known = model["details"] and not blank
            details = t.encode(record.details if known else t.Details())[None]
            for view in [image, image[..., ::-1].copy()] if flip else [image]:
                feed = {"image": view.astype(np.float32)}
                if "details" in inputs:
                    feed["details"] = details
                logits = session.run(None, feed)[0][0]
                exp = np.exp(logits - logits.max())
                total += exp / exp.sum()
                count += 1
        probabilities[index] = total / count
    return probabilities


def summary(report: dict) -> dict:
    return {
        k: (round(v, 4) if isinstance(v, float) else v)
        for k, v in report.items()
        if k != "per_class_recall"
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "runs", nargs="+", type=Path, help="run directories with skin-model.json"
    )
    parser.add_argument("--data", type=Path, default=Path("data/raw/derm"))
    parser.add_argument(
        "--cache", type=Path, default=Path("data/build/derm/both/cache")
    )
    parser.add_argument(
        "--flip", action="store_true", help="also average a horizontally flipped view"
    )
    parser.add_argument(
        "--no-details", action="store_true", help="feed every model unknown details"
    )
    parser.add_argument(
        "--write", type=Path, help="write the averaged models as one app ensemble here"
    )
    args = parser.parse_args()

    classes = json.loads(t.CLASSES.read_text(encoding="utf-8"))["classes"]
    class_ids = [entry["id"] for entry in classes]
    malignant = [i for i, e in enumerate(classes) if e["malignant"]]
    records = t.all_records(args.data, classes)
    records = t.build_cache(records, args.cache, 8)
    sessions = load_sessions(args.runs, class_ids)

    threshold = float(
        np.mean(
            [
                json.loads((run / "skin-model.json").read_text(encoding="utf-8"))[
                    "malignantThreshold"
                ]
                for run in args.runs
            ]
        )
    )
    if args.write:
        val = [r for r in records if t.split_of(r.group) == "val"]
        val_p = predict(sessions, val, len(class_ids), args.flip, args.no_details)
        threshold = t.sensitivity_threshold(
            val_p, np.array([r.label for r in val]), malignant, 0.95
        )

    test = [r for r in records if t.split_of(r.group) == "test"]
    probabilities = predict(sessions, test, len(class_ids), args.flip, args.no_details)
    labels = np.array([r.label for r in test])
    groups = [r.group for r in test]
    report = {
        "runs": [str(run) for run in args.runs],
        "flip": args.flip,
        "details": not args.no_details,
        "test": t.metrics(probabilities, labels, class_ids, malignant, threshold),
        "test_by_case": t.metrics(
            *t.by_group(probabilities, labels, groups), class_ids, malignant, threshold
        ),
    }
    # The number that matters for the app: SCIN and PAD-UFES-20, real phone photos, per case.
    phone = np.array([r.source in ("scin", "pad") for r in test])
    if phone.any():
        report["test_phone_by_case"] = t.metrics(
            *t.by_group(
                probabilities[phone],
                labels[phone],
                [g for g, keep in zip(groups, phone) if keep],
            ),
            class_ids,
            malignant,
            threshold,
        )
    for key in ("test", "test_by_case", "test_phone_by_case"):
        if key not in report:
            continue
        print(json.dumps({key: summary(report[key])}), flush=True)

    if args.write:
        args.write.mkdir(parents=True, exist_ok=True)
        models = []
        for index, (run, model, _, _) in enumerate(sessions):
            file = f"model-{index + 1}.onnx"
            shutil.copyfile(run / model["file"], args.write / file)
            models.append(
                {
                    "file": file,
                    "inputSide": model["inputSide"],
                    "details": model["details"],
                }
            )
        manifest = {
            "format": "minimed-skin-cnn",
            "version": 2,
            "models": models,
            "classes": class_ids,
            "malignantThreshold": round(threshold, 4),
        }
        (args.write / "skin-model.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        (args.write / "metrics.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        print(
            json.dumps({"ensemble": str(args.write), "threshold": round(threshold, 4)}),
            flush=True,
        )


if __name__ == "__main__":
    main()
