# Connected diary service — running and deploying

The sync server of the connected patient diary ([ADR-0026](adr/0026-connected-diary-service.md),
[DIARY_PLAN.md](DIARY_PLAN.md)). Bun + `bun:sqlite`, one process, serves the built web app and `/api`
from one origin. It stores ciphertext; names, plans and values are decrypted only on the doctors'
and the patient's devices.

## Pieces

| Path | What |
| --- | --- |
| `packages/diary-sync` | Web Crypto: password → auth key + wrap key, identity key pairs, patient data keys per epoch (ECIES wrap), signed AES-GCM records, pairing seal |
| `packages/contracts/src/diary-sync.ts` | zod schemas of every request and response |
| `apps/diary-server` | the service (`src/app.ts` routes, `src/db.ts` numbered migrations, `src/push.ts` VAPID push without payload) |
| `apps/app/src/features/diary/connected` | client: API, sync session, replica, patient connection, doctor account and workspace |
| `apps/app/src/features/diary/dashboard` | the doctor's «Дневники пациентов» (`#/notes/diaries`) |
| `apps/app/src/diary` | the patient's page (pairing link `#c=<patient>.<secret>`, live sync) |

## Local development

```bash
bun run --cwd apps/diary-server dev
```

Starts on `127.0.0.1:8790` with open sign-up and `data/diary-server/dev.db` (gitignored). The app's
Vite dev server proxies `/api` there (`DIARY_SERVER_URL` overrides). Launch configs: `diary-server`
and `diary-dev` in `.claude/launch.json`. Doctors: `#/notes/diaries`; patients open the link of the
QR code. `?profile=diaries` narrows the app to the diaries (no bottom bar), `?profile=off` undoes it.

Tests: `bun run test:diary-server` (whole life of a diary against the real crypto, the database holds
no plaintext), plus the vitest suites under `packages/diary-sync` and `apps/app/src/features/diary`.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `DIARY_HOST` / `DIARY_PORT` | `127.0.0.1` / `8790` | listen address (8787 is taken by OrbStack on the owner's Mac) |
| `DIARY_DB` | `data/diary-server/diary.db` | SQLite file (WAL) |
| `DIARY_STATIC` | — | built app (`apps/app/dist`) to serve next to the API |
| `DIARY_SIGNUP` | `invite` | `open` lets any doctor register; `invite` needs a code from `bun run --cwd apps/diary-server invite` |
| `DIARY_PUSH_SUBJECT` | `mailto:admin@1damer.com` | VAPID contact |
| `DIARY_CORS_ORIGINS` | — | comma-separated origins allowed cross-origin (the Android app, which needs `VITE_DIARY_SERVER` at build time) |

The decoy-salt secret and the VAPID key pair are generated on first start and kept in the database.

## Pilot production (Yandex Cloud, `ru-central1`)

1. Ubuntu 24.04 VM; install Bun (repository-pinned version) and Caddy; user `minimed`;
   `/var/lib/minimed-diary` owned by it.
2. Checkout in `/opt/minimed`, `bun install`, `bun run build:app` with the pilot settings.
3. `apps/diary-server/deploy/minimed-diary.service` → `/etc/systemd/system/`, `systemctl enable --now
   minimed-diary`.
4. `apps/diary-server/deploy/Caddyfile` → `/etc/caddy/Caddyfile`; Caddy gets the certificate.
5. Cloudflare DNS: `A med.1damer.com → VM`, **DNS only** (no proxy — Russian ISPs cut proxied
   connections, and a foreign TLS terminator raises a cross-border question).
6. Backups: nightly `sqlite3 diary.db ".backup …"` to a private Object Storage bucket. Records are
   ciphertext; doctors' e-mails, names and password hashes are not.
7. Invite codes for the faculty's doctors: `bun run --cwd apps/diary-server invite`.

A development tunnel from the owner's Mac (`cloudflared`, e.g. `med-dev.1damer.com` →
`127.0.0.1:8790`) is for demos with test data only; creating it changes the Cloudflare account and is
done on the owner's go.

## Limits (by design)

- The server cannot chart, search or alert by content; the patient's phone raises the urgent signal.
- A doctor who loses both the password and the recovery code loses access unless another curator
  re-invites them.
- Push carries no text; on iPhone it needs the diary on the home screen; phones without Google
  services get changes when the diary is opened (live stream while it is open).
- Formal remote monitoring under order 193н (ЕСИА, the clinic's МИС, УКЭП) is not covered — see the
  legal section of [DIARY_PLAN.md](DIARY_PLAN.md).
