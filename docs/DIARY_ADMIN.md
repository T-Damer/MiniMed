# Diary server — management

The connected diary's API runs serverless in Yandex Cloud (since 2026-11-01, ADR-0027; before that a
VM, see «History»); the pages are the published app on GitHub Pages. Everything below is run from
the repository on the owner's Mac with the `yc` CLI signed in. How the service works:
[DIARY_SERVICE.md](DIARY_SERVICE.md); running it on your own machine instead:
[DIARY_SELFHOST.md](DIARY_SELFHOST.md).

| | |
| --- | --- |
| Pages | doctors `https://t-damer.github.io/MiniMed/app/?profile=diaries`, patients `…/app/diary/` (GitHub Pages, built from `main`) |
| API | `https://med.1damer.com/api/…` — the bare domain and `/diary` redirect to the pages, so short links keep working |
| Folder | Yandex Cloud `minimed-diary` (`b1ginjm6vtsvrqgd96qq`); every id is in `apps/diary-server/deploy/serverless/yandex.env` |
| Gateway | API Gateway `diary` (`d5dodf2e18bku1g3s8e0`), domain `med.1damer.com`, Let's Encrypt certificate `med-1damer-com` from Certificate Manager (renews itself through the `_acme-challenge` CNAME) |
| Container | Serverless Container `diary-api`: Node 24, 512 MB, 1 core at 50 %, 4 requests per instance, no instance kept warm; image in Container Registry `minimed-diary` (three newest kept) |
| Data | YDB serverless `diary` — ciphertext of the diaries plus doctors' e-mails, names and password hashes; YDB keeps automatic backups of the last two days |
| Accounts | `diary-api` runs the container (`ydb.editor`, `container-registry.images.puller`); `diary-gateway` only calls it (`serverless-containers.containerInvoker`) |
| DNS | Cloudflare, **DNS only**: `CNAME med → d5dodf2e18bku1g3s8e0.s183zexc.apigw.yandexcloud.net`, `CNAME _acme-challenge.med → fpqi1ppd31pp6hfrp2h4.cm.yandexcloud.net` |
| Mode | `DIARY_MODE=serverless`: no live stream (clients poll `/api/changes` every 20 s), no reminder pushes (reminders stay on the phone) |

## Everyday commands

```bash
scripts/diary-admin.sh status    # health, active revision, certificate
scripts/diary-admin.sh logs      # last 30 minutes: routes, status codes, times — never patient data
scripts/diary-serverless-deploy.sh   # bundle, image, new revision, gateway spec
scripts/diary-gitverse-publish.sh    # build the diaries copy, publish it to GitVerse
```

The pages live on GitVerse Pages, repository `t_damer/minimed` (public; Settings → Страницы → source
«Воркфлоу»). Only the diaries go there, never the MiniMed reference app: the script builds the app
with `VITE_APP_PROFILE=diaries` into a temporary folder (`apps/app/dist` stays the full app), so the
copy always opens as the doctors' «Дневники» — any address, `?profile=off` included — next to the
patient page `diary/`. It pushes one commit to the `pages` branch: that build without content packs
(≈125 MB of the 500 MB limit) in `site/` and the workflow that publishes it; the deploy takes about
five minutes (`api.gitverse.ru/repos/t_damer/minimed/actions/runs`, token `GITVERSE_TOKEN` in `.env`).
GitVerse answers a directory address with a query (`/minimed/?profile=diaries`) with its not-found
page, so links with a query name `index.html`. To move the pages elsewhere, change `DIARY_PAGES_URL`
and `DIARY_CORS_ORIGINS` in `apps/diary-server/deploy/serverless/yandex.env` and redeploy.

Sign-up is open for the prototype (owner 2026-10-28). Invite codes (`DIARY_SIGNUP=invite`) are made
only by the server mode's CLI today; switch sign-up back to invites together with a serverless
invite command.

## «Обзор сервиса» (the owner's numbers)

A signed-in doctor whose e-mail is in `DIARY_ADMIN_EMAILS` sees «Обзор сервиса» in the «⋯» menu of the
diaries' list: doctors, diaries, diaries with a patient's phone, carers' phones, records (all, 7 and 30
days), diaries with a record this week, open and all urgent marks, new doctors and diaries per week for
12 weeks, and a table of doctors (name, e-mail, diaries, diaries active this week, last record).
Added 2026-11-10: tiles «Назначений» (active prescriptions) and «Приём по плану, 7 дней / 30 дней»
(marked share of planned intakes), and two columns in the doctors' table («Назначений», «Приём за 30
дней»). These are **not** something the server can see: each doctor's app computes anonymous totals over the
diaries it owns (diaries with a plan, active prescriptions, medicine intakes due and taken over 7 and 30 days;
demo diaries excluded) and sends them with `PUT /api/doctor/totals`, at most once an hour and only when
they changed. Never per patient: no id, name, plan or record. A doctor who has not opened the diaries since
the update shows dashes; totals older than 30 days still count and the row shows their date.
Only counts and times the server already sees (ADR-0026 §7) and these totals: record bodies stay ciphertext, no patient
is listed or named. The numbers come from `GET /api/admin/stats` (403 for everyone else).

To turn it on, put the owner's sign-in e-mail into `apps/diary-server/deploy/serverless/yandex.env`
(`DIARY_ADMIN_EMAILS="you@example.org"`; several: separated by semicolons) and redeploy with
`scripts/diary-serverless-deploy.sh`. The repository keeps the variable empty; do not commit a real
address. Empty: nobody has the view and the deploy leaves the variable out.

## Checking a change against YDB

```bash
scripts/diary-ydb-contract.sh 'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1gpdrmddfporukd7enk/<test database>'
```

Runs the storage contract (`apps/diary-server/src/contract.ts`, every store method) on Node over a
real YDB database. Use a test database (`yc ydb database create diary-test --serverless`), never
`diary`: every run leaves its rows. `bun run test:diary-server` runs the same contract over SQLite.

## When something is wrong

| Symptom | Look at |
| --- | --- |
| `/api/health` fails | `scripts/diary-admin.sh logs`; the revision is ACTIVE; YDB `diary` is RUNNING |
| First request slow | No instance is kept warm: a cold start is a few seconds; `--min-instances 1` would cost money |
| Certificate error | `yc certificate-manager certificate get med-1damer-com`; the `_acme-challenge` CNAME is still there |
| Pages cannot call the API | The page's origin is in `DIARY_CORS_ORIGINS` (`yandex.env`), then deploy |
| A doctor forgot the password | They use «Восстановить» with their recovery code. Without the code nobody can open their keys; another curator of the patient can invite them again under a new account |
| A patient's phone was lost | The doctor removes the phone in «Кураторы» → «Телефоны пациента» (this rotates the key) and shows a new code |

## Costs

Inside Yandex Cloud's monthly free tier at the pilot's traffic (5–600 API calls a day): container calls
(1 M free), container time (10 GB·h, 5 vCPU·h), gateway requests (100 k), YDB (1 M request units,
1 GB), Cloud Logging (5 GB). Outside it: the image in Container Registry, ≈ 0.3 ₽/month. Keep
vulnerability scanning off (6 free scans, then 14.49 ₽ each) and no warm instances.

## Back to a server

`DIARY_MODE=server` is the same app on Bun over SQLite with the live stream and reminder pushes; the
pages need no rebuild, they read the mode from `/api/health` and open the stream again.

- **Back to a VM** (the model of 2026-10-27 – 11-01, kept as it was, ≈ 1 500 ₽/month):
  `scripts/diary-vm.sh create` (VM + static address in `ru-central1`, cloud-init from
  `apps/diary-server/deploy/cloud-init.yaml`), then `scripts/diary-deploy.sh yc-user@<address>`
  (bundled service, systemd units and Caddyfile from `apps/diary-server/deploy/`), the A record of
  `med.1damer.com` → the new address (DNS only; delete the gateway's domain first), and
  `DIARY_HOST=yc-user@<address> scripts/diary-vm-admin.sh status|invite|logs|backup|restart`. The old
  address is released, so the scripts' default host no longer exists. The VM's last database is
  `data/diary-server/backups/diary-vm-final-2026-11-01.db` on the owner's Mac (restore it with
  `scp` + `install` as in the backup service).
- **Any Linux host**: the container stack or the systemd package of [DIARY_SELFHOST.md](DIARY_SELFHOST.md).

## History

2026-10-27 – 2026-11-01 the service ran on a Yandex Cloud VM (`minimed-diary`, 2 vCPU 20 %, 2 GB,
≈ 1 500 ₽/month, idle); it held only demo accounts and was deleted with its address and network after
the move (ADR-0027). Its scripts stay for a way back (above).
