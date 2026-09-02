#!/usr/bin/env python3
"""Package Open ECG Digitizer as a MiniMed waveform-only bundle."""

from __future__ import annotations

import argparse
import importlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
from PIL import Image

SOURCE = "https://github.com/Ahus-AIM/Electrocardiogram-Digitization"
MODEL_PATH = "onnx/open_ecg_digitizer.onnx"
CONFIG_PATH = "open_ecg_digitizer.json"
MANIFEST_PATH = "minimed-ecg-model.json"
LICENSE_PATH = "licenses/open-ecg-digitizer-CC-BY-SA-4.0.txt"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Open ECG Digitizer source checkout")
    parser.add_argument("weights", type=Path, help="unet_weights_07072025.pt")
    parser.add_argument("output", type=Path, help="temporary digitizer ZIP destination")
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        required=True,
        help="directory with representative non-patient ECG PNG/JPEG images",
    )
    return parser.parse_args()


class ImageCalibrationReader(CalibrationDataReader):
    def __init__(self, directory: Path) -> None:
        paths = sorted(
            path for path in directory.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"}
        )[:10]
        if not paths:
            raise ValueError("Calibration directory has no ECG images")
        self._items = iter(paths)

    def get_next(self) -> dict[str, np.ndarray] | None:
        try:
            path = next(self._items)
        except StopIteration:
            return None
        image = np.asarray(Image.open(path).convert("RGB").resize((1024, 768)), dtype=np.float32)
        image = (image - image.min()) / max(1.0, float(image.max() - image.min()))
        return {"pixel_values": np.transpose(image, (2, 0, 1))[None, ...]}


def load_model(source: Path, weights: Path) -> torch.nn.Module:
    sys.path.insert(0, str(source))
    try:
        unet_module = importlib.import_module("src.model.unet")
        model = unet_module.UNet(
            num_in_channels=3,
            num_out_channels=4,
            dims=[32, 64, 128, 256, 320, 320, 320, 320],
            depth=2,
        )
    finally:
        sys.path.pop(0)
    raw_state = torch.load(weights, map_location="cpu", weights_only=True)
    state = {key.removeprefix("_orig_mod."): value for key, value in raw_state.items()}
    model.load_state_dict(state)
    return model.eval()


def write_bundle(source: Path, weights: Path, output: Path, calibration_dir: Path) -> None:
    model = load_model(source, weights)
    with tempfile.TemporaryDirectory(prefix="minimed-open-ecg-") as temp_dir:
        float_model_path = Path(temp_dir) / "open_ecg_digitizer_float.onnx"
        model_path = Path(temp_dir) / "open_ecg_digitizer.onnx"
        torch.onnx.export(
            model,
            torch.zeros(1, 3, 768, 1024),
            float_model_path,
            dynamo=False,
            input_names=["pixel_values"],
            output_names=["logits"],
            opset_version=17,
        )
        quantize_static(
            float_model_path,
            model_path,
            ImageCalibrationReader(calibration_dir),
            quant_format=QuantFormat.QDQ,
            activation_type=QuantType.QUInt8,
            weight_type=QuantType.QInt8,
            per_channel=True,
        )
        onnx.checker.check_model(onnx.load(model_path))
        session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        result = session.run(
            None,
            {"pixel_values": np.zeros((1, 3, 768, 1024), dtype=np.float32)},
        )[0]
        if result.shape != (1, 4, 768, 1024):
            raise RuntimeError(f"Unexpected digitizer output shape: {result.shape}")

        manifest = {
            "format": "minimed-ecg-waveform-digitizer",
            "formatVersion": 1,
            "name": "Open ECG Digitizer",
            "version": "2026.1",
            "source": SOURCE,
            "license": "CC BY-SA 4.0",
        }
        config = {
            "format": "open-ecg-digitizer-segmentation",
            "formatVersion": 1,
            "height": 768,
            "width": 1024,
            "gridClass": 0,
            "signalClass": 2,
            "layout": "3x4+1R",
            "source": SOURCE,
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(MANIFEST_PATH, json.dumps(manifest, indent=2) + "\n")
            archive.writestr(CONFIG_PATH, json.dumps(config, indent=2) + "\n")
            archive.writestr(LICENSE_PATH, (source / "LICENSE").read_bytes())
            archive.write(model_path, MODEL_PATH)
    print(json.dumps({"output": str(output), "bytes": output.stat().st_size}))


if __name__ == "__main__":
    args = parse_args()
    write_bundle(args.source, args.weights, args.output, args.calibration_dir)
