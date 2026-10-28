#!/usr/bin/env bash
# MiniMed connected diary — installer for a faculty server (docs/DIARY_SELFHOST.md).
#
# Run as root from the extracted self-host package:
#
#   sudo ./install.sh --domain med.example.ru [--email admin@example.ru] [--signup invite|open]
#
# Re-running it with a newer package updates the service; the previous release is kept for
# `sudo minimed-diary rollback`. Settings given once are remembered in /etc/minimed-diary/install.conf.
#
#   install.sh [--domain D] [--email E] [--signup invite|open] [--no-caddy]   install or update
#   install.sh --rollback                                                     back to the previous release
#   install.sh invite                                                         a one-time sign-up code for a doctor
#   install.sh status                                                         service, certificate, backup, disk
#
# After the first install the same commands are available as `sudo minimed-diary <command>`.
# Supported: Ubuntu 22.04 / 24.04 and Debian 12 (amd64 or arm64) with systemd.
set -euo pipefail
umask 022

PREFIX=/opt/minimed-diary
DATA=/var/lib/minimed-diary
CONF_DIR=/etc/minimed-diary
CONF="$CONF_DIR/install.conf"
BUN=/usr/local/bin/bun
PORT=8790
HEALTH="http://127.0.0.1:$PORT/api/health"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

need_root() { [[ $EUID -eq 0 ]] || die "run as root: sudo $0 $*"; }

# ---------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------
MODE=install
DOMAIN=''
EMAIL=''
SIGNUP=''
NO_CADDY=''
ARGS=("$@")
while (($#)); do
  case "$1" in
    invite | status) MODE=$1 ;;
    --rollback | rollback) MODE=rollback ;;
    --domain)
      DOMAIN=${2:?--domain needs a value}
      shift
      ;;
    --domain=*) DOMAIN=${1#*=} ;;
    --email)
      EMAIL=${2:?--email needs a value}
      shift
      ;;
    --email=*) EMAIL=${1#*=} ;;
    --signup)
      SIGNUP=${2:?--signup needs invite or open}
      shift
      ;;
    --signup=*) SIGNUP=${1#*=} ;;
    --no-caddy) NO_CADDY=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

# ---------------------------------------------------------------------------------------------
# Small commands that work on an installed service
# ---------------------------------------------------------------------------------------------
current_release() { readlink -f "$PREFIX/current" 2>/dev/null || true; }

wait_health() { # wait_health <url> <seconds> [curl options]
  local url=$1 seconds=$2 i
  shift 2
  for ((i = 0; i < seconds; i++)); do
    if curl -fsS --max-time 5 "$@" "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

cmd_invite() {
  need_root "${ARGS[@]}"
  [[ -d $PREFIX/current/apps/diary-server ]] || die "the service is not installed"
  # Bun 1.2.3 drops the environment when started in a directory its user cannot read: cd first.
  cd "$PREFIX/current/apps/diary-server"
  runuser -u minimed -- env "DIARY_DB=$DATA/diary.db" "$BUN" src/cli.ts invite
}

cmd_status() {
  local cur
  cur=$(current_release)
  echo "release:  $([[ -n $cur ]] && basename "$cur" || echo none)"
  printf 'services: '
  systemctl is-active minimed-diary caddy minimed-diary-backup.timer 2>/dev/null | paste -sd' ' -
  printf 'health:   '
  curl -fsS --max-time 5 "$HEALTH" 2>/dev/null || printf 'no answer'
  echo
  if [[ -r $CONF ]]; then
    # shellcheck disable=SC1090
    (
      . "$CONF"
      echo "domain:   ${DOMAIN:-none} (sign-up: ${SIGNUP:-invite})"
    )
  fi
  printf 'newest backup: '
  # shellcheck disable=SC2012
  ls -1t "$DATA"/backups/diary-*.db 2>/dev/null | head -1 || true
  echo
  df -h "$DATA" | tail -1
}

cmd_rollback() {
  need_root "${ARGS[@]}"
  [[ -L $PREFIX/previous && -d $PREFIX/previous ]] || die "no previous release to go back to"
  local cur prev
  cur=$(current_release)
  prev=$(readlink -f "$PREFIX/previous")
  say "switching $(basename "$cur") -> $(basename "$prev")"
  switch_release "$prev" "$cur"
  systemctl restart minimed-diary
  if wait_health "$HEALTH" 30; then
    say "rolled back to $(basename "$prev"); running 'rollback' again returns to $(basename "$cur")"
    warn "database changes are not reverted. If the older release refuses to start on the newer database, restore a copy from $DATA/backups (docs/DIARY_SELFHOST.md)."
  else
    journalctl -u minimed-diary -n 30 --no-pager || true
    die "the service does not answer after the rollback"
  fi
}

# switch_release <new-target> [<old-target>]: atomically point `current` at <new-target> and keep
# <old-target> as `previous`.
switch_release() {
  local new=$1 old=${2:-}
  if [[ -n $old && $old != "$new" ]]; then
    ln -sfn "$old" "$PREFIX/previous.new"
    mv -T "$PREFIX/previous.new" "$PREFIX/previous"
  fi
  ln -sfn "$new" "$PREFIX/current.new"
  mv -T "$PREFIX/current.new" "$PREFIX/current"
}

case "$MODE" in
  invite)
    cmd_invite
    exit 0
    ;;
  status)
    cmd_status
    exit 0
    ;;
  rollback)
    cmd_rollback
    exit 0
    ;;
esac

# ---------------------------------------------------------------------------------------------
# Install or update
# ---------------------------------------------------------------------------------------------
need_root "${ARGS[@]}"
[[ -f $HERE/VERSION && -f $HERE/BUN_VERSION && -f $HERE/apps/diary-server/src/main.ts && -d $HERE/app ]] ||
  die "run install.sh from the extracted self-host package (diary-selfhost-<version>/), not from $HERE"
VERSION=$(<"$HERE/VERSION")
BUN_VERSION=$(<"$HERE/BUN_VERSION")
[[ $VERSION =~ ^[A-Za-z0-9._-]+$ ]] || die "bad package version: $VERSION"

# Operating system.
[[ -r /etc/os-release ]] || die "no /etc/os-release: unsupported system"
# shellcheck disable=SC1091
OS_ID=$(. /etc/os-release && echo "${ID:-}")
# shellcheck disable=SC1091
OS_VERSION=$(. /etc/os-release && echo "${VERSION_ID:-}")
case "$OS_ID:$OS_VERSION" in
  ubuntu:22.04 | ubuntu:24.04 | debian:12) ;;
  ubuntu:* | debian:*) warn "$OS_ID $OS_VERSION is not tested (Ubuntu 22.04/24.04, Debian 12); continuing" ;;
  *) die "unsupported system '$OS_ID': Ubuntu 22.04/24.04 or Debian 12 is required" ;;
esac
command -v apt-get >/dev/null || die "apt-get not found"
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || die "systemd is required"

# Settings: flags win, then the remembered ones, then defaults.
SAVED_DOMAIN='' SAVED_EMAIL='' SAVED_SIGNUP='' SAVED_NO_CADDY=''
if [[ -r $CONF ]]; then
  # shellcheck disable=SC1090
  eval "$(
    DOMAIN='' EMAIL='' SIGNUP='' NO_CADDY=''
    . "$CONF"
    printf 'SAVED_DOMAIN=%q SAVED_EMAIL=%q SAVED_SIGNUP=%q SAVED_NO_CADDY=%q' \
      "${DOMAIN:-}" "${EMAIL:-}" "${SIGNUP:-}" "${NO_CADDY:-}"
  )"
fi
DOMAIN=${DOMAIN:-$SAVED_DOMAIN}
EMAIL=${EMAIL:-$SAVED_EMAIL}
SIGNUP=${SIGNUP:-${SAVED_SIGNUP:-invite}}
NO_CADDY=${NO_CADDY:-$SAVED_NO_CADDY}
DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')

[[ $SIGNUP == invite || $SIGNUP == open ]] || die "--signup must be invite or open"
if [[ -z $NO_CADDY ]]; then
  [[ -n $DOMAIN ]] || die "--domain is required (the name whose A record points at this server), e.g. --domain med.example.ru"
fi
if [[ -n $DOMAIN ]]; then
  [[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$ ]] ||
    die "'$DOMAIN' is not a host name (use the ASCII/punycode form, no scheme or path)"
fi
if [[ -n $EMAIL ]]; then
  [[ $EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "'$EMAIL' is not an e-mail address"
fi
PUSH_EMAIL=$EMAIL
if [[ -z $PUSH_EMAIL ]]; then
  PUSH_EMAIL="admin@${DOMAIN:-localhost}"
  warn "no --email: push services will get mailto:$PUSH_EMAIL as the contact. Pass --email with a real address."
fi

# Packages.
say "system packages"
need_pkgs=()
for pkg in ca-certificates curl gnupg unzip sqlite3 util-linux; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need_pkgs+=("$pkg")
done
if ((${#need_pkgs[@]})); then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "${need_pkgs[@]}"
fi

# Bun, the version this package was built and tested with (checksum pinned in the package).
install_bun() {
  local have asset sum tmp
  have=$("$BUN" --version 2>/dev/null || true)
  if [[ $have == "$BUN_VERSION" ]]; then
    say "bun $have already installed"
    return
  fi
  case "$(uname -m)" in
    x86_64 | amd64)
      asset=bun-linux-x64
      grep -qw avx2 /proc/cpuinfo || asset=bun-linux-x64-baseline
      ;;
    aarch64 | arm64) asset=bun-linux-aarch64 ;;
    *) die "unsupported CPU: $(uname -m)" ;;
  esac
  say "installing bun $BUN_VERSION ($asset)"
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$asset.zip" \
    "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/$asset.zip" ||
    die "cannot download bun $BUN_VERSION from github.com. Install that exact version as $BUN yourself and run this again."
  sum=$(grep -E "  $asset\.zip\$" "$HERE/bun-linux.sha256" || true)
  [[ -n $sum ]] || die "no checksum for $asset.zip in bun-linux.sha256"
  (cd "$tmp" && printf '%s\n' "$sum" | sha256sum -c --quiet -) || die "bun download does not match the pinned checksum"
  unzip -q -o "$tmp/$asset.zip" -d "$tmp"
  install -m 0755 "$tmp/$asset/bun" "$BUN"
  rm -rf "$tmp"
  [[ $("$BUN" --version) == "$BUN_VERSION" ]] || die "installed bun reports a different version"
}
install_bun

# Caddy from its official apt repository (skipped with --no-caddy or when already installed).
if [[ -z $NO_CADDY ]]; then
  if ! command -v caddy >/dev/null; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '[:.](80|443)$'; then
      die "something already listens on port 80 or 443. Free the ports, or use --no-caddy and proxy to 127.0.0.1:$PORT yourself."
    fi
    say "installing Caddy"
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
    chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
  else
    say "caddy $(caddy version | cut -d' ' -f1) already installed"
  fi
fi

# User and data directory.
if ! id minimed >/dev/null 2>&1; then
  say "creating user minimed"
  useradd --system --user-group --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin minimed
fi
install -d -o minimed -g minimed -m 0750 "$DATA"
install -d -m 0755 "$PREFIX" "$PREFIX/releases" "$CONF_DIR"

# Release.
REL="$PREFIX/releases/$VERSION"
OLD=$(current_release)
if [[ -f $REL/.complete ]]; then
  say "release $VERSION already installed"
else
  say "installing release $VERSION"
  need_kb=$(du -sk "$HERE" | cut -f1)
  free_kb=$(df -Pk "$PREFIX" | awk 'NR == 2 { print $4 }')
  ((free_kb > need_kb + need_kb / 5 + 200000)) ||
    die "not enough free disk space in $PREFIX: the release needs about $((need_kb / 1024)) MB"
  rm -rf "$REL.tmp" "$REL"
  mkdir "$REL.tmp"
  cp -a "$HERE/." "$REL.tmp/"
  chown -R root:root "$REL.tmp"
  chmod -R a+rX "$REL.tmp"
  (cd "$REL.tmp" && "$BUN" install --production --frozen-lockfile) ||
    die "bun install failed. The server needs to reach the npm registry (registry.npmjs.org) once per update."
  touch "$REL.tmp/.complete"
  mv "$REL.tmp" "$REL"
fi

# Settings files.
say "settings"
umask 077
cat >"$CONF.new" <<CONF_EOF
DOMAIN=$(printf '%q' "$DOMAIN")
EMAIL=$(printf '%q' "$EMAIL")
SIGNUP=$(printf '%q' "$SIGNUP")
NO_CADDY=$(printf '%q' "$NO_CADDY")
CONF_EOF
umask 022
chmod 0644 "$CONF.new"
mv "$CONF.new" "$CONF"
cat >"$CONF_DIR/diary.env.new" <<ENV_EOF
# Written by install.sh from install.conf — put your own settings in diary.local.env.
DIARY_SIGNUP=$SIGNUP
DIARY_PUSH_SUBJECT=mailto:$PUSH_EMAIL
ENV_EOF
chmod 0644 "$CONF_DIR/diary.env.new"
mv "$CONF_DIR/diary.env.new" "$CONF_DIR/diary.env"

# systemd units.
units_changed=0
for unit in minimed-diary.service minimed-diary-backup.service minimed-diary-backup.timer; do
  src="$REL/deploy/$unit"
  if ! cmp -s "$src" "/etc/systemd/system/$unit"; then
    install -m 0644 "$src" "/etc/systemd/system/$unit"
    units_changed=1
  fi
done
((units_changed)) && systemctl daemon-reload
systemctl enable minimed-diary >/dev/null 2>&1
systemctl enable --now minimed-diary-backup.timer >/dev/null 2>&1

# Caddy site. A Caddyfile that is neither ours nor the stock one is never overwritten.
CADDY_APPLIED=''
if [[ -z $NO_CADDY ]]; then
  while IFS= read -r line; do
    if [[ $line == __GLOBAL__ ]]; then
      if [[ -n $EMAIL ]]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
    else
      printf '%s\n' "${line//__DOMAIN__/$DOMAIN}"
    fi
  done <"$REL/deploy/Caddyfile.in" >"$CONF_DIR/Caddyfile.new"
  caddy validate --config "$CONF_DIR/Caddyfile.new" --adapter caddyfile >/dev/null 2>&1 ||
    die "the generated Caddyfile does not validate: caddy validate --config $CONF_DIR/Caddyfile.new --adapter caddyfile"
  target=/etc/caddy/Caddyfile
  if [[ ! -s $target ]] || grep -q '^# Managed by minimed-diary' "$target" ||
    grep -q 'Caddy is working\|/usr/share/caddy' "$target"; then
    if [[ -s $target ]] && ! grep -q '^# Managed by minimed-diary' "$target"; then
      cp -a "$target" "$target.pre-minimed"
    fi
    if ! cmp -s "$CONF_DIR/Caddyfile.new" "$target"; then
      install -m 0644 "$CONF_DIR/Caddyfile.new" "$target"
      systemctl enable caddy >/dev/null 2>&1
      systemctl reload-or-restart caddy
    fi
    CADDY_APPLIED=1
  else
    install -m 0644 "$CONF_DIR/Caddyfile.new" /etc/caddy/minimed-diary.caddy
    warn "/etc/caddy/Caddyfile is not ours and was left alone. Add this line to it, then 'systemctl reload caddy':
         import /etc/caddy/minimed-diary.caddy
       (or use only the site block of that file, without its first lines if your Caddyfile has its own global block)"
  fi
  rm -f "$CONF_DIR/Caddyfile.new"
fi

# Copy of the database before an update touches its schema.
if [[ -n $OLD && $OLD != "$REL" && -f $DATA/diary.db ]]; then
  say "database copy before the update"
  stamp=$(date +%Y%m%d-%H%M%S)
  runuser -u minimed -- bash -c "umask 077; mkdir -p '$DATA/backups' && sqlite3 '$DATA/diary.db' \".backup '$DATA/backups/preupdate-$(basename "$OLD")-$stamp.db'\"" ||
    warn "could not copy the database before the update"
  # shellcheck disable=SC2012
  ls -1t "$DATA"/backups/preupdate-*.db 2>/dev/null | tail -n +4 | xargs -r rm --
fi

# Switch and start.
say "starting"
switch_release "$REL" "$OLD"
systemctl restart minimed-diary
if ! wait_health "$HEALTH" 30; then
  journalctl -u minimed-diary -n 30 --no-pager || true
  if [[ -n $OLD && $OLD != "$REL" && -d $OLD ]]; then
    warn "release $VERSION does not start; going back to $(basename "$OLD")"
    switch_release "$OLD" "$REL"
    systemctl restart minimed-diary
    rm -f "$PREFIX/previous"
    wait_health "$HEALTH" 30 && warn "$(basename "$OLD") is running again"
  fi
  die "the service does not answer on $HEALTH"
fi

# Keep the current and the previous release only.
keep_cur=$(basename "$(current_release)")
keep_prev=''
if [[ -L $PREFIX/previous ]]; then keep_prev=$(basename "$(readlink -f "$PREFIX/previous")"); fi
for dir in "$PREFIX"/releases/*/; do
  name=$(basename "$dir")
  [[ $name == "$keep_cur" || $name == "$keep_prev" ]] || rm -rf "${dir%/}"
done
rm -rf "$PREFIX"/releases/*.tmp

install -m 0755 "$REL/install.sh" /usr/local/sbin/minimed-diary

# Public address.
if [[ -n $NO_CADDY ]]; then
  say "service answers on $HEALTH; point your reverse proxy at 127.0.0.1:$PORT"
elif [[ -n $CADDY_APPLIED ]]; then
  say "waiting for https://$DOMAIN/api/health (the first certificate takes up to a minute)"
  if wait_health "https://$DOMAIN/api/health" 120; then
    say "done: https://$DOMAIN/ is up (doctors: https://$DOMAIN/?profile=diaries)"
  else
    warn "https://$DOMAIN/api/health does not answer yet. The service itself runs. Check that the A record of $DOMAIN points at this server, ports 80 and 443 are open, then see: journalctl -u caddy -n 50. Running this command again is safe."
  fi
else
  warn "Caddy is not serving $DOMAIN yet (see the warning above)"
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  warn "ufw is active: make sure ports 80 and 443 are allowed (ufw allow 80,443/tcp)"
fi
say "release $VERSION installed. Sign-up code for a doctor: sudo minimed-diary invite"
