#!/usr/bin/env python3
"""Evaluate exported ONNX skin models on the same test split: one model, several (averaged), with
or without a flipped view (test-time augmentation). Checks that the INT8 file the app ships keeps
the accuracy measured on the FP32 PyTorch model, and whether an ensemble is worth it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import train_skin_cnn as t
from PIL import Image
from torchvision import transforms


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
        "--file",
        default=None,
        help="model file inside each run (default: the manifest's)",
    )
    parser.add_argument(
        "--flip", action="store_true", help="also average a horizontally flipped view"
    )
    parser.add_argument(
        "--no-details", action="store_true", help="feed every model unknown details"
    )
    args = parser.parse_args()

    classes = json.loads(t.CLASSES.read_text(encoding="utf-8"))["classes"]
    class_ids = [entry["id"] for entry in classes]
    label_of = {
        f"{s}:{n}": i
        for i, e in enumerate(classes)
        for s in ("scin", "pad")
        for n in e.get(s, [])
    }
    malignant = [i for i, e in enumerate(classes) if e["malignant"]]
    records = t.pad_records(args.data / "pad-ufes-20", label_of) + t.scin_records(
        args.data / "scin", label_of, 0.5
    )
    t.build_cache(records, args.cache, 8)
    test = [r for r in records if t.split_of(r.group) == "test"]

    sessions = []
    for run in args.runs:
        manifest = json.loads((run / "skin-model.json").read_text(encoding="utf-8"))
        assert manifest["classes"] == class_ids, f"{run}: classes differ from the app's"
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        session = ort.InferenceSession(
            str(run / (args.file or manifest["model"])),
            options,
            providers=["CPUExecutionProvider"],
        )
        sessions.append(
            (session, {entry.name for entry in session.get_inputs()}, manifest)
        )

    side = sessions[0][2]["inputSide"]
    transform = transforms.Compose(
        [
            transforms.Resize(side + 16),
            transforms.CenterCrop(side),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    probabilities = np.zeros((len(test), len(class_ids)), dtype=np.float64)
    labels = np.array([r.label for r in test])
    for index, record in enumerate(test):
        image = transform(Image.open(record.image).convert("RGB")).numpy()[None]
        views = [image, image[..., ::-1].copy()] if args.flip else [image]
        details = t.encode(t.Details() if args.no_details else record.details)[None]
        total = np.zeros(len(class_ids))
        for session, inputs, _ in sessions:
            for view in views:
                feed = {"image": view.astype(np.float32)}
                if "details" in inputs:
                    feed["details"] = details
                logits = session.run(None, feed)[0][0]
                exp = np.exp(logits - logits.max())
                total += exp / exp.sum()
        probabilities[index] = total / (len(sessions) * len(views))

    threshold = float(
        np.mean([manifest["malignantThreshold"] for _, _, manifest in sessions])
    )
    groups = [r.group for r in test]
    report = {
        "runs": [str(run) for run in args.runs],
        "file": args.file or "manifest",
        "flip": args.flip,
        "details": not args.no_details,
        "test": t.metrics(probabilities, labels, class_ids, malignant, threshold),
        "test_by_case": t.metrics(
            *t.by_group(probabilities, labels, groups), class_ids, malignant, threshold
        ),
    }
    for key in ("test", "test_by_case"):
        summary = {
            k: (round(v, 4) if isinstance(v, float) else v)
            for k, v in report[key].items()
            if k != "per_class_recall"
        }
        print(json.dumps({key: summary}))


if __name__ == "__main__":
    main()
