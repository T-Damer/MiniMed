#!/usr/bin/env bash
# Demo of the connected diary from this Mac over HTTPS (docs/DIARY_SERVICE.md «Demo tunnel»).
#
#   scripts/diary-demo.sh start     # build the app, start the diary service and the cloudflared tunnel
#   scripts/diary-demo.sh status
#   scripts/diary-demo.sh invite    # a one-time code for a doctor's sign-up
#   scripts/diary-demo.sh stop
#
# Test data only: the tunnel ends TLS at Cloudflare (records stay end-to-end encrypted, but metadata
# passes a foreign proxy, ADR-0026 §8). Pilot patients go to the Yandex Cloud VM instead.
# Separate database from development (data/diary-server/demo.db), invite-only sign-up, port 8792.
# Detached processes; no LaunchAgent is installed: after a reboot run `start` again.
set -euo pipefail

ROOT="${MINIMED_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DIR="$ROOT/data/diary-server"
HOSTNAME_DEMO="${DIARY_DEMO_HOST:-med-dev.1damer.com}"
TUNNEL="${DIARY_DEMO_TUNNEL:-minimed-dev}"
PORT="${DIARY_DEMO_PORT:-8792}"
TUNNEL_CONFIG="$HOME/.cloudflared/$TUNNEL.yml"

pid_alive() {
  [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null
}

server_env() {
  env DIARY_HOST=127.0.0.1 DIARY_PORT="$PORT" DIARY_DB="$DIR/demo.db" \
    DIARY_STATIC="$ROOT/apps/app/dist" DIARY_SIGNUP=invite \
    DIARY_PUSH_SUBJECT="mailto:admin@1damer.com" "$@"
}

case "${1:-status}" in
  start)
    mkdir -p "$DIR"
    if [[ ! -f "$TUNNEL_CONFIG" ]]; then
      echo "no tunnel config $TUNNEL_CONFIG (see docs/DIARY_SERVICE.md «Demo tunnel»)" >&2
      exit 1
    fi
    if [[ "${SKIP_BUILD:-}" != "1" ]]; then
      (cd "$ROOT" && bun run build:app >"$DIR/demo-build.log" 2>&1) || {
        echo "build failed: $DIR/demo-build.log" >&2
        exit 1
      }
    fi
    if pid_alive "$DIR/demo-server.pid"; then
      echo "service already running (pid $(cat "$DIR/demo-server.pid"))"
    else
      (cd "$ROOT/apps/diary-server" && server_env nohup bun src/main.ts >>"$DIR/demo-server.log" 2>&1 &
        echo $! >"$DIR/demo-server.pid")
      echo "service started on 127.0.0.1:$PORT"
    fi
    if pid_alive "$DIR/demo-tunnel.pid"; then
      echo "tunnel already running (pid $(cat "$DIR/demo-tunnel.pid"))"
    else
      nohup cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL" >>"$DIR/demo-tunnel.log" 2>&1 &
      echo $! >"$DIR/demo-tunnel.pid"
      echo "tunnel started: https://$HOSTNAME_DEMO"
    fi
    ;;
  status)
    pid_alive "$DIR/demo-server.pid" && echo "service: running" || echo "service: stopped"
    pid_alive "$DIR/demo-tunnel.pid" && echo "tunnel: running → https://$HOSTNAME_DEMO" || echo "tunnel: stopped"
    ;;
  invite)
    (cd "$ROOT/apps/diary-server" && server_env bun src/cli.ts invite)
    ;;
  stop)
    for name in demo-tunnel demo-server; do
      if pid_alive "$DIR/$name.pid"; then kill "$(cat "$DIR/$name.pid")"; fi
      rm -f "$DIR/$name.pid"
    done
    echo "stopped"
    ;;
  *)
    echo "usage: $0 start|status|invite|stop" >&2
    exit 1
    ;;
esac
