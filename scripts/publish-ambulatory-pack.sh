#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(bun -p "require(\"$root/release.json\").version")"
db="$root/apps/app/public/content/ambulatory.db"
test -f "$db" || db="$root/data/build/ambulatory.db"
test -f "$db" || { echo "missing ambulatory.db — run bun run content:build:ambulatory"; exit 1; }
gh release upload "v$version" "$db" --clobber
echo "uploaded $(basename "$db") → v$version"
