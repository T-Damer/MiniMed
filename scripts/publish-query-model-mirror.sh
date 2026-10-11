#!/usr/bin/env bash
# Publishes the on-device query encoder (STATE KD1) to its own `datasets/<tag>` mirror branch as
# plain git blobs, which raw.githubusercontent.com serves with browser CORS (the app pins every
# file's SHA-256 and size in apps/app/src/features/semantic/e5-model.ts). The ONNX graph is already
# split into parts below the 100 MB blob limit. An existing branch is never replaced.
#
#   scripts/publish-query-model-mirror.sh --tag kd1-query-encoder-2026.10.11 \
#     --source-dir data/build/kd1/query-encoder [--dry-run]
#
# Layout on the branch: models/kd1-query-encoder/<files of --source-dir>.
set -euo pipefail

TAG="" SOURCE_DIR="" DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --source-dir) SOURCE_DIR="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$TAG" =~ ^kd1-query-encoder-[0-9.]+$ && -d "$SOURCE_DIR" ]] || {
  echo "usage: $0 --tag kd1-query-encoder-YYYY.MM.DD --source-dir DIR [--dry-run]" >&2
  exit 2
}
if find "$SOURCE_DIR" -type f -size +95M | grep -q .; then
  echo "a file in $SOURCE_DIR is too large for a plain git blob; split it first" >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY:-T-Damer/MiniMed}"
BRANCH="datasets/${TAG}"
REMOTE="https://github.com/${REPO}.git"
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  echo "$BRANCH already exists; publish a new tag instead" >&2
  exit 1
fi
(cd "$SOURCE_DIR" && find . -type f | sort | sed 's#^\./#  #')
echo "-> $BRANCH:models/kd1-query-encoder/"
[[ "$DRY_RUN" -eq 1 ]] && exit 0

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/minimed-query-model.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT
git -C "$WORKDIR" init -q
git -C "$WORKDIR" checkout -q -b "$BRANCH"
git -C "$WORKDIR" remote add origin "$REMOTE"
mkdir -p "$WORKDIR/models/kd1-query-encoder"
cp -R "$SOURCE_DIR"/. "$WORKDIR/models/kd1-query-encoder/"
cp "$SOURCE_DIR/README.md" "$WORKDIR/README.md"
git -C "$WORKDIR" add .
git -C "$WORKDIR" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "KD1 query encoder ${TAG}"
git -C "$WORKDIR" push -q origin "$BRANCH"
echo "published $BRANCH"
