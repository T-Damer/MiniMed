/**
 * The diary service's SQLite store. Changes only through numbered migrations (AGENTS.md). Record
 * bodies, identity blobs and wrapped keys are ciphertext; what is plain is listed in ADR-0026 §7.
 */
import { Database } from 'bun:sqlite';

const MIGRATIONS: readonly string[] = [
  // 1: accounts, patients, membership, keys, devices, records, alerts, push.
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE doctors (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    auth_hash TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,
    kdf_iterations INTEGER NOT NULL,
    identity_wrap TEXT NOT NULL,
    identity_sign TEXT NOT NULL,
    identity_blob TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    recovery_blob TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    used_by TEXT REFERENCES doctors(id)
  );
  CREATE TABLE patients (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES doctors(id),
    epoch INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE members (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id TEXT NOT NULL REFERENCES doctors(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (patient_id, doctor_id)
  );
  CREATE TABLE patient_keys (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    epoch INTEGER NOT NULL,
    recipient TEXT NOT NULL,
    wrapped TEXT NOT NULL,
    PRIMARY KEY (patient_id, epoch, recipient)
  );
  CREATE TABLE pairings (
    secret_hash TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    sealed_keys TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    identity_wrap TEXT NOT NULL,
    identity_sign TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT
  );
  CREATE TABLE records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    sig TEXT NOT NULL,
    at TEXT NOT NULL,
    UNIQUE (patient_id, id, rev)
  );
  CREATE INDEX records_patient_seq ON records (patient_id, seq);
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    at TEXT NOT NULL,
    acked_at TEXT
  );
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 2: payload keys of push subscriptions; reminder moments of patients' phones (times only).
  `
  ALTER TABLE push_subscriptions ADD COLUMN p256dh TEXT;
  ALTER TABLE push_subscriptions ADD COLUMN auth TEXT;
  CREATE TABLE reminders (
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    PRIMARY KEY (device_id, at)
  );
  CREATE INDEX reminders_at ON reminders (at);
  `,
];

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.query<{ version: number }, []>('SELECT version FROM schema_version').get();
  let version = row?.version ?? 0;
  if (!row) db.exec('INSERT INTO schema_version (version) VALUES (0)');
  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version] as string;
    db.transaction(() => {
      db.exec(migration);
      db.query('UPDATE schema_version SET version = ?').run(version + 1);
    })();
    version += 1;
  }
  return db;
}

export function setting(db: Database, key: string): string | undefined {
  return db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(key)
    ?.value;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.query(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function now(): string {
  return new Date().toISOString();
}
