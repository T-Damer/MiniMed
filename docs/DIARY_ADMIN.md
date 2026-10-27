# Diary server — management

The connected diary runs on one Yandex Cloud VM. Everything below is run from the repository on the
owner's Mac. Details and the reasons behind them: [DIARY_SERVICE.md](DIARY_SERVICE.md).

| | |
| --- | --- |
| Address | `https://med.1damer.com` (doctors: `https://med.1damer.com/?profile=diaries`) |
| VM | `minimed-diary`, Yandex Cloud folder `b1g5anoolpkm1sr7c810`, zone `ru-central1-a`, `51.250.93.197` (static) |
| SSH | `ssh yc-user@51.250.93.197` (key `~/.ssh/id_ed25519`) |
| Service | systemd `minimed-diary` (Bun, port 8790 on localhost) behind Caddy (HTTPS, automatic certificate) |
| Data | `/var/lib/minimed-diary/diary.db` — ciphertext of the diaries plus doctors' e-mails, names and password hashes |
| Backups | nightly 03:30 UTC to `/var/lib/minimed-diary/backups/` (14 kept) |
| DNS | Cloudflare, `A med.1damer.com → 51.250.93.197`, **DNS only** (grey cloud) |

## Everyday commands

```bash
scripts/diary-admin.sh invite    # a one-time sign-up code for a doctor (send it with the link)
scripts/diary-admin.sh status    # service, Caddy, backup timer, health, disk, newest backup
scripts/diary-admin.sh logs      # service log: routes, status codes, times — never patient data
scripts/diary-admin.sh backup    # copy the newest backup to data/diary-server/backups/ on this Mac
scripts/diary-admin.sh restart
```

## Updating the server

```bash
git pull
scripts/diary-deploy.sh yc-user@51.250.93.197
```

Builds the app, bundles the service into one file, copies both, updates the systemd units and the
Caddyfile when they changed, restarts and waits for the health check. The database is never touched.
`SKIP_BUILD=1` reuses the last `apps/app/dist`. A database schema change ships as a numbered
migration in `apps/diary-server/src/db.ts` and runs by itself on start.

## When something is wrong

| Symptom | Look at |
| --- | --- |
| Site does not open | `scripts/diary-admin.sh status`; DNS still points at `51.250.93.197` and is not proxied |
| Certificate error | `ssh yc-user@51.250.93.197 'sudo journalctl -u caddy -n 50'` (Caddy retries by itself once DNS is right) |
| Service down | `scripts/diary-admin.sh logs`, then `restart` |
| A doctor forgot the password | They use «Восстановить» with their recovery code. Without the code nobody can open their keys; another curator of the patient can invite them again under a new account |
| A patient's phone was lost | The doctor removes the phone in «Кураторы» → «Телефоны пациента» (this rotates the key) and shows a new code |

## Restoring a backup

```bash
scp data/diary-server/backups/diary-YYYY-MM-DD.db yc-user@51.250.93.197:/tmp/restore.db
ssh yc-user@51.250.93.197 'sudo systemctl stop minimed-diary &&
  sudo install -o minimed -g minimed -m 0600 /tmp/restore.db /var/lib/minimed-diary/diary.db &&
  sudo rm -f /var/lib/minimed-diary/diary.db-wal /var/lib/minimed-diary/diary.db-shm &&
  sudo systemctl start minimed-diary'
```

Everything written after that backup is lost on the server; phones that still hold newer records
send them again on their next sync.

## Costs and shutting down

Yandex bills per second (prices with VAT, October 2026): 2 vCPU at 20 % ≈ 750 ₽/month, 2 GB RAM ≈
475 ₽/month, the public address ≈ 190 ₽/month while in use (≈ 435 ₽ while reserved and idle), plus the
20 GB network HDD (rate not on the public page; small). A stopped VM still pays for the disk and the
reserved address. To remove everything (the database too):

```bash
yc compute instance delete minimed-diary
yc vpc address delete minimed-diary-ip
yc vpc subnet delete minimed-diary-ru-central1-a
yc vpc network delete minimed-diary-net
```
