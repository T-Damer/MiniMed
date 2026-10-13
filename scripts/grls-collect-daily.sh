#!/usr/bin/env bash
# Start / inspect / stop the ГРЛС daily instruction collector (G1/G2).
#
#   scripts/grls-collect-daily.sh start    # detached; survives the terminal and the agent session
#   scripts/grls-collect-daily.sh status
#   scripts/grls-collect-daily.sh stop     # clean stop through the STOP file (≤ 30 s, or after the current registration)
#
# One instance only: `start` refuses when a loop is already running. The loop's pace is unchanged
# (probe with ONE registration, then at most 50 registrations per window, 10-20 s between requests,
# one request at a time, truthful User-Agent, 24 h between windows, stop at the first CAPTCHA).
# It never solves or works around a CAPTCHA. It is resumable: state is the append-only ledger
# `data/build/grls-instructions-active-state.jsonl`; the next attempt time is read from the previous
# `progress.json`, so a restart after a reboot does not make an extra window on the same day.
# No LaunchAgent or other persistent system configuration is installed; after a reboot run `start` again.
#
# The private data lives only in the main checkout; override with MINIMED_ROOT when running from a worktree.
set -euo pipefail

ROOT="${MINIMED_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="$ROOT/data/build/grls-collect"
PID_FILE="$LOG_DIR/daily-loop.pid"

running_pids() {
  pgrep -f "medbase-regulated-catalog grls-collect-daily" || true
}

next_attempt() {
  # Print the previous loop's nextAttemptAt (UTC ISO) when it is still in the future, else nothing.
  python3 - "$LOG_DIR/progress.json" <<'PY'
import json, sys
from datetime import datetime, timezone
try:
    progress = json.load(open(sys.argv[1], encoding="utf-8"))
    when = progress.get("nextAttemptAt")
    if when and datetime.fromisoformat(when.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        print(when)
except (OSError, ValueError):
    pass
PY
}

case "${1:-status}" in
  start)
    if [[ -n "$(running_pids)" ]]; then
      echo "already running: pid $(running_pids | tr '\n' ' ')" >&2
      exit 0
    fi
    mkdir -p "$LOG_DIR"
    rm -f "$LOG_DIR/STOP"
    args=(
      --plan ../../data/build/grls-instructions-active-plan-02.10.2026.json
      --output-root ../../data/raw/grls-instructions-active
      --state ../../data/build/grls-instructions-active-state.jsonl
      --log-dir ../../data/build/grls-collect
      --catalog ../../data/raw/official-grls-registry/catalog-02.10.2026.json
      --queue groups
      --manifest ../../data/build/grls-instruction-text-manifest.jsonl
      --batch-cap 50 --wait-hours 24
    )
    first="$(next_attempt)"
    [[ -n "$first" ]] && args+=(--first-attempt-at "$first")
    cd "$ROOT/tools/ingest"
    # perl setsid: a new session, so a closing terminal or agent session does not take the loop down.
    nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
      uv run --frozen medbase-regulated-catalog grls-collect-daily "${args[@]}" \
      >> "$LOG_DIR/stdout-daily.log" 2>&1 < /dev/null &
    pid=$!
    echo "$pid" > "$PID_FILE"
    # keep the Mac awake while the loop lives (display may sleep)
    nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' caffeinate -i -w "$pid" > /dev/null 2>&1 < /dev/null &
    echo "started pid $pid, log $LOG_DIR/stdout-daily.log, progress $LOG_DIR/progress.json"
    ;;
  status)
    pids="$(running_pids | tr '\n' ' ')"
    echo "pids: ${pids:-none}"
    [[ -f "$LOG_DIR/progress.json" ]] && python3 - "$LOG_DIR/progress.json" <<'PY'
import json, sys
p = json.load(open(sys.argv[1], encoding="utf-8"))
print(p["status"], "next:", p.get("nextAttemptAt"), "totals:", p["totals"])
print("coverage:", {k: p["coverage"].get(k) for k in ("groupsCovered", "groupsTotal", "essentialGroupsCovered", "essentialGroupsTotal", "queueFirstPass")})
PY
    ;;
  stop)
    touch "$LOG_DIR/STOP"
    echo "STOP written; the loop ends within 30 s (or after the current registration)"
    ;;
  *)
    echo "usage: $0 start|status|stop" >&2
    exit 2
    ;;
esac
