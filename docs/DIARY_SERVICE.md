# Connected diary service — running and deploying

The sync server of the connected patient diary ([ADR-0026](adr/0026-connected-diary-service.md),
[DIARY_PLAN.md](DIARY_PLAN.md)). One HTTP app in two modes ([ADR-0027](adr/0027-diary-server-modes.md)):
`server` — Bun + `bun:sqlite`, one process, a live event stream and reminder pushes, optionally
serving the built web app next to `/api`; `serverless` — the same routes on Node over YDB in a Yandex
Cloud Serverless Container, clients poll a change counter. It stores ciphertext; names, plans and
values are decrypted only on the doctors' and the patient's devices.

## Pieces

| Path | What |
| --- | --- |
| `packages/diary-sync` | Web Crypto: password → auth key + wrap key, identity key pairs, patient data keys per epoch (ECIES wrap), signed AES-GCM records, pairing seal |
| `packages/contracts/src/diary-sync.ts` | zod schemas of every request and response |
| `apps/diary-server` | the service: `src/app.ts` routes over the `src/store.ts` port; `src/sqlite-store.ts` and `src/ydb-store.ts` (numbered migrations each); `src/main.ts` (server mode, Bun), `src/serverless.ts` (Node); `src/push.ts` content-free Web Push; `src/contract.ts` the storage contract both stores pass |
| `apps/diary-server/deploy` | `serverless/` (image, API Gateway spec, Yandex ids), `container/` (self-host stack), `selfhost/` (systemd package); the VM files at the top (`cloud-init.yaml`, units, `Caddyfile`) for `scripts/diary-vm.sh` and `scripts/diary-deploy.sh` |
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
no plaintext; the storage contract over SQLite in both modes), `scripts/diary-ydb-contract.sh` (the
contract on Node over a real YDB test database), plus the vitest suites under `packages/diary-sync`
and `apps/app/src/features/diary`.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `DIARY_MODE` | `server` | `serverless`: `serverless.ts` on Node over YDB, no live stream (clients poll `/api/changes`; `/api/health` says `live: poll`), no reminder pushes |
| `DIARY_YDB` | — | serverless only: YDB connection string; credentials from the environment (`YDB_METADATA_CREDENTIALS=1` in the container) |
| `DIARY_HOST` / `DIARY_PORT` | `127.0.0.1` / `8790` | listen address (8787 is taken by OrbStack on the owner's Mac); a serverless container sets `PORT` |
| `DIARY_DB` | `data/diary-server/diary.db` | SQLite file (WAL) |
| `DIARY_STATIC` | — | built app (`apps/app/dist`) to serve next to the API |
| `DIARY_SIGNUP` | `invite` | `open` lets any doctor register (the pilot since 2026-10-28; at most 12 new accounts a minute); `invite` needs a code from `bun run --cwd apps/diary-server invite`. `GET /api/info` tells the sign-in form, which then hides the code field |
| `DIARY_PUSH_SUBJECT` | `mailto:admin@1damer.com` | VAPID contact |
| `DIARY_TICK_TOKEN` | — | key of `POST /api/tick` (Bearer or `?key=`): sends due reminders and missed-dose notices for a scheduler outside the process — the `serverless` mode's timer trigger; the `server` mode ticks by itself every 20 s and needs it only for an outside scheduler. Unset: no such route |
| `DIARY_CORS_ORIGINS` | — | origins (commas or semicolons) allowed cross-origin: the Pages app and the native shells; any other origin is answered with the first allowed one, so browsers refuse it |
| `DIARY_ADMIN_EMAILS` | — | sign-in e-mails (commas or semicolons, compared case-insensitively) of the service owner(s): they get `admin: true` in `GET /api/auth/me` and may read `GET /api/admin/stats`, the numbers behind «Обзор сервиса». Others get 403; unset: nobody. The view shows only aggregates the server already sees (ADR-0026 §7): counts of doctors, diaries, phones, records and alerts, a weekly series and a per-doctor table — no patient is named and no record is read. It also shows prescriptions and adherence (7 and 30 days), which are not seen by the server but sent by the doctors' apps as anonymous per-doctor totals (`PUT /api/doctor/totals`, one row per doctor, never per patient; ADR-0026 §7) |

The decoy-salt secret and the VAPID key pair are generated on first start and kept in the database.

## Pilot production (serverless, Yandex Cloud `ru-central1`)

Live since 2026-11-01 (2026-10-27 – 11-01 on a VM); management, ids and costs:
[DIARY_ADMIN.md](DIARY_ADMIN.md). `scripts/diary-serverless-deploy.sh` bundles `serverless.ts`,
pushes the image to Container Registry, deploys a revision of the container `diary-api` and updates
the API Gateway `diary` (`apps/diary-server/deploy/serverless/api-gateway.yaml`), which serves
`https://med.1damer.com/api/…` with a Let's Encrypt certificate from Certificate Manager. The pages
are a static copy of the app, published where `DIARY_PAGES_URL` (`yandex.env`) says — since
2026-11-03 GitVerse Pages, `https://t-damer.gitverse.site/minimed/` (opens reliably in Russia;
github.io does not), published by `scripts/diary-gitverse-publish.sh`; the full app on GitHub Pages
keeps working against the same service. On `*.github.io`, `*.gitverse.site` and in the native shells
`diaryServiceBase()` is `https://med.1damer.com`. Every public link goes through the gateway: the QR
link reads `https://med.1damer.com/diary/#c=…`, `/` opens the doctors' app, and the gateway redirects
to `DIARY_PAGES_URL` with the fragment intact, so moving the pages is one variable and
`GATEWAY_ONLY=1 scripts/diary-serverless-deploy.sh`; `DIARY_CORS_ORIGINS` lists both hosts. Two short demo links for slides: `/demo` (the doctor's sign-in on «Демо») and
`/demo/patient` (a guest diary in the shared demo account, on the visitor's device); every visitor signs in to one
public demo account, whose sign-ins are capped at 600 a minute; `GATEWAY_ONLY=1` redeploys only the gateway.
The gateway also answers `/sw.js` with a service worker that retires itself (clears caches,
unregisters, reloads): browsers that installed the app from this domain in the VM days (2026-10-27 –
11-01) were stuck on that version, since nothing here served `/sw.js` for their update check. They land
on the Pages app and need to install it again from there for its own icon and full-screen mode.

Cloudflare DNS stays **DNS only** (no proxy — Russian ISPs cut proxied connections, and a foreign TLS
terminator raises a cross-border question). Data stays in YDB in Russia; the static pages carry none.

A faculty that runs its own server uses the server mode: [DIARY_SELFHOST.md](DIARY_SELFHOST.md)
(container stack or systemd package).

## Demo tunnel (owner's Mac, test data only)

`scripts/diary-demo.sh start` builds the app, starts the service on `127.0.0.1:8792` with
`data/diary-server/demo.db` and invite-only sign-up, and runs the `minimed-dev` cloudflared tunnel
(config `~/.cloudflared/minimed-dev.yml`, tunnel id `430e0d52-af51-4ec5-a7af-5cf7cbb23f96`) to
`https://med-dev.1damer.com`. `status`, `invite` (a doctor's sign-up code) and `stop` do what they
say; logs are next to the database. Nothing is installed as a system service: after a reboot run
`start` again (`SKIP_BUILD=1` reuses the last build).

DNS: `med-dev` CNAME `430e0d52-af51-4ec5-a7af-5cf7cbb23f96.cfargotunnel.com`, proxied — added in the
dashboard on 2026-10-27 (the local `cert.pem` token is refused for DNS changes, Cloudflare error
10000; renew it with `cloudflared tunnel login` only if command-line routing is needed again).

Cloudflare ends TLS for this tunnel, so it is for demos only; Russian networks may also cut proxied
connections. Pilot patients use the VM above.

## Limits (by design)

- The server cannot chart, search or alert by content; the patient's phone raises the urgent signal.
- A doctor who loses both the password and the recovery code loses access unless another curator
  re-invites them.
- Push carries no text: an encrypted payload (RFC 8291) names only the kind of event (`plan`, `tip`,
  `correction`, `reminder`, `alert`, `withdrawn`, `invite`, `missed`, `carer`) and, for a reminder or a
  missed dose, its moment; the
  service workers write the text. Subscriptions saved before 2026-10-28 have no payload keys and
  get an empty push until the app re-sends them (it does so on open). On iPhone push needs the
  diary on the home screen; phones without Google services get changes when the diary is opened.
- Reminders: the patient's phone sends only its next moments (`PUT /api/device/reminders`, 14
  days, at most 400, replaced on every sync, ticked ones left out); the service pushes each once
  within 20 s and drops one it could not send within 20 minutes. What is due, and the medicine
  names (only when the patient switches them on), stay on the phone in Cache Storage; «Принял» in
  an Android notification is queued there and marked when the diary is next open.
- Carers (DIARY25): the doctor adds one with the patient's consent («Кураторы» → «Опекуны»); the carer's
  phone pairs like a patient's and can mark doses, the patient sees and removes carers in «Настройки» →
  «Доступ к дневнику». While a carer is there, the patient's phone sends its dose moments for the next 14
  days (`checks`) and every phone the moments whose doses are all taken (`taken`) with `PUT
  /api/device/reminders`; a moment still open `DIARY_MISSED_AFTER_MS` (30 min) after its time gets one
  content-free `missed` push to the carers (dropped if the service could not send it within 20 more
  minutes). Needs the tick: in `serverless` mode a timer trigger calling `/api/tick` (not set up yet).
  A dose marked in a phone's notification («Принял») reaches the service only when the diary is next open.
- Formal remote monitoring under order 193н (ЕСИА, the clinic's МИС, УКЭП) is not covered — see the
  legal section of [DIARY_PLAN.md](DIARY_PLAN.md).
