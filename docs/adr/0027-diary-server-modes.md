# ADR-0027: Two run modes of the diary service — server and serverless

- Status: accepted (owner, 2026-11-01: «на Yandex нужен только сервер, очень маленький»; «нужен
  глобальный переключатель», чтобы вернуться к обычному серверу); implemented in DIARY16.
- Decision: project owner, 2026-10-31 – 2026-11-01 (the VM cost ≈ 1 500 ₽/month for a pilot without
  real patients yet).
- Amends: [ADR-0026](0026-connected-diary-service.md) decision 2 (stack) and 8 (hosting). Everything
  else of ADR-0026 — end-to-end encryption, what the server sees, alerts, logging — is unchanged.
- Related: [DIARY_SERVICE.md](../DIARY_SERVICE.md), [DIARY_ADMIN.md](../DIARY_ADMIN.md),
  [DIARY_SELFHOST.md](../DIARY_SELFHOST.md).

## Context

The diary service ran on a Yandex Cloud VM that sat idle (load 0.00, ≈ 400 MB of 2 GB). Its traffic is
tiny (5–600 API requests a day), well inside Yandex Cloud's monthly free tier for serverless
services (1 M container calls, 100 k API Gateway requests, 1 M YDB request units, 1 GB of YDB data).
The static app needs no server at all: GitHub Pages already serves it. A faculty may still want to
run the service on its own machine, so the long-running server must stay.

## Decision

1. **One switch.** `DIARY_MODE=server|serverless` chooses the mode of the same HTTP app
   (`apps/diary-server/src/app.ts`). Clients need no setting of their own: `GET /api/health` answers
   `live: 'sse' | 'poll'`, and the client opens the live stream or polls accordingly.
2. **Storage port.** The app talks only to `DiaryStore` (`store.ts`): `SqliteStore` (bun:sqlite,
   WAL, numbered migrations) for `server`, `YdbStore` (YDB Query service, numbered migrations, one
   serializable transaction per multi-row step) for `serverless`. One contract
   (`contract.ts`) runs over both: SQLite in `bun test`, YDB on Node via
   `scripts/diary-ydb-contract.sh`.
3. **Runtimes.** `server` runs on Bun (`main.ts`). `serverless` runs on Node (`serverless.ts`,
   bundled by `bun build --target=node`) because Bun 1.2.3's HTTP/2 client stalls on YDB's
   streaming gRPC calls. Passwords go through a `Passwords` port: `Bun.password` or Node's
   `crypto.argon2`, both writing the same argon2id PHC strings, so accounts survive a change of mode.
4. **Live updates.** `server`: server-sent events as before. `serverless`: where the server would
   send an event it bumps a per-recipient change counter; clients poll `GET /api/changes` (one point
   read) and re-read the data only when it moved. Presence is read from the summary. Pushes are
   awaited before the response (an instance may be frozen after it).
5. **Reminders.** `server` keeps its reminder tick. `serverless` has none: reminders stay on the
   phone for now (owner, 2026-11-01).
6. **Hosting of the serverless mode.** One Yandex Cloud Serverless Container (`ru-central1`, no
   provisioned instances, its service account reaching YDB through the metadata service), behind an
   API Gateway with the domain `api.med.1damer.com` and a Let's Encrypt certificate from Certificate
   Manager; YDB serverless in a folder of its own. The patient page and the app are static files on
   GitHub Pages; `VITE_DIARY_SERVER` points them at the API, which allows their origins by CORS.
   Data stays in Russia (152-ФЗ ст. 18 ч. 5); the static pages carry no personal data.
7. **Self-hosting.** The `server` mode ships as a container stack (`apps/diary-server/deploy/container`:
   the service, a nightly backup job, Caddy and an egress guard that keeps the stack off the host's
   LAN) and as the systemd package of DIARY_SELFHOST.md. Docker is allowed for this deployment
   artefact only; development, tests and the app stay Docker-free.
8. **New dependency.** `@ydbjs/core`, `@ydbjs/query`, `@ydbjs/auth`, `@ydbjs/value` (pinned), used
   only by `ydb-store.ts` and `serverless.ts`.

## Alternatives rejected

- **A smaller VM** (≈ 800 ₽/month): still paid, still an idle machine to patch.
- **The owner's laptop or a Raspberry Pi at home**: opens ports of a home network with cameras and a
  2013 router to the internet; the service goes down with the laptop.
- **SQLite in Object Storage behind a single container instance**: the smallest code change, but a
  lost write between commit and upload or two instances during a deploy would corrupt medical data.
- **Cloud Functions on Node**: the same rewrite of the storage as YDB plus a new handler shape; a
  container keeps the existing HTTP app.
- **YDB's Document API (DynamoDB-compatible)**: avoids gRPC, but the relational queries and
  multi-row transactions would become key-value code.
