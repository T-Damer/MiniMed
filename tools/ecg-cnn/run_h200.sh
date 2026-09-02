#!/usr/bin/env bash
set -euo pipefail

work=/workspace/minimed
data="$work/data"
output="$work/output"

trap 'printf "%s\n" "$?" > "$work/run.exit"' EXIT
python -m pip install --quiet --no-cache-dir awscli wfdb scikit-learn onnx
mkdir -p "$data" "$output"
bucket=s3://physionet-open/ptb-xl/1.0.3
aws s3 cp --no-sign-request --only-show-errors "$bucket/ptbxl_database.csv" "$data/"
aws s3 cp --no-sign-request --only-show-errors "$bucket/scp_statements.csv" "$data/"
aws s3 cp --no-sign-request --only-show-errors "$bucket/SHA256SUMS.txt" "$data/"
aws s3 sync --no-sign-request --only-show-errors "$bucket/records100/" "$data/records100/"

(cd "$data" && sha256sum --ignore-missing -c SHA256SUMS.txt > "$work/checksums.log")
printf '{"stage":"dataset_ready","hea_files":%s}\n' \
  "$(find "$data/records100" -type f -name '*.hea' | wc -l)"

timeout --foreground 2700 python "$work/train_image_cnn.py" \
  --data-root "$data" \
  --phone-dir "$work/phone" \
  --phone-manifest "$work/phone_holdout.json" \
  --output "$output" \
  --epochs 2 \
  --batch-size 128 \
  --workers 16

tar -czf "$work/minimed-ecg-image-cnn-h200.tar.gz" \
  -C "$output" \
  ecg-image-resnet18.pt ecg-image-resnet18.onnx metrics.json phone_predictions.json SHA256SUMS
