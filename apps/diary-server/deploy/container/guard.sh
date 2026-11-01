#!/bin/sh
# Egress guard of the diary stack (compose.yaml, service `guard`). Runs in the host's network
# namespace (on macOS: OrbStack's Linux VM) and keeps two rules in Docker's firewall:
#   FORWARD (DOCKER-USER): the stack's network may reach only itself and the public internet —
#     no private, link-local, carrier-grade NAT or OrbStack-internal addresses (the home LAN, the Mac,
#     cameras, the router);
#   INPUT: no new connections from the stack's network to the host itself.
# Replies to incoming connections (patients → Caddy) stay allowed. Re-applied every 30 s, because a
# Docker restart may rebuild its chains. `guard.sh check` exits 0 only when both rules are in place.
set -eu

SUBNET="${DIARY_SUBNET:?DIARY_SUBNET is required}"
CHAIN=DIARY-EGRESS
BLOCKED="0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4"

# Docker's rules live in one of the two iptables backends: use the one that has DOCKER-USER.
IPT=
for candidate in iptables-nft iptables-legacy; do
  if "$candidate" -w -n -L DOCKER-USER >/dev/null 2>&1; then
    IPT=$candidate
    break
  fi
done
[ -n "$IPT" ] || {
  echo "guard: no DOCKER-USER chain in either iptables backend" >&2
  exit 1
}

hooked() {
  $IPT -w -C DOCKER-USER -s "$SUBNET" -j "$CHAIN" 2>/dev/null &&
    $IPT -w -C INPUT -s "$SUBNET" -m conntrack --ctstate NEW -j DROP 2>/dev/null
}

apply() {
  $IPT -w -N "$CHAIN" 2>/dev/null || true
  $IPT -w -F "$CHAIN"
  $IPT -w -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  $IPT -w -A "$CHAIN" -d "$SUBNET" -j RETURN
  for net in $BLOCKED; do
    $IPT -w -A "$CHAIN" -d "$net" -j DROP
  done
  $IPT -w -C DOCKER-USER -s "$SUBNET" -j "$CHAIN" 2>/dev/null ||
    $IPT -w -I DOCKER-USER 1 -s "$SUBNET" -j "$CHAIN"
  $IPT -w -C INPUT -s "$SUBNET" -m conntrack --ctstate NEW -j DROP 2>/dev/null ||
    $IPT -w -I INPUT 1 -s "$SUBNET" -m conntrack --ctstate NEW -j DROP
}

case "${1:-run}" in
  check)
    hooked && [ "$($IPT -w -S "$CHAIN" | grep -c -- '-j DROP')" -ge 10 ]
    ;;
  run)
    echo "guard: $SUBNET via $IPT"
    while :; do
      if ! hooked; then
        apply
        echo "guard: rules applied"
      fi
      sleep 30
    done
    ;;
  *)
    echo "usage: guard.sh [run|check]" >&2
    exit 1
    ;;
esac
