/**
 * `bun src/backup.ts [--loop]` — copies the database (ciphertext + doctors' accounts) to
 * `DIARY_BACKUP_DIR/diary-YYYY-MM-DD.db` with `VACUUM INTO` (safe while the service writes) and keeps
 * the newest `DIARY_BACKUP_KEEP` copies. `--loop` stays running and makes one copy a day at
 * `DIARY_BACKUP_AT` (local `HH:MM`, the container's TZ): the container's replacement for the VM's
 * systemd timer.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface BackupSettings {
  readonly database: string;
  readonly dir: string;
  readonly keep: number;
  /** Minutes after local midnight. */
  readonly at: number;
}

export function readBackupSettings(
  env: Record<string, string | undefined> = process.env,
): BackupSettings {
  const [hours, minutes] = (env['DIARY_BACKUP_AT'] ?? '03:30').split(':').map(Number);
  return {
    database: resolve(env['DIARY_DB'] ?? 'data/diary-server/diary.db'),
    dir: resolve(env['DIARY_BACKUP_DIR'] ?? 'data/diary-server/backups'),
    keep: Math.max(1, Number(env['DIARY_BACKUP_KEEP'] ?? 14)),
    at: (hours ?? 3) * 60 + (minutes ?? 30),
  };
}

const NAME = /^diary-\d{4}-\d{2}-\d{2}\.db$/;

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Writes today's copy (replacing one made earlier today) and deletes the oldest beyond `keep`. */
export function backupOnce(settings: BackupSettings, today: Date = new Date()): string {
  mkdirSync(settings.dir, { recursive: true });
  const target = join(settings.dir, `diary-${localDate(today)}.db`);
  rmSync(target, { force: true });
  const db = new Database(settings.database, { readonly: true, strict: true });
  try {
    db.query('VACUUM INTO ?').run(target);
  } finally {
    db.close();
  }
  const copies = readdirSync(settings.dir)
    .filter((name) => NAME.test(name))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - settings.keep))) {
    rmSync(join(settings.dir, old), { force: true });
  }
  return target;
}

/** Milliseconds from `now` to the next `at` (minutes after local midnight). */
export function msUntil(at: number, now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(Math.floor(at / 60), at % 60, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

if (import.meta.main) {
  const settings = readBackupSettings();
  const run = () => {
    try {
      console.info(`backup ${backupOnce(settings)}`);
    } catch (error) {
      console.error('backup failed', error);
      process.exitCode = 1;
    }
  };
  if (process.argv.includes('--loop')) {
    const schedule = (): void => {
      setTimeout(() => {
        run();
        schedule();
      }, msUntil(settings.at));
    };
    schedule();
  } else {
    run();
  }
}
