#!/usr/bin/env bash
# Day-to-day management of the diary server (docs/DIARY_ADMIN.md).
#
#   scripts/diary-admin.sh invite      # one-time sign-up code for a doctor
#   scripts/diary-admin.sh status      # service, Caddy, certificate, disk, last backup
#   scripts/diary-admin.sh logs        # last 100 lines of the service log (no patient data is logged)
#   scripts/diary-admin.sh backup      # copy the newest backup to data/diary-server/backups/ on this Mac
#   scripts/diary-admin.sh restart
#
# DIARY_HOST overrides the server (default yc-user@51.250.93.197).
set -euo pipefail

HOST="${DIARY_HOST:-yc-user@51.250.93.197}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_ENV="DIARY_DB=/var/lib/minimed-diary/diary.db"

case "${1:-status}" in
  invite)
    # Bun 1.2.3 drops the environment when started in a directory its user cannot read: cd first.
    ssh "$HOST" "cd /opt/minimed && sudo -u minimed env $DB_ENV /usr/local/bin/bun /opt/minimed/diary-cli.js invite"
    ;;
  status)
    ssh "$HOST" 'systemctl is-active minimed-diary caddy minimed-diary-backup.timer | paste -sd " " -;
      curl -fsS http://127.0.0.1:8790/api/health && echo;
      df -h / | tail -1;
      ls -1t /var/lib/minimed-diary/backups 2>/dev/null | head -1 || echo "no backup yet";
      sudo journalctl -u caddy --since "-1h" --no-pager | grep -o "certificate obtained successfully" | tail -1 || true'
    ;;
  logs)
    ssh "$HOST" 'sudo journalctl -u minimed-diary -n 100 --no-pager'
    ;;
  backup)
    mkdir -p "$ROOT/data/diary-server/backups"
    latest="$(ssh "$HOST" 'ls -1t /var/lib/minimed-diary/backups/diary-*.db 2>/dev/null | head -1')"
    if [[ -z "$latest" ]]; then
      ssh "$HOST" 'sudo systemctl start minimed-diary-backup.service'
      latest="$(ssh "$HOST" 'ls -1t /var/lib/minimed-diary/backups/diary-*.db | head -1')"
    fi
    ssh "$HOST" "sudo cat '$latest'" >"$ROOT/data/diary-server/backups/$(basename "$latest")"
    echo "saved data/diary-server/backups/$(basename "$latest")"
    ;;
  restart)
    ssh "$HOST" 'sudo systemctl restart minimed-diary && sleep 3 && curl -fsS http://127.0.0.1:8790/api/health && echo'
    ;;
  *)
    echo "usage: $0 invite|status|logs|backup|restart" >&2
    exit 1
    ;;
esac
