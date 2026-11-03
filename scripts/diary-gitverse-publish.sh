#!/usr/bin/env bash
# Publishes the diaries mirror to GitVerse Pages (owner 2026-11-03: *.gitverse.site opens reliably
# in Russia, github.io does not; GitVerse has no custom domains). The mirror is the app build
# without its content packs — the diaries profile and the patient diary need none — plus the three
# boot files the service worker precaches. It is pushed as a single-commit `pages` branch: the site
# in `site/` and a workflow that uploads it as it is (Settings → Страницы → source «Воркфлоу»; no
# Jekyll). GitVerse Pages serves it at https://<owner>.gitverse.site/<repo>/; the med.1damer.com
# redirects (DIARY_PAGES_URL in apps/diary-server/deploy/serverless/yandex.env) point people there.
#
#   scripts/diary-gitverse-publish.sh           # builds the app, then publishes
#   SKIP_BUILD=1 scripts/diary-gitverse-publish.sh   # publishes apps/app/dist as it is
#   SKIP_BUILD=1 OUT=<dir> scripts/diary-gitverse-publish.sh   # writes the site to <dir>, no push
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/apps/app/dist"
REMOTE="${GITVERSE_REMOTE:-git@gitverse.ru:t_damer/minimed.git}"
# GitVerse Pages refuses build artifacts over 500 MB.
LIMIT_BYTES=$((450 * 1024 * 1024))
BOOT_CONTENT=(content/core-report.json content/reference.db content/regulatory.db)
# Bun 1.2's `-e` takes no arguments: paths go in through the environment.
version_of() { FILE="$1" bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.FILE, "utf8")).version)'; }
VERSION="$(version_of "$ROOT/release.json")"

if [[ "${SKIP_BUILD:-}" != 1 ]]; then
  # Sanitized environment (AGENTS.md «Local execution»): no provider or release credentials.
  (cd "$ROOT" && env -i HOME="$HOME" PATH="$PATH" TERM="${TERM:-dumb}" bun run build:app)
fi

BUILT="$(version_of "$DIST/build-manifest.json")"
if [[ "$BUILT" != "$VERSION" ]]; then
  echo "apps/app/dist is $BUILT, release.json is $VERSION: build first" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
REPO="$STAGE/repo"
SITE="$REPO/site"
rsync -a --exclude '/content/' "$DIST/" "$SITE/"
mkdir -p "$SITE/content"
for file in "${BOOT_CONTENT[@]}"; do cp "$DIST/$file" "$SITE/$file"; done
mkdir -p "$REPO/.gitverse/workflows"
cat >"$REPO/.gitverse/workflows/pages.yaml" <<'YAML'
# Written by scripts/diary-gitverse-publish.sh in the MiniMed repository: publishes `site/` as it is.
name: Publish Pages
on:
  push:
    branches: [pages]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify entrypoint
        run: test -f site/index.html && test -f site/diary/index.html
      - name: Upload pages artifact
        uses: actions/upload-pages-artifact@v1
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      # deploy-pages runs on Go (GitVerse's starter workflow, actions/starter-workflows pages/).
      - uses: actions/setup-go@v4
        with:
          go-version: '>=1.23'
      - id: deployment
        uses: actions/deploy-pages@v1
        with:
          artifact_name: gitverse-pages
      - run: echo "page_url = ${{ steps.deployment.outputs.page_url }}"
YAML

# A missing precached file fails the service worker's install, so every one must be there.
SITE="$SITE" bun -e '
  const { existsSync, readFileSync } = require("fs");
  const site = process.env.SITE;
  const manifest = JSON.parse(readFileSync(`${site}/build-manifest.json`, "utf8"));
  const missing = manifest.precache.filter((path) => !existsSync(`${site}/${path}`));
  if (missing.length) { console.error(`missing precached files: ${missing.join(", ")}`); process.exit(1); }
'
BYTES="$(du -sk "$SITE" | awk '{print $1 * 1024}')"
if ((BYTES > LIMIT_BYTES)); then
  echo "the mirror is $((BYTES / 1024 / 1024)) MB, over the GitVerse Pages limit" >&2
  exit 1
fi

if [[ -n "${OUT:-}" ]]; then
  mkdir -p "$OUT"
  rsync -a --delete "$SITE/" "$OUT/"
  echo "wrote MiniMed $VERSION ($((BYTES / 1024 / 1024)) MB) to $OUT"
  exit 0
fi

git -C "$REPO" init -q -b pages
git -C "$REPO" add -A
git -C "$REPO" -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "MiniMed $VERSION diaries mirror ($(git -C "$ROOT" rev-parse --short=9 HEAD))"
# One commit, replaced on every publish: the branch is a deploy target, not history.
git -C "$REPO" push -q --force "$REMOTE" pages
echo "published MiniMed $VERSION ($((BYTES / 1024 / 1024)) MB) to $REMOTE"
