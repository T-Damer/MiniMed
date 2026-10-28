#!/usr/bin/env bash
# Builds the faculty self-host package of the connected diary (docs/DIARY_SELFHOST.md).
#
#   scripts/diary-selfhost-package.sh        # -> output/diary-selfhost-<version>.tar.gz (+ .sha256)
#
# Builds the app like scripts/diary-deploy.sh does (`bun run build:app`, in a sanitized environment
# like the CI builds), then packs: the built app, the diary server source with the two workspace
# packages it imports, a minimal root package.json + bun.lock for `bun install --production`, the
# systemd/Caddy files, the installer and a README. Nothing from data/, env files or node_modules.
#
# SKIP_BUILD=1 reuses apps/app/dist. DIARY_PACKAGE_VERSION overrides <release>-<git sha>.
# Like the release builds, the optional companion databases over 32 MiB (medications, mkb,
# ambulatory) are left out; the app downloads them on demand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DEPLOY="$ROOT/apps/diary-server/deploy"

RELEASE="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("release.json", "utf8")).version)')"
BUN_VERSION="$(bun -e 'const m = /^bun@(\d+\.\d+\.\d+)$/.exec(JSON.parse(require("fs").readFileSync("package.json", "utf8")).packageManager ?? ""); if (!m) { console.error("package.json packageManager must be bun@x.y.z"); process.exit(1); } console.log(m[1])')"
SHA="$(git rev-parse --short=9 HEAD)"
VERSION="${DIARY_PACKAGE_VERSION:-$RELEASE-$SHA}"
[[ $VERSION =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "bad version: $VERSION" >&2
  exit 1
}
NAME="diary-selfhost-$VERSION"
OUT="$ROOT/output/$NAME.tar.gz"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/$NAME"
mkdir -p "$PKG/apps/diary-server" "$PKG/packages" "$PKG/deploy" "$ROOT/output"

# Developer-local Vite settings would be baked into a build shipped to somebody else.
shopt -s nullglob
local_env=("$ROOT"/apps/app/.env.local "$ROOT"/apps/app/.env.*.local "$ROOT"/.env.local "$ROOT"/.env.*.local)
shopt -u nullglob
if ((${#local_env[@]})); then
  echo "WARNING: Vite reads these developer-local files into the build (VITE_* values become public):" >&2
  printf '  %s\n' "${local_env[@]#"$ROOT"/}" >&2
fi

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  env -i PATH="$PATH" HOME="$HOME" CI=1 bun run build:app
fi
[[ -f apps/app/dist/index.html ]] || {
  echo "apps/app/dist is missing: build the app first" >&2
  exit 1
}

# 1. The built app, without the optional companion databases (as in the release builds).
excludes=()
for companion in content/medications.db content/mkb.db content/ambulatory.db; do
  if [[ -f apps/app/dist/$companion ]] && (($(wc -c <"apps/app/dist/$companion") >= 32 * 1024 * 1024)); then
    excludes+=(--exclude "./$companion")
  fi
done
mkdir "$PKG/app"
tar -C apps/app/dist -cf - "${excludes[@]}" . | tar -C "$PKG/app" -xf -

# 2. Server source and the workspace packages it imports (sources only, no tests).
copy_sources() { # <dir>: <dir>/src without tests
  mkdir -p "$PKG/$1"
  tar -C "$ROOT/$1" --exclude '*.test.ts' --exclude '*.test.tsx' -cf - src | tar -C "$PKG/$1" -xf -
}
copy_sources apps/diary-server
copy_sources packages/contracts
copy_sources packages/diary-sync

# Trimmed manifests: no scripts that need the monorepo, no dev dependencies.
# shellcheck disable=SC2016
PKG="$PKG" ROOT="$ROOT" BUN_VERSION="$BUN_VERSION" bun --eval '
const fs = require("fs");
const { ROOT: root, BUN_VERSION: bunVersion, PKG: pkgDir } = process.env;
const read = (path) => JSON.parse(fs.readFileSync(`${root}/${path}/package.json`, "utf8"));
const write = (path, value) => fs.writeFileSync(`${path}/package.json`, `${JSON.stringify(value, null, 2)}\n`);
for (const path of ["apps/diary-server", "packages/contracts", "packages/diary-sync"]) {
  const { name, version, type, exports, dependencies } = read(path);
  const manifest = { name, version, private: true, type, ...(exports ? { exports } : {}), ...(dependencies ? { dependencies } : {}) };
  if (path === "apps/diary-server") manifest.scripts = { start: "bun src/main.ts", invite: "bun src/cli.ts invite" };
  write(`${pkgDir}/${path}`, manifest);
}
write(pkgDir, {
  name: "minimed-diary-selfhost",
  private: true,
  type: "module",
  packageManager: `bun@${bunVersion}`,
  workspaces: ["apps/diary-server", "packages/contracts", "packages/diary-sync"],
});
'

# 3. The lockfile, checked by a frozen production install of the manifests alone.
(cd "$PKG" && env -i PATH="$PATH" HOME="$HOME" bun install --lockfile-only)
[[ -f $PKG/bun.lock ]] || {
  echo "bun did not write bun.lock" >&2
  exit 1
}
CHECK="$STAGE/lock-check"
mkdir "$CHECK"
tar -C "$PKG" --exclude './app' -cf - . | tar -C "$CHECK" -xf -
(cd "$CHECK" && env -i PATH="$PATH" HOME="$HOME" bun install --production --frozen-lockfile >/dev/null)
[[ -d $CHECK/node_modules/zod ]] || {
  echo "frozen production install did not produce zod" >&2
  exit 1
}
rm -rf "$CHECK"

# 4. Deploy files, installer, README, pins.
cp "$DEPLOY/selfhost/minimed-diary.service" "$DEPLOY/selfhost/Caddyfile.in" \
  "$DEPLOY/selfhost/minimed-diary-backup.service" "$DEPLOY/minimed-diary-backup.timer" "$PKG/deploy/"
install -m 0755 "$DEPLOY/selfhost/install.sh" "$PKG/install.sh"
cp "$DEPLOY/selfhost/README.md" "$PKG/README.md"
printf '%s\n' "$VERSION" >"$PKG/VERSION"
printf '%s\n' "$BUN_VERSION" >"$PKG/BUN_VERSION"
# Checksums of the Linux Bun builds, fetched now so the installer verifies against what we saw.
curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/SHASUMS256.txt" |
  grep -E '  bun-linux-(x64|x64-baseline|aarch64)\.zip$' >"$PKG/bun-linux.sha256"
[[ $(wc -l <"$PKG/bun-linux.sha256") -eq 3 ]] || {
  echo "could not read the Bun $BUN_VERSION checksums" >&2
  exit 1
}

# 5. Nothing private may be inside.
find "$PKG" -name '.DS_Store' -delete
leaks="$(find "$PKG" \( -name node_modules -o -name '.env*' -o -name '*.sqlite*' -o -name 'diary.db*' \
  -o -name '*.pem' -o -name '*.key' -o -name '.git*' -o -name '__pycache__' -o -name '._*' \
  -o -path '*/data' \) -print)"
if [[ -n $leaks ]]; then
  echo "refusing to pack, unexpected files:" >&2
  echo "$leaks" >&2
  exit 1
fi

# 6. The tarball.
tar_opts=()
if tar --version 2>/dev/null | grep -q bsdtar; then
  tar_opts=(--uid 0 --gid 0 --no-xattrs)
else
  tar_opts=(--owner=0 --group=0 --numeric-owner)
fi
rm -f "$OUT" "$OUT.sha256"
COPYFILE_DISABLE=1 tar "${tar_opts[@]}" -czf "$OUT" -C "$STAGE" "$NAME"
(cd "$ROOT/output" && shasum -a 256 "$NAME.tar.gz" >"$NAME.tar.gz.sha256")

echo "$OUT"
du -h "$OUT" | cut -f1
