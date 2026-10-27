#!/usr/bin/env bash
# Deploy the connected diary to its VM (docs/DIARY_SERVICE.md «Pilot production»).
#
#   scripts/diary-deploy.sh <ssh-host>      # e.g. yc-user@<VM address>
#
# Builds the app, bundles the service into one file (bun build --target=bun: zod and the crypto
# package inside, bun:sqlite from the runtime), copies both, installs the systemd unit and the
# Caddyfile on the first run, and restarts the service. The database on the VM is never touched.
# SKIP_BUILD=1 reuses apps/app/dist.
set -euo pipefail

HOST="${1:?usage: scripts/diary-deploy.sh <ssh-host>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
if [[ "${SKIP_BUILD:-}" != "1" ]]; then bun run build:app; fi
bun build apps/diary-server/src/main.ts --target=bun --outfile "$STAGE/diary-server.js"
bun build apps/diary-server/src/cli.ts --target=bun --outfile "$STAGE/diary-cli.js"

rsync -az --delete apps/app/dist/ "$HOST:/tmp/minimed-app/"
rsync -az "$STAGE/diary-server.js" "$STAGE/diary-cli.js" apps/diary-server/deploy/minimed-diary.service \
  apps/diary-server/deploy/minimed-diary-backup.service apps/diary-server/deploy/minimed-diary-backup.timer \
  apps/diary-server/deploy/Caddyfile "$HOST:/tmp/"

ssh "$HOST" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
rsync -a --delete /tmp/minimed-app/ /opt/minimed/app/
install -m 0644 /tmp/diary-server.js /opt/minimed/diary-server.js
install -m 0644 /tmp/diary-cli.js /opt/minimed/diary-cli.js
changed=0
for unit in minimed-diary.service minimed-diary-backup.service minimed-diary-backup.timer; do
  if ! cmp -s "/tmp/$unit" "/etc/systemd/system/$unit"; then
    install -m 0644 "/tmp/$unit" "/etc/systemd/system/$unit"
    changed=1
  fi
done
if [[ $changed == 1 ]]; then
  systemctl daemon-reload
  systemctl enable minimed-diary
  systemctl enable --now minimed-diary-backup.timer
fi
if ! cmp -s /tmp/Caddyfile /etc/caddy/Caddyfile; then
  install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
  systemctl reload caddy
fi
systemctl restart minimed-diary
# The first start generates the service's keys: give it up to 15 s.
for _ in $(seq 1 15); do
  if curl -fs http://127.0.0.1:8790/api/health; then echo; exit 0; fi
  sleep 1
done
journalctl -u minimed-diary -n 20 --no-pager
exit 1
REMOTE
echo "deployed to $HOST"
