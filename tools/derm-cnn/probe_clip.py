#!/usr/bin/env python3
"""Linear probe of a frozen CLIP image encoder (DermLIP, DermFM-Zero: open_clip folders with
open_clip_config.json) on the app's skin classes, scored next to a trained B0 run on the very same
test photos. The encoders were pretrained on Derm1M, which contains about 6,500 SCIN photos, so the
phone score is also given on a clean subset: PAD-UFES-20 and the SCIN photos that are not in Derm1M.
Uses the sources of the B0 run (Derm1M records are left out) so only the backbone differs."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import eval_onnx
import numpy as np
import torch
import train_skin_cnn as t
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score


def embed(model_dir: Path, records: list, batch: int, store: Path) -> np.ndarray:
    """Image embeddings in record order; photos embedded before (kept in `store`) are reused."""
    paths = [str(r.image) for r in records]
    known: dict[str, np.ndarray] = {}
    if store.exists():
        saved = np.load(store, allow_pickle=False)
        known = dict(zip(saved["paths"].tolist(), saved["embeddings"]))
    missing = [p for p in dict.fromkeys(paths) if p not in known]
    if missing:
        import open_clip

        model, _, preprocess = open_clip.create_model_and_transforms(
            f"local-dir:{model_dir}"
        )
        device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        model = model.eval().to(device)
        with torch.no_grad():
            for start in range(0, len(missing), batch):
                chunk = missing[start : start + batch]
                images = torch.stack(
                    [preprocess(Image.open(p).convert("RGB")) for p in chunk]
                )
                features = model.encode_image(images.to(device))
                normalized = torch.nn.functional.normalize(features, dim=-1)
                known.update(zip(chunk, normalized.float().cpu().numpy()))
                if start // batch % 50 == 0:
                    print(
                        json.dumps(
                            {"embedded": start + len(chunk), "of": len(missing)}
                        ),
                        flush=True,
                    )
        np.savez(
            store,
            paths=np.array(list(known)),
            embeddings=np.stack(list(known.values())),
        )
    return np.stack([known[p] for p in paths])


def clean_scin(table: Path) -> set[str]:
    """SCIN file names that Derm1M (its `public` folder) does not contain."""
    with table.open(encoding="utf-8-sig") as handle:
        return {
            row["filename"].split("/", 1)[1]
            for row in csv.DictReader(handle)
            if row["filename"].startswith("public/")
        }


def report(probabilities, test, class_ids, malignant, threshold, in_derm1m) -> dict:
    labels = np.array([r.label for r in test])
    groups = [r.group for r in test]

    def by_case(mask: np.ndarray) -> dict:
        return t.metrics(
            *t.by_group(
                probabilities[mask],
                labels[mask],
                [g for g, k in zip(groups, mask) if k],
            ),
            class_ids,
            malignant,
            threshold,
        )

    phone = np.array([r.source in ("scin", "pad") for r in test])
    clean = phone & np.array([r.source == "pad" or not in_derm1m(r) for r in test])
    return {
        "test_by_case": by_case(np.ones(len(test), dtype=bool)),
        "phone_by_case": by_case(phone),
        "phone_clean_by_case": by_case(clean),
        "phone_clean_images": int(clean.sum()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_dir", type=Path)
    parser.add_argument(
        "--b0", type=Path, default=Path("../../data/build/derm/v2/b0-details")
    )
    parser.add_argument("--data", type=Path, default=Path("../../data/raw/derm"))
    parser.add_argument(
        "--cache", type=Path, default=Path("../../data/build/derm/v2/cache")
    )
    parser.add_argument("--out", type=Path, default=Path("../../data/build/derm/probe"))
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument(
        "--details", action="store_true", help="append the patient details"
    )
    parser.add_argument(
        "--derm1m", action="store_true", help="also use the Derm1M training photos"
    )
    parser.add_argument(
        "--write-teacher",
        type=Path,
        help="write the probe's probabilities for every photo (.npz) for distillation",
    )
    args = parser.parse_args()

    classes = json.loads(t.CLASSES.read_text(encoding="utf-8"))["classes"]
    class_ids = [e["id"] for e in classes]
    malignant = [i for i, e in enumerate(classes) if e["malignant"]]
    records = [
        r
        for r in t.all_records(args.data, classes)
        if args.derm1m or r.source != "derm1m"
    ]
    originals = {id(r): r.image.name for r in records}
    records = t.build_cache(records, args.cache, 8)
    seen = clean_scin(args.data / "derm1m" / "Derm1M_v2_pretrain.csv")

    def in_derm1m(record) -> bool:
        return originals[id(record)] in seen

    args.out.mkdir(parents=True, exist_ok=True)
    name = args.model_dir.name
    embeddings = embed(args.model_dir, records, args.batch, args.out / f"{name}.npz")
    if args.details:
        embeddings = np.hstack(
            [embeddings, np.stack([t.encode(r.details) for r in records])]
        )
    split = np.array([t.split_of(r.group) for r in records])
    labels = np.array([r.label for r in records])
    train, val = split == "train", split == "val"

    best = None
    for c in (0.5, 1.0, 2.0, 4.0, 8.0):
        head = LogisticRegression(C=c, max_iter=3000, class_weight="balanced")
        head.fit(embeddings[train], labels[train])
        score = balanced_accuracy_score(labels[val], head.predict(embeddings[val]))
        print(
            json.dumps({"C": c, "val_balanced_accuracy": round(score, 4)}), flush=True
        )
        if best is None or score > best[0]:
            best = (score, head)
    assert best is not None
    head = best[1]
    threshold = t.sensitivity_threshold(
        head.predict_proba(embeddings[val]), labels[val], malignant, 0.95
    )
    if args.write_teacher:
        # Keyed by the cached photo, as the training dataset sees it.
        np.savez(
            args.write_teacher,
            paths=np.array([str(r.image) for r in records]),
            probabilities=head.predict_proba(embeddings).astype(np.float32),
        )
        print(json.dumps({"teacher": str(args.write_teacher)}), flush=True)
    test = [r for r, s in zip(records, split) if s == "test"]
    probe = report(
        head.predict_proba(embeddings[split == "test"]),
        test,
        class_ids,
        malignant,
        threshold,
        in_derm1m,
    )
    sessions = eval_onnx.load_sessions([args.b0], class_ids)
    b0_threshold = json.loads((args.b0 / "skin-model.json").read_text())[
        "malignantThreshold"
    ]
    b0 = report(
        eval_onnx.predict(sessions, test, len(class_ids), False, not args.details),
        test,
        class_ids,
        malignant,
        b0_threshold,
        in_derm1m,
    )
    result = {"model": name, "details": args.details, "probe": probe, "b0": b0}
    suffix = "-details" if args.details else ""
    (args.out / f"{name}{suffix}.json").write_text(json.dumps(result, indent=2))
    for who in ("probe", "b0"):
        for key in ("test_by_case", "phone_by_case", "phone_clean_by_case"):
            print(
                json.dumps({who: key, **eval_onnx.summary(result[who][key])}),
                flush=True,
            )


if __name__ == "__main__":
    main()
