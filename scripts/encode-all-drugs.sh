#!/usr/bin/env bash
# Manage the resumable local Inkling 2 Mini batch drug encoder (16 GiB RAM budget).
# Usage: bash scripts/encode-all-drugs.sh [start|status|stop|tail]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${INKLING_OUT_DIR:-$ROOT_DIR/data/build/drug-properties-inkling}"
PID_FILE="$OUT_DIR/runner.pid"
LOG_FILE="$OUT_DIR/runner.log"
PROGRESS_FILE="$OUT_DIR/progress.json"
STOP_FILE="$OUT_DIR/STOP"
CMD="${1:-status}"

mkdir -p "$OUT_DIR"

is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

case "$CMD" in
  start)
    if is_running; then
      echo "Already running (PID $(cat "$PID_FILE"))."
      exit 0
    fi
    rm -f "$STOP_FILE"
    cd "$ROOT_DIR"
    shift || true
    if [ "$#" -eq 0 ]; then
      set -- --mode atomic --workers 2 --budget-gib 16 --draft-max 3
    fi
    nohup bun scripts/encode-all-drugs.ts --out "$OUT_DIR" "$@" >> "$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
    echo "Started drug encoder PID $(cat "$PID_FILE") ($*)"
    echo "Log:      $LOG_FILE"
    echo "Progress: $PROGRESS_FILE"
    ;;
  status)
    if is_running; then
      echo "RUNNING (PID $(cat "$PID_FILE"))"
    else
      echo "NOT RUNNING"
    fi
    if [ -f "$PROGRESS_FILE" ]; then
      cat "$PROGRESS_FILE"
    fi
    ;;
  stop)
    touch "$STOP_FILE"
    if is_running; then
      echo "Created $STOP_FILE and sent SIGTERM to PID $(cat "$PID_FILE"); it will finish the current drug and exit cleanly."
      kill -TERM "$(cat "$PID_FILE")" 2>/dev/null || true
    else
      echo "Not running (created $STOP_FILE)."
    fi
    ;;
  tail)
    tail -n 30 -f "$LOG_FILE"
    ;;
  *)
    echo "Usage: $0 [start|status|stop|tail]" >&2
    exit 1
    ;;
esac
