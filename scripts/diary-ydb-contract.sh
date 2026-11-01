#!/usr/bin/env bash
# Runs the diary storage contract on Node over a real YDB database (ADR-0027).
#
#   scripts/diary-ydb-contract.sh 'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/…'
#
# Use a test database, not production: every run leaves its rows. The token comes from the yc CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONNECTION="${1:?usage: $0 <YDB connection string>}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

bun build "$ROOT/apps/diary-server/src/contract-ydb.ts" --target=node --format=esm --outfile "$OUT/contract.mjs" >/dev/null
env -i PATH="$PATH" HOME="$HOME" DIARY_YDB="$CONNECTION" \
  YDB_ACCESS_TOKEN_CREDENTIALS="$(yc iam create-token)" node "$OUT/contract.mjs"
