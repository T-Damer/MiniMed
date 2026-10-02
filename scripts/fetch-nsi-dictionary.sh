#!/usr/bin/env bash
# Re-fetches an NSI dictionary (default: АТХ) into data/raw/nsi/ inside a disposable container.
# Usage: scripts/fetch-nsi-dictionary.sh [oid] [label]
# The Russian national root CA is trusted inside the container only; the NSI user key is passed
# through a 0600 env-file that holds that one variable and is deleted on exit. Never printed.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
oid="${1:-1.2.643.5.1.13.13.99.2.473}"
label="${2:-atc}"
image="${NSI_FETCH_IMAGE:-node:24-bookworm-slim}"

umask 077
envfile="$(mktemp)"
trap 'rm -f "$envfile"' EXIT
grep -E '^NSI_USER_TOKEN=' "$root/.env" >"$envfile" || {
  echo "NSI_USER_TOKEN is missing in .env" >&2
  exit 1
}
echo "NSI_FETCH_IN_CONTAINER=1" >>"$envfile"

mkdir -p "$root/data/raw/nsi"
docker run --rm \
  --env-file "$envfile" \
  --user "$(id -u):$(id -g)" \
  -v "$root/scripts/fetch-nsi-dictionary.mjs:/app/fetch-nsi-dictionary.mjs:ro" \
  -v "$root/data/raw/nsi:/out" \
  "$image" node /app/fetch-nsi-dictionary.mjs --oid "$oid" --label "$label" --out /out
