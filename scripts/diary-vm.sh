#!/usr/bin/env bash
# Creates the Yandex Cloud VM of the connected diary (costs money: run only on the owner's go).
#
#   scripts/diary-vm.sh create     # VM + static address in ru-central1, cloud-init from the repo
#   scripts/diary-vm.sh address    # the public address (for the med.1damer.com A record)
#
# Defaults: 2 vCPU at 20 %, 2 GB RAM, 20 GB network HDD, Ubuntu 24.04, your SSH key. Then:
# DNS «A med.1damer.com → address» (DNS only), and scripts/diary-deploy.sh yc-user@<address>.
set -euo pipefail

NAME="${DIARY_VM_NAME:-minimed-diary}"
ZONE="${DIARY_VM_ZONE:-ru-central1-a}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${DIARY_VM_SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"

case "${1:-}" in
  create)
    # The folder had no network on 2026-10-27: create one with a subnet in the zone when missing.
    if ! yc vpc network get "$NAME-net" >/dev/null 2>&1; then
      yc vpc network create --name "$NAME-net"
    fi
    if ! yc vpc subnet get "$NAME-$ZONE" >/dev/null 2>&1; then
      yc vpc subnet create --name "$NAME-$ZONE" --network-name "$NAME-net" --zone "$ZONE" \
        --range 10.130.0.0/24
    fi
    if ! yc vpc address get "$NAME-ip" >/dev/null 2>&1; then
      yc vpc address create --name "$NAME-ip" --external-ipv4 zone="$ZONE"
    fi
    # yc refuses --ssh-key together with user-data: the key goes into the cloud-init file.
    USER_DATA="$(mktemp)"
    trap 'rm -f "$USER_DATA"' EXIT
    python3 - "$ROOT/apps/diary-server/deploy/cloud-init.yaml" "$KEY" "$USER_DATA" <<'PY'
import sys
template, key, out = sys.argv[1:]
text = open(template, encoding="utf-8").read()
open(out, "w", encoding="utf-8").write(text.replace("__SSH_PUBLIC_KEY__", open(key).read().strip()))
PY
    yc compute instance create \
      --name "$NAME" \
      --zone "$ZONE" \
      --platform standard-v3 \
      --cores 2 --core-fraction 20 --memory 2 \
      --create-boot-disk image-folder-id=standard-images,image-family=ubuntu-2404-lts,size=20,type=network-hdd \
      --network-interface subnet-name="$NAME-$ZONE",nat-address="$(yc vpc address get "$NAME-ip" --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["external_ipv4_address"]["address"])')" \
      --metadata-from-file user-data="$USER_DATA"
    ;;
  address)
    yc vpc address get "$NAME-ip" --format json |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["external_ipv4_address"]["address"])'
    ;;
  *)
    echo "usage: $0 create|address" >&2
    exit 1
    ;;
esac
