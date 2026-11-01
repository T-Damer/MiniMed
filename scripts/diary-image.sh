#!/usr/bin/env bash
# Builds the connected diary's container image (apps/diary-server/deploy/container, docs/DIARY_SELFHOST.md).
#
#   scripts/diary-image.sh               # local image minimed-diary:<version> and minimed-diary:local
#   PUSH=1 scripts/diary-image.sh        # amd64 + arm64 to ghcr.io/t-damer/minimed-diary:<version>, :latest
#
# Builds the app (sanitized environment, as in CI), bundles the
# service, its CLI and the backup job into single files (bun build --target=bun), and builds the image
# from a staging folder. Like the release builds, companion databases over 32 MiB are left out of the
# app; it downloads them on demand. SKIP_BUILD=1 reuses apps/app/dist. IMAGE overrides the GHCR name.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CONTAINER="$ROOT/apps/diary-server/deploy/container"
IMAGE="${IMAGE:-ghcr.io/t-damer/minimed-diary}"

VERSION="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("release.json", "utf8")).version)')"
BUN_VERSION="$(bun -e 'const m = /^bun@(\d+\.\d+\.\d+)$/.exec(JSON.parse(require("fs").readFileSync("package.json", "utf8")).packageManager ?? ""); if (!m) { console.error("package.json packageManager must be bun@x.y.z"); process.exit(1); } console.log(m[1])')"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  env -i PATH="$PATH" HOME="$HOME" CI=1 bun run build:app
fi
[[ -f apps/app/dist/index.html ]] || {
  echo "apps/app/dist is missing: build the app first" >&2
  exit 1
}

excludes=()
for companion in content/medications.db content/mkb.db content/ambulatory.db; do
  if [[ -f apps/app/dist/$companion ]] && (($(wc -c <"apps/app/dist/$companion") >= 32 * 1024 * 1024)); then
    excludes+=(--exclude "./$companion")
  fi
done
mkdir "$STAGE/app"
tar -C apps/app/dist -cf - "${excludes[@]}" . | tar -C "$STAGE/app" -xf -

bun build apps/diary-server/src/main.ts --target=bun --outfile "$STAGE/diary-server.js"
bun build apps/diary-server/src/cli.ts --target=bun --outfile "$STAGE/diary-cli.js"
bun build apps/diary-server/src/backup.ts --target=bun --outfile "$STAGE/diary-backup.js"
cp "$CONTAINER/Dockerfile" "$STAGE/"

labels=(--label "org.opencontainers.image.version=$VERSION"
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)"
  --label "org.opencontainers.image.source=https://github.com/T-Damer/MiniMed")
if [[ "${PUSH:-}" == "1" ]]; then
  docker buildx build --platform linux/amd64,linux/arm64 --build-arg "BUN_VERSION=$BUN_VERSION" \
    "${labels[@]}" -t "$IMAGE:$VERSION" -t "$IMAGE:latest" --push "$STAGE"
  echo "pushed $IMAGE:$VERSION"
else
  docker build --build-arg "BUN_VERSION=$BUN_VERSION" "${labels[@]}" \
    -t "minimed-diary:$VERSION" -t minimed-diary:local "$STAGE"
  echo "built minimed-diary:$VERSION (also :local)"
fi
