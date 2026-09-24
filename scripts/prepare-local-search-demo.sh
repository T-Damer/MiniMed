#!/usr/bin/env bash
# Explicit setup/download; ordinary MiniMed builds never call this script.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v bun >/dev/null || { echo 'Bun 1.2.3 is required.' >&2; exit 1; }
command -v uv >/dev/null || { echo 'uv is required.' >&2; exit 1; }
bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
uv run --project tools/ingest medbase lint --input content/definition-pilot
uv run --project tools/ingest medbase build --input content/definition-pilot \
  --output data/build/definitions.db --report data/build/definitions-build.json --lexical-only
uv venv .venv-cross --python 3.12 --allow-existing
if [[ "$(uname -s)" == Linux ]]; then
  uv pip install --python .venv-cross/bin/python \
    --index-url https://download.pytorch.org/whl/cpu torch==2.8.0
else
  uv pip install --python .venv-cross/bin/python torch==2.8.0
fi
uv pip install --python .venv-cross/bin/python transformers==5.12.1
.venv-cross/bin/python tools/benchmarks/local_reranker.py prepare
printf '\nReady. Run: bun tools/benchmarks/src/local-search-demo.ts\n'
