#!/usr/bin/env bash
# Adds repacked `.db.zst` module indexes to a dataset mirror branch WITHOUT touching what is there
# (older app versions keep reading the `.db` files). Run it only after the owner agreed to publish.
#
#   scripts/publish-module-zstd-mirror.sh --family esklp|clinical|packaging-images --tag <release tag> \
#     --source-dir <repack out dir> [--create] [--dry-run]
#
# `--create` starts the branch `datasets/<tag>` (an orphan commit with a README) when it does not
# exist yet: an incremental snapshot such as clinical-json-2026.10.02-* has no `.db` files and no
# release, only the zstd modules. An existing branch is never replaced, with or without the flag.
#
# Layout on the branch `datasets/<tag>` (what artifact-url.ts resolves):
#   esklp:    modules/<file>.db.zst
#   clinical: apps/app/public/content/clinical/<file>.db.zst
#   packaging-images: modules/minimed.medications.packaging-images.ru.{db,source-assets-<x>.zip}
#     (the Allmed photo pack: an index and 16 ZIP shards of 15-22 MB each; the pack builder's
#     `build-allmed-image-pack --mirror-tag <tag>` writes these files into its `mirror/` directory)
# The files are plain git blobs (each far below the 100 MB limit): raw.githubusercontent.com serves
# them with CORS and without LFS bandwidth quota. The existing `.db` LFS files stay.
#
# scripts/publish-clinical-datasets-branch.sh force-pushes an orphan branch holding only
# `clinical-*.db`; never use it for this, it would delete the files published before.
set -euo pipefail

FAMILY="" TAG="" SOURCE_DIR="" DRY_RUN=0 CREATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --family) FAMILY="${2:?}"; shift 2 ;;
    --tag) TAG="${2:?}"; shift 2 ;;
    --source-dir) SOURCE_DIR="${2:?}"; shift 2 ;;
    --create) CREATE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$FAMILY" && -n "$TAG" && -d "$SOURCE_DIR" ]] || { echo "usage: $0 --family esklp|clinical --tag TAG --source-dir DIR [--create] [--dry-run]" >&2; exit 2; }

REPO="${GITHUB_REPOSITORY:-T-Damer/MiniMed}"
BRANCH="datasets/${TAG}"
case "$FAMILY" in
  esklp) TARGET="modules" ;;
  clinical) TARGET="apps/app/public/content/clinical" ;;
  packaging-images) TARGET="modules" ;;
  *) echo "family must be esklp, clinical or packaging-images" >&2; exit 2 ;;
esac

if [[ "$FAMILY" == "packaging-images" ]]; then
  FILE_PATTERN='minimed.medications.packaging-images.ru.*'
else
  FILE_PATTERN='*.db.zst'
fi
count="$(find "$SOURCE_DIR" -maxdepth 1 -type f -name "$FILE_PATTERN" | wc -l | tr -d ' ')"
[[ "$count" -ge 1 ]] || { echo "no ${FILE_PATTERN} files in $SOURCE_DIR" >&2; exit 1; }
echo "$count files -> $BRANCH:$TARGET/ (additive, no force)"
[[ "$DRY_RUN" -eq 1 ]] && exit 0

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/minimed-zstd-mirror.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT
REMOTE="https://github.com/${REPO}.git"
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  # GIT_LFS_SKIP_SMUDGE keeps the existing multi-hundred-MB LFS databases out of this clone.
  GIT_LFS_SKIP_SMUDGE=1 git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$WORKDIR"
elif [[ "$CREATE" -eq 1 ]]; then
  git -C "$WORKDIR" init -q
  git -C "$WORKDIR" checkout -q -b "$BRANCH"
  git -C "$WORKDIR" remote add origin "$REMOTE"
  printf '# Clinical recommendation modules\n\nImmutable zstd-framed SQLite modules for %s.\nBrowser downloads use raw.githubusercontent.com (CORS + CORP).\nBranch: %s\n' "$TAG" "$BRANCH" >"$WORKDIR/README.md"
  git -C "$WORKDIR" add README.md
else
  echo "branch ${BRANCH} does not exist; pass --create to start it" >&2
  exit 1
fi
mkdir -p "$WORKDIR/$TARGET"
find "$SOURCE_DIR" -maxdepth 1 -type f -name "$FILE_PATTERN" -exec cp -f {} "$WORKDIR/$TARGET"/ \;
# The branch tracks `*.db` in LFS only; the published files must stay plain blobs.
for probe in probe.db.zst probe.db probe.zip; do
  if git -C "$WORKDIR" check-attr filter -- "$TARGET/$probe" | grep -q 'lfs'; then
    echo "refusing: $probe would be stored in LFS on $BRANCH" >&2
    exit 1
  fi
done
if find "$WORKDIR/$TARGET" -maxdepth 1 -type f -size +99M | grep -q .; then
  echo "refusing: a file reaches GitHub's 100 MB blob limit" >&2
  exit 1
fi
git -C "$WORKDIR" add "$TARGET"
git -C "$WORKDIR" \
  -c user.name='MiniMed module publisher' \
  -c user.email='minimed-module-publisher@users.noreply.github.com' \
  commit -q -m "Add zstd module indexes for ${TAG} (${count} files)"
# No --force: an existing branch can only grow, a new branch is only created.
git -C "$WORKDIR" push origin "HEAD:refs/heads/${BRANCH}"
echo "published ${count} zstd modules to ${BRANCH}"
