#!/usr/bin/env bash
set -euo pipefail

max_attempts="${RETRY_MAX_ATTEMPTS:-6}"
initial_delay="${RETRY_INITIAL_DELAY_SECONDS:-60}"
max_delay="${RETRY_MAX_DELAY_SECONDS:-900}"
backoff="${RETRY_BACKOFF_FACTOR:-2}"

if [[ $# -lt 1 ]]; then
  echo "usage: retry-step.sh <command...>" >&2
  exit 2
fi

attempt=1
delay="$initial_delay"
while true; do
  echo "Attempt ${attempt}/${max_attempts}: $*"
  if "$@"; then
    exit 0
  else
    status=$?
  fi
  if [[ $attempt -ge $max_attempts ]]; then
    echo "Command failed after ${max_attempts} attempts (exit ${status})." >&2
    exit "$status"
  fi
  echo "Retrying in ${delay}s..." >&2
  sleep "$delay"
  attempt=$((attempt + 1))
  delay="$(python3 - <<PY
initial = float("${initial_delay}")
current = float("${delay}")
cap = float("${max_delay}")
factor = float("${backoff}")
print(min(cap, current * factor))
PY
)"
done
