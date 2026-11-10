#!/usr/bin/env bash
# Day-to-day checks of the serverless diary (docs/DIARY_ADMIN.md, ADR-0027).
#
#   scripts/diary-admin.sh status   # health, active revision, certificate
#   scripts/diary-admin.sh logs     # the container's log of the last 30 minutes (no patient data is logged)
#
# Deploys go through scripts/diary-serverless-deploy.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/apps/diary-server/deploy/serverless/yandex.env"
# Personal values (the owner's e-mail), ignored by git: yandex.local.env.example.
# shellcheck source=/dev/null
[[ -f "$ROOT/apps/diary-server/deploy/serverless/yandex.local.env" ]] && source "$ROOT/apps/diary-server/deploy/serverless/yandex.local.env"
API="${DIARY_API:-https://med.1damer.com}"

case "${1:-status}" in
  status)
    curl -fsS "$API/api/health" && echo
    yc serverless container revision list --folder-id "$YC_FOLDER" --container-name "$YC_CONTAINER" \
      --limit 1 --format json |
      bun -e 'Bun.stdin.text().then((text) => { const [r] = JSON.parse(text); console.log(`revision ${r.id} ${r.status} ${r.image.image_url.split("/").pop()} since ${r.created_at}`); })'
    yc certificate-manager certificate get med-1damer-com --folder-id "$YC_FOLDER" --format json |
      bun -e 'Bun.stdin.text().then((text) => { const c = JSON.parse(text); console.log(`certificate ${c.status} until ${c.not_after ?? "?"}`); })'
    ;;
  logs)
    yc logging read --folder-id "$YC_FOLDER" --resource-ids "$YC_CONTAINER_ID" --since 30m --limit 200
    ;;
  *)
    echo "usage: $0 status|logs" >&2
    exit 1
    ;;
esac
