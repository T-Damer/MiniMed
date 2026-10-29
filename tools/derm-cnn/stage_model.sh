#!/usr/bin/env bash
# Copies a trained run (its manifest and the weights it names) to where the app looks for the skin model.
# The weights are trained on data that stays local: the target folder is gitignored.
set -euo pipefail
run="${1:?usage: stage_model.sh <run directory, e.g. data/build/derm/both/efficientnet_b0-details>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
target="$root/apps/app/public/models/skin"
mkdir -p "$target"
model="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["model"])' "$run/skin-model.json")"
cp "$run/skin-model.json" "$run/$model" "$target/"
printf 'staged %s (%s, %s MB) into %s\n' "$run" "$model" "$(du -m "$run/$model" | cut -f1)" "$target"
