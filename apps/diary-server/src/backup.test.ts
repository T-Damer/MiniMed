import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupOnce, msUntil, readBackupSettings } from './backup';

describe('diary backup', () => {
  it('copies the database while it is open in WAL mode and keeps the newest copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'diary-backup-'));
    const database = join(root, 'diary.db');
    const live = new Database(database, { create: true });
    live.exec(
      'PRAGMA journal_mode = WAL; CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (1), (2)',
    );
    const settings = { database, dir: join(root, 'backups'), keep: 2, at: 210 };
    backupOnce(settings, new Date(2026, 9, 29));
    writeFileSync(join(settings.dir, 'notes.txt'), 'not a backup');
    backupOnce(settings, new Date(2026, 9, 30));
    const target = backupOnce(settings, new Date(2026, 9, 31));

    expect(readdirSync(settings.dir).sort()).toEqual([
      'diary-2026-10-30.db',
      'diary-2026-10-31.db',
      'notes.txt',
    ]);
    const copy = new Database(target, { readonly: true });
    expect(copy.query('SELECT count(*) AS n FROM records').get()).toEqual({ n: 2 });
    copy.close();
    live.close();
  });

  it('waits for the next run time, today or tomorrow', () => {
    expect(msUntil(210, new Date(2026, 9, 31, 3, 0))).toBe(30 * 60_000);
    expect(msUntil(210, new Date(2026, 9, 31, 3, 30))).toBe(24 * 3600_000);
  });

  it('reads HH:MM and the number of copies from the environment', () => {
    const s = readBackupSettings({
      DIARY_DB: '/data/diary.db',
      DIARY_BACKUP_DIR: '/backups',
      DIARY_BACKUP_AT: '04:15',
      DIARY_BACKUP_KEEP: '7',
    });
    expect(s).toEqual({ database: '/data/diary.db', dir: '/backups', keep: 7, at: 255 });
  });
});
