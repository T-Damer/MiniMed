#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v corepack >/dev/null || { echo "Corepack is required" >&2; exit 1; }
command -v uv >/dev/null || { echo "uv is required" >&2; exit 1; }

corepack enable
pnpm install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
pnpm verify

echo "LocalMed Search is ready. Run: pnpm dev"
