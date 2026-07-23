#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v bun >/dev/null || { echo "Bun is required" >&2; exit 1; }
command -v uv >/dev/null || { echo "uv is required" >&2; exit 1; }

bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
bun run verify

echo "LocalMed Search is ready. Run: bun run dev"
