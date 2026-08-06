#!/usr/bin/env bash
# Mirror clinical-*.db files onto branch datasets/<tag> for CORS-safe browser downloads.
# Usage:
#   scripts/publish-clinical-datasets-branch.sh <tag> [source-dir]
# source-dir defaults to downloading the release assets for <tag>.
set -euo pipefail

TAG="${1:?usage: $0 <tag> [source-dir]}"
SOURCE_DIR="${2:-}"
REPO="${GITHUB_REPOSITORY:-T-Damer/MiniMed}"
BRANCH="datasets/${TAG}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/minimed-clinical-datasets.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

CLINICAL_DIR="$WORKDIR/apps/app/public/content/clinical"
mkdir -p "$CLINICAL_DIR"

if [[ -n "$SOURCE_DIR" ]]; then
  if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "source-dir not found: $SOURCE_DIR" >&2
    exit 1
  fi
  # Copy only module databases; skip catalog/manifest sidecars.
  find "$SOURCE_DIR" -maxdepth 1 -type f -name 'clinical-*.db' -exec cp -f {} "$CLINICAL_DIR"/ \;
else
  gh release download "$TAG" --repo "$REPO" --pattern 'clinical-*.db' --dir "$CLINICAL_DIR" --clobber
fi

count="$(find "$CLINICAL_DIR" -type f -name 'clinical-*.db' | wc -l | tr -d ' ')"
if [[ "$count" -lt 1 ]]; then
  echo "no clinical-*.db files to publish" >&2
  exit 1
fi

cat >"$WORKDIR/README.md" <<EOF
# Clinical snapshot databases

Immutable SQLite modules for tag ${TAG}.
Browser downloads use raw.githubusercontent.com (CORS + CORP).
Branch: ${BRANCH}
EOF

git -C "$WORKDIR" init -q
git -C "$WORKDIR" checkout -q -b "$BRANCH"
git -C "$WORKDIR" add README.md apps
git -C "$WORKDIR" \
  -c user.name='MiniMed clinical publisher' \
  -c user.email='minimed-clinical-publisher@users.noreply.github.com' \
  commit -q -m "Add ${TAG} clinical recommendation databases"

# Authenticated push when GH_TOKEN is present (CI); otherwise use the caller remote credentials.
if [[ -n "${GH_TOKEN:-}" ]]; then
  git -C "$WORKDIR" remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
else
  git -C "$WORKDIR" remote add origin "https://github.com/${REPO}.git"
fi

git -C "$WORKDIR" push -f origin "HEAD:refs/heads/${BRANCH}"
echo "published ${count} modules → ${BRANCH}"
