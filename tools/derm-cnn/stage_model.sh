#!/usr/bin/env bash
# Copies a trained run or ensemble (its manifest and every graph it lists) to where the app looks for
# the skin model. The weights are trained on data that stays local: the target folder is gitignored.
set -euo pipefail
run="${1:?usage: stage_model.sh <run or ensemble directory with skin-model.json>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
target="$root/apps/app/public/models/skin"
rm -rf "$target" && mkdir -p "$target"
cp "$run/skin-model.json" "$target/"
python3 -c 'import json,sys; [print(m["file"]) for m in json.load(open(sys.argv[1]))["models"]]' "$run/skin-model.json" |
  while read -r file; do cp "$run/$file" "$target/"; done
printf 'staged %s (%s MB) into %s\n' "$run" "$(du -sm "$target" | cut -f1)" "$target"
