# MiniMed connected diary — self-host package

The diary service for one faculty or clinic: a Bun process (SQLite file) that serves the web app
and the sync API, behind Caddy with an automatic Let's Encrypt certificate. It stores ciphertext;
doctors' e-mails, names and password hashes are the only plain data.

## Install (as root)

Needs Ubuntu 22.04 / 24.04 or Debian 12, 1 vCPU, 1 GB RAM, 10 GB disk, ports 80 and 443 open, and a
DNS A record for the domain pointing at this server.

```bash
tar xzf diary-selfhost-<version>.tar.gz
cd diary-selfhost-<version>
sudo ./install.sh --domain med.example.ru --email admin@example.ru
```

Add `--signup open` to let any doctor register (default: invite code), `--no-caddy` to keep your
own reverse proxy (the service then listens on 127.0.0.1:8790).

## Afterwards

```bash
sudo minimed-diary invite      # one-time sign-up code for a doctor
sudo minimed-diary status      # release, services, health, newest backup, disk
sudo minimed-diary rollback    # back to the previous release
journalctl -u minimed-diary    # service log (never patient data)
```

Update: extract a newer package and run `sudo ./install.sh` again (the settings are remembered).
Data lives in `/var/lib/minimed-diary` (`diary.db`, nightly copies in `backups/`) — back it up.

Full guide: `docs/DIARY_SELFHOST.md` in the MiniMed repository.
