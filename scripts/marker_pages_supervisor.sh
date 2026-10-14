#!/bin/bash
# Keeps scripts/marker_pages_run.py going until every page of JOBS.json is converted (LEGAL1).
#   scripts/marker_pages_supervisor.sh JOBS.json OUT_DIR   (run detached: nohup caffeinate -i ... &)
# Restarts the runner every 120 pages (the Surya helper servers grow, so they are killed between runs), waits while
# free memory is low (exit 3), and gives up on a page after two timeouts (exit 4, recorded in OUT_DIR/failed.json).
JOBS="$1"
OUT="$2"
MAIN=/Users/d/Projects/Personal/MiniMed
PY="$MAIN/data/build/marker-eval/venv/bin/python"
RUNNER="$(cd "$(dirname "$0")" && pwd)/marker_pages_run.py"
mkdir -p "$OUT"
LOG="$OUT/supervisor.log"
free_gib() { vm_stat | awk '/page size/ {ps=$8} /Pages free/ {f=$3} /Pages inactive/ {i=$3} /Pages speculative/ {s=$3} END {printf "%d", (f+i+s)*ps/1073741824}'; }
while true; do
  pkill -f 'surya\.(fast_layout|ocr_error)' 2>/dev/null
  pkill -f llama-server 2>/dev/null
  sleep 3
  while [ "$(free_gib)" -lt 16 ]; do
    echo "$(date '+%F %T') waiting for memory: $(free_gib) GiB free" >> "$LOG"
    sleep 120
  done
  echo "$(date '+%F %T') start" >> "$LOG"
  "$PY" -I "$RUNNER" "$JOBS" "$OUT" --max-pages 120 >> "$OUT/runner.log" 2>&1
  CODE=$?
  echo "$(date '+%F %T') runner exit $CODE" >> "$LOG"
  case "$CODE" in
    0) echo "$(date '+%F %T') all pages done" >> "$LOG"; break ;;
    10|4) ;;
    3) sleep 300 ;;
    *) sleep 60 ;;
  esac
done
pkill -f 'surya\.(fast_layout|ocr_error)' 2>/dev/null
pkill -f llama-server 2>/dev/null
