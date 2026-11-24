#!/usr/bin/env bash
# Launch or set up Inkling 2 Mini (AD-IQ2_M + AtomicChat Q8_0 DSpark) on Apple Silicon via
# Atomic Engine (`codex/expert-weight-source`) with a managed RAM budget (default: 16 GiB).
# Loopback-only (`127.0.0.1`) OpenAI-compatible API + web chat.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="${ATOMIC_ENGINE_DIR:-$ROOT_DIR/data/tools/atomic-engine}"
SERVER_BIN="$ENGINE_DIR/build-metal-release/bin/llama-server"
MODEL_DIR="${INKLING_MODEL_DIR:-$ROOT_DIR/data/models/inkling-2-mini}"
MODEL_FILE="${INKLING_MODEL_FILE:-$MODEL_DIR/Inkling-2-Mini-AD-IQ2_M.gguf}"
DRAFT_FILE="${INKLING_DRAFT_FILE:-$MODEL_DIR/dspark-Inkling-2-Mini-Q8_0.gguf}"

BUDGET_GIB="${INKLING_BUDGET_GIB:-16}"
# Per Atomic Engine README: Metal Inkling budget = 1024 * GiB + 100 MiB KV reserve.
BUDGET_MIB="${INKLING_BUDGET_MIB:-$((BUDGET_GIB * 1024 + 100))}"
CTX_SIZE="${INKLING_CTX_SIZE:-4096}"
HOST="${INKLING_HOST:-127.0.0.1}"
PORT="${INKLING_PORT:-8080}"
THREADS="${INKLING_THREADS:-8}"
REASONING="${INKLING_REASONING:-}"
REASONING_BUDGET="${INKLING_REASONING_BUDGET:-}"

CMD="${1:-serve}"

setup_engine() {
  mkdir -p "$(dirname "$ENGINE_DIR")" "$MODEL_DIR"
  if [ ! -d "$ENGINE_DIR/.git" ]; then
    git clone --depth=1 --branch codex/expert-weight-source \
      https://github.com/AtomicBot-ai/atomic-engine.git "$ENGINE_DIR"
  fi
  if [ ! -x "$SERVER_BIN" ]; then
    cmake -S "$ENGINE_DIR" -B "$ENGINE_DIR/build-metal-release" \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_TOOLS=ON \
      -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_APP=OFF \
      -DLLAMA_BUILD_UI=OFF -DLLAMA_OPENSSL=OFF \
      -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BLAS=OFF -DGGML_CCACHE=OFF
    cmake --build "$ENGINE_DIR/build-metal-release" --target llama-server -j "$THREADS"
  fi
  if [ ! -f "$DRAFT_FILE" ]; then
    curl -fL --retry 5 --retry-delay 3 -C - \
      -o "$DRAFT_FILE" \
      "https://huggingface.co/AtomicChat/Inkling-2-Mini-GGUF/resolve/309509848b3151419aa26d069eb03db57fd29a00/dspark-Inkling-2-Mini-Q8_0.gguf"
  fi
  if [ ! -f "$MODEL_FILE" ]; then
    curl -fL --http1.1 --retry 5 --retry-delay 3 -C - \
      -o "$MODEL_FILE" \
      "https://huggingface.co/AtomicChat/Inkling-2-Mini-GGUF/resolve/main/$(basename "$MODEL_FILE")"
  fi
}

case "$CMD" in
  setup)
    setup_engine
    echo "Ready: $SERVER_BIN"
    ls -lh "$MODEL_FILE" "$DRAFT_FILE"
    ;;
  serve)
    if [ ! -x "$SERVER_BIN" ] || [ ! -f "$MODEL_FILE" ] || [ ! -f "$DRAFT_FILE" ]; then
      echo "Missing binary or weights; running setup first..." >&2
      setup_engine
    fi
    EXTRA_ARGS=()
    if [ -n "$REASONING" ]; then
      EXTRA_ARGS+=(--reasoning "$REASONING")
    fi
    if [ -n "$REASONING_BUDGET" ]; then
      EXTRA_ARGS+=(--reasoning-budget "$REASONING_BUDGET")
    fi
    exec "$SERVER_BIN" \
      -m "$MODEL_FILE" \
      -md "$DRAFT_FILE" \
      --spec-type draft-dspark --spec-draft-n-max 3 --spec-draft-n-ubatch 32 \
      --engine-budget-mib "$BUDGET_MIB" \
      -fit off -c "$CTX_SIZE" -b 1024 -ub 1024 -np 1 \
      -fa on -ctk q4_0 -ctv q4_0 -ctkd q4_0 -ctvd q4_0 -ngl all -ngld 99 \
      -t "$THREADS" -tb "$THREADS" \
      --temp 0 --cache-ram 0 --ctx-checkpoints 0 --no-warmup --metrics \
      --ui --alias inkling-2-mini --host "$HOST" --port "$PORT" \
      "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
    ;;
  *)
    echo "Usage: $0 [setup|serve]" >&2
    exit 1
    ;;
esac
