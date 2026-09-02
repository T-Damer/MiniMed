#!/usr/bin/env bash
set -euo pipefail

repo="${MODEL_RELEASE_REPO:-T-Damer/MiniMed}"
tag="${MODEL_RELEASE_TAG:-models-preview-1}"
from_tag=""
files=()

while (($# > 0)); do
  case "$1" in
    --repo)
      repo="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
      shift 2
      ;;
    --from)
      from_tag="$2"
      shift 2
      ;;
    --)
      shift
      files+=("$@")
      break
      ;;
    -* )
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      files+=("$1")
      shift
      ;;
  esac
done

if ((${#files[@]} == 0)); then
  echo "Usage: bun run models:publish -- [--tag TAG] [--from PREVIOUS_TAG] FILE..." >&2
  exit 2
fi
for file in "${files[@]}"; do
  test -f "$file" || { echo "Model asset does not exist: $file" >&2; exit 2; }
done

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release upload "$tag" "${files[@]}" --repo "$repo" --clobber
  exit 0
fi

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
if [[ -n "$from_tag" ]]; then
  gh release download "$from_tag" --repo "$repo" --dir "$stage"
fi
for file in "${files[@]}"; do
  cp "$file" "$stage/$(basename "$file")"
done

gh release create "$tag" "$stage"/* \
  --repo "$repo" \
  --title 'MiniMed local model mirror' \
  --notes 'Checksum-verified optional local model artifacts used by MiniMed. Model weights are release assets and are not committed to Git or included in the APK.' \
  --prerelease \
  --target main
