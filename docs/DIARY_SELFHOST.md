# Connected diary — self-hosting for a faculty

For a faculty or clinic IT administrator who runs the diary service on their own server, with their
own domain. No access to our cloud account, no SSH from us, no Cloudflare. How the service works:
[DIARY_SERVICE.md](DIARY_SERVICE.md); our pilot server is managed differently
([DIARY_ADMIN.md](DIARY_ADMIN.md)).

The package is one tarball, `diary-selfhost-<version>.tar.gz`, built by the MiniMed developers with
`scripts/diary-selfhost-package.sh` (a `.sha256` file lies next to it; check it with
`sha256sum -c`). It contains the built web app, the service source, the installer and the systemd
and Caddy files. Nothing in it is private: no data, no keys, no accounts.

## What you need

| | |
| --- | --- |
| Server | Ubuntu 22.04 or 24.04, or Debian 12; amd64 or arm64; systemd; root access |
| Size | 1 vCPU, 1 GB RAM, 10 GB disk (each release is about 0.5 GB; the installer keeps two) |
| Network | ports 80 and 443 reachable from the internet (Let's Encrypt and the site); outgoing HTTPS to `github.com` (Bun), `dl.cloudsmith.io` (Caddy's apt repository), the Ubuntu/Debian mirrors and `registry.npmjs.org` (one small library, once per install or update) |
| Domain | a DNS **A record** for the name (for example `med.example.ru`) pointing straight at the server. No CDN or proxy in front: patients' connections must end on your server |

If an outgoing address is blocked, install that piece by hand first: the installer skips Bun when
`/usr/local/bin/bun` already is the pinned version (printed in `BUN_VERSION` in the package) and skips
Caddy when `caddy` is already installed. Bun reads a registry mirror from `~/.bunfig.toml`
([bun.sh/docs/install/registries](https://bun.sh/docs/install/registries)).

## Install

```bash
tar xzf diary-selfhost-<version>.tar.gz
cd diary-selfhost-<version>
sudo ./install.sh --domain med.example.ru --email admin@example.ru
```

- `--domain` is required (unless `--no-caddy`); ASCII or punycode, no `https://`.
- `--email` is the contact for Let's Encrypt and for push services (VAPID). Use a real mailbox.
- `--signup invite` (default) or `--signup open`, see «Sign-up mode».
- `--no-caddy` skips Caddy: the service listens only on `127.0.0.1:8790` and you proxy to it
  yourself. Keep response buffering off for `/api/` (live updates are server-sent events) and
  allow long-lived connections.

The installer, step by step: installs `sqlite3`, the pinned Bun (checksum-verified) and Caddy from its
official apt repository; creates the `minimed` system user and `/var/lib/minimed-diary`; copies the
release to `/opt/minimed-diary/releases/<version>`, runs `bun install --production` there and points
`/opt/minimed-diary/current` at it; writes `/etc/minimed-diary/` (settings), the systemd service, the
nightly backup timer and `/etc/caddy/Caddyfile`; starts everything and waits for
`https://<domain>/api/health`. The first certificate takes up to a minute. If that URL does not
answer in two minutes the service is still running; check the A record and ports 80/443, then run
the same command again (it is safe to repeat).

Caddy's `/etc/caddy/Caddyfile` is replaced only when it is the stock one or ours. A Caddyfile with
your own sites is left alone: the installer writes `/etc/caddy/minimed-diary.caddy` and tells you to
add `import /etc/caddy/minimed-diary.caddy`. A firewall (`ufw`, cloud security groups) is not changed:
open 80 and 443 yourself.

Then open `https://<domain>/?profile=diaries` (doctors). Patients open the link or QR code a doctor
shows them.

## Everyday commands

```bash
sudo minimed-diary invite      # a one-time sign-up code for a doctor
sudo minimed-diary status      # release, services, health, newest backup, disk
sudo minimed-diary rollback    # back to the previous release
journalctl -u minimed-diary    # service log
journalctl -u caddy            # certificate and proxy log
```

(`minimed-diary` is the installer, copied to `/usr/local/sbin`.) The service log holds routes,
status codes and times, never patient data; Caddy logs paths without query strings and without
authorization headers.

## Sign-up mode

- `invite` — a doctor can create an account only with a code from `minimed-diary invite`. Send the
  code with the link; each code works once.
- `open` — anyone who reaches the address can register as a doctor. Use it only on a network you
  trust, or briefly.

Change the mode by running the installer again with `--signup open` or `--signup invite`; the other
settings are remembered in `/etc/minimed-diary/install.conf`. Extra settings for the service (for
example `DIARY_CORS_ORIGINS` for the Android app) go into `/etc/minimed-diary/diary.local.env`,
which the installer never overwrites; then `sudo systemctl restart minimed-diary`. The list of
settings is in [DIARY_SERVICE.md](DIARY_SERVICE.md).

## Update and rollback

Extract the newer package and run the installer again; the domain, e-mail and sign-up mode are taken
from the previous run:

```bash
tar xzf diary-selfhost-<newer>.tar.gz && cd diary-selfhost-<newer> && sudo ./install.sh
```

It copies the database to `/var/lib/minimed-diary/backups/preupdate-*.db` (the last three are kept),
installs the new release next to the old one, switches `current`, restarts and checks the health
address. If the new release does not start, the old one is put back automatically. The database
schema is updated by numbered migrations when the service starts.

```bash
sudo minimed-diary rollback    # switch to the previous release; run it again to go forward
```

A rollback does not undo database changes. If an older release refuses to start on a database a
newer one has migrated, stop the service and restore the `preupdate-*.db` copy (below). Records
written after that copy are re-sent by the phones on their next sync.

## Backups and restore

A timer copies the database every night at 03:30 (server time) with SQLite's online `.backup` to
`/var/lib/minimed-diary/backups/diary-YYYY-MM-DD.db`; the 14 newest stay. The copies are readable only
by the `minimed` user. They are on the same disk as the database, so also copy them somewhere else
(another server, your backup system):

```bash
sudo systemctl start minimed-diary-backup.service        # a copy right now
sudo cp /var/lib/minimed-diary/backups/diary-YYYY-MM-DD.db /safe/place/
```

Restore (replaces the live database):

```bash
sudo systemctl stop minimed-diary
sudo install -o minimed -g minimed -m 0600 /safe/place/diary-YYYY-MM-DD.db /var/lib/minimed-diary/diary.db
sudo rm -f /var/lib/minimed-diary/diary.db-wal /var/lib/minimed-diary/diary.db-shm
sudo systemctl start minimed-diary
```

Everything written after that backup is lost on the server; phones that still hold newer records send
them again on their next sync.

**The database also holds the service's own keys:** the VAPID key pair for web push and a secret for
the decoy login salts. A backup without them is not a full backup. If they are lost (a new empty
database), the service creates new ones, and every patient and doctor has to switch notifications
off and on again; existing accounts and records are not affected by the push keys alone.

## What the server stores

- Diary records, plans and tips are **ciphertext**, and so are the keys that open them. They are
  opened only on the doctors' and the patient's devices; the server cannot read, search or chart
  them, and an administrator with full access to the disk cannot either.
- **Plain** in the database: doctors' e-mail addresses and names, password verifiers (hashes, not
  passwords), invite codes, push subscriptions, alert kinds and times, record and device timestamps,
  the times of dose reminders, and which doctors curate which patient. Treat the database file and
  its backups as personal data.
- A doctor who loses both the password and the recovery code cannot open their keys; another curator
  of the patient can invite them again under a new account.
- No telemetry leaves the server. It makes outgoing connections only to the push services that the
  browsers' own subscriptions name.

## Where things are

| Path | What |
| --- | --- |
| `/opt/minimed-diary/current` → `releases/<version>` | the active release (app in `app/`, service in `apps/diary-server/`) |
| `/opt/minimed-diary/previous` | the release `rollback` returns to |
| `/var/lib/minimed-diary/diary.db` | the database (SQLite, WAL) |
| `/var/lib/minimed-diary/backups/` | nightly and pre-update copies |
| `/etc/minimed-diary/` | `install.conf`, `diary.env` (written by the installer), `diary.local.env` (yours) |
| `/etc/systemd/system/minimed-diary*.service`, `minimed-diary-backup.timer` | the units |
| `/etc/caddy/Caddyfile` | the site |

## Not covered

The Android app talks to a server fixed at its build time, so the package serves the web app (doctors
in a browser, patients through the pairing link, both installable to the home screen). Formal remote
monitoring under order 193н (ЕСИА, the clinic's МИС) is a separate route; see the legal section of
[DIARY_PLAN.md](DIARY_PLAN.md).

## For the MiniMed developers

`scripts/diary-selfhost-package.sh` builds the app (`bun run build:app`, sanitized environment, like
`scripts/diary-deploy.sh`), packs it with the sources of `apps/diary-server`, `packages/contracts` and
`packages/diary-sync`, a minimal root `package.json` and `bun.lock` (the pinned Bun version comes from
the root `packageManager`), and the files from `apps/diary-server/deploy/selfhost/`; the installer is
`apps/diary-server/deploy/selfhost/install.sh`. The output is `output/diary-selfhost-<version>.tar.gz`
(gitignored; delete it after sending it). `SKIP_BUILD=1` reuses `apps/app/dist`. The optional
companion databases above 32 MiB (medications, mkb, ambulatory) are left out, as in the release builds.
Vite reads developer-local env files (`apps/app/.env.local`) into any build: the script warns when
they exist — build from a clean checkout for a package that leaves the house.
