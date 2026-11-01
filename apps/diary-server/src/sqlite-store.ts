/**
 * The `server` mode's store (ADR-0027): SQLite in WAL mode, one process. Changes only through
 * numbered migrations (AGENTS.md). Record bodies, identity blobs and wrapped keys are ciphertext;
 * what is plain is listed in ADR-0026 §7.
 */
import { Database } from 'bun:sqlite';
import type { DiaryRole } from '@localmed/contracts';

import {
  type AlertRow,
  type DeviceRow,
  type DiaryStore,
  type DoctorRow,
  type KeyRow,
  type MemberRow,
  type NewRecord,
  type PatientCounts,
  type PatientRow,
  type PushTarget,
  type RecordRow,
  StoreConflict,
} from './store';

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

/** The SQLite store over an open database (see `openDatabase`). */
export class SqliteStore implements DiaryStore {
  /** Rate-limit attempts: one process holds them all, so memory is enough here. */
  private readonly attempts = new Map<string, number[]>();

  constructor(readonly db: Database) {}

  async setting(key: string): Promise<string | undefined> {
    return this.db
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get(key)?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.db
      .query(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  async attempt(key: string, windowMs: number, limit: number): Promise<boolean> {
    const time = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((at) => time - at < windowMs);
    if (recent.length >= limit) return false;
    recent.push(time);
    this.attempts.set(key, recent);
    return true;
  }

  async doctorById(id: string): Promise<DoctorRow | undefined> {
    return (
      this.db.query<DoctorRow, [string]>('SELECT * FROM doctors WHERE id = ?').get(id) ?? undefined
    );
  }

  async doctorByEmail(email: string): Promise<DoctorRow | undefined> {
    return (
      this.db.query<DoctorRow, [string]>('SELECT * FROM doctors WHERE email = ?').get(email) ??
      undefined
    );
  }

  async createDoctor(row: DoctorRow, inviteCode?: string): Promise<void> {
    try {
      this.db.transaction(() => {
        this.db
          .query(
            `INSERT INTO doctors (id, email, name, auth_hash, kdf_salt, kdf_iterations, identity_wrap,
              identity_sign, identity_blob, recovery_hash, recovery_blob, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.id,
            row.email,
            row.name,
            row.auth_hash,
            row.kdf_salt,
            row.kdf_iterations,
            row.identity_wrap,
            row.identity_sign,
            row.identity_blob,
            row.recovery_hash,
            row.recovery_blob,
            row.created_at,
          );
        if (inviteCode) {
          this.db.query('UPDATE invites SET used_by = ? WHERE code = ?').run(row.id, inviteCode);
        }
      })();
    } catch (cause) {
      if (isUniqueViolation(cause)) throw new StoreConflict('e-mail');
      throw cause;
    }
  }

  async resetDoctorAuth(
    id: string,
    authHash: string,
    kdfSalt: string,
    kdfIterations: number,
    identityBlob: string,
  ): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query(
          'UPDATE doctors SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?, identity_blob = ? WHERE id = ?',
        )
        .run(authHash, kdfSalt, kdfIterations, identityBlob, id);
      this.db.query('DELETE FROM sessions WHERE doctor_id = ?').run(id);
    })();
  }

  async invite(code: string): Promise<{ code: string; used_by: string | null } | undefined> {
    return (
      this.db
        .query<{ code: string; used_by: string | null }, [string]>(
          'SELECT code, used_by FROM invites WHERE code = ?',
        )
        .get(code) ?? undefined
    );
  }

  async createInvite(code: string, at: string): Promise<void> {
    this.db.query('INSERT INTO invites (code, created_at) VALUES (?, ?)').run(code, at);
  }

  async createSession(tokenHash: string, doctorId: string, expiresAt: string): Promise<void> {
    this.db
      .query('INSERT INTO sessions (token_hash, doctor_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, doctorId, expiresAt);
  }

  async session(tokenHash: string): Promise<{ doctor_id: string; expires_at: string } | undefined> {
    return (
      this.db
        .query<{ doctor_id: string; expires_at: string }, [string]>(
          'SELECT doctor_id, expires_at FROM sessions WHERE token_hash = ?',
        )
        .get(tokenHash) ?? undefined
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.db.query('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  async deviceByToken(tokenHash: string): Promise<{ id: string; patient_id: string } | undefined> {
    return (
      this.db
        .query<{ id: string; patient_id: string }, [string]>(
          'SELECT id, patient_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL',
        )
        .get(tokenHash) ?? undefined
    );
  }

  async touchDevice(id: string, at: string): Promise<void> {
    this.db.query('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(at, id);
  }

  async lastSeen(patientId: string): Promise<string | undefined> {
    return (
      this.db
        .query<{ at: string | null }, [string]>(
          'SELECT MAX(last_seen_at) AS at FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
        )
        .get(patientId)?.at ?? undefined
    );
  }

  async activeDevices(patientId: string): Promise<DeviceRow[]> {
    return this.db
      .query<DeviceRow, [string]>(
        'SELECT id, identity_wrap, identity_sign, created_at, last_seen_at FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
      )
      .all(patientId);
  }

  async deviceSign(deviceId: string, patientId: string): Promise<string | undefined> {
    return (
      this.db
        .query<{ identity_sign: string }, [string, string]>(
          'SELECT identity_sign FROM devices WHERE id = ? AND patient_id = ?',
        )
        .get(deviceId, patientId)?.identity_sign ?? undefined
    );
  }

  async revokeDevice(deviceId: string, patientId: string, at: string): Promise<void> {
    this.db
      .query('UPDATE devices SET revoked_at = ? WHERE id = ? AND patient_id = ?')
      .run(at, deviceId, patientId);
  }

  async createPairing(
    secretHash: string,
    patientId: string,
    sealedKeys: string,
    expiresAt: string,
  ): Promise<void> {
    this.db
      .query(
        'INSERT INTO pairings (secret_hash, patient_id, sealed_keys, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(secretHash, patientId, sealedKeys, expiresAt);
  }

  async pairing(
    secretHash: string,
  ): Promise<{ patient_id: string; sealed_keys: string; expires_at: string } | undefined> {
    return (
      this.db
        .query<{ patient_id: string; sealed_keys: string; expires_at: string }, [string]>(
          'SELECT patient_id, sealed_keys, expires_at FROM pairings WHERE secret_hash = ?',
        )
        .get(secretHash) ?? undefined
    );
  }

  async pairDevice(
    device: {
      id: string;
      patient_id: string;
      token_hash: string;
      identity_wrap: string;
      identity_sign: string;
      created_at: string;
    },
    secretHash: string,
  ): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO devices (id, patient_id, token_hash, identity_wrap, identity_sign, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          device.id,
          device.patient_id,
          device.token_hash,
          device.identity_wrap,
          device.identity_sign,
          device.created_at,
        );
      // One-time: a photo of the QR code is useless afterwards.
      this.db.query('DELETE FROM pairings WHERE secret_hash = ?').run(secretHash);
    })();
  }

  async patient(id: string): Promise<PatientRow | undefined> {
    return (
      this.db.query<PatientRow, [string]>('SELECT * FROM patients WHERE id = ?').get(id) ??
      undefined
    );
  }

  async createPatient(id: string, ownerId: string, key: KeyRow, at: string): Promise<void> {
    try {
      this.db.transaction(() => {
        this.db
          .query(
            'INSERT INTO patients (id, owner_id, epoch, status, created_at) VALUES (?, ?, 1, ?, ?)',
          )
          .run(id, ownerId, 'active', at);
        this.db
          .query(
            "INSERT INTO members (patient_id, doctor_id, role, status, added_at) VALUES (?, ?, 'owner', 'active', ?)",
          )
          .run(id, ownerId, at);
        this.db
          .query(
            'INSERT INTO patient_keys (patient_id, epoch, recipient, wrapped) VALUES (?, ?, ?, ?)',
          )
          .run(id, key.epoch, key.recipient, key.wrapped);
      })();
    } catch (cause) {
      if (isUniqueViolation(cause)) throw new StoreConflict('patient');
      throw cause;
    }
  }

  async deletePatient(id: string): Promise<void> {
    this.db.query('DELETE FROM patients WHERE id = ?').run(id);
  }

  async patientsOf(
    doctorId: string,
  ): Promise<(PatientRow & { role: DiaryRole; member_status: string })[]> {
    return this.db
      .query<PatientRow & { role: DiaryRole; member_status: string }, [string]>(
        `SELECT p.*, m.role AS role, m.status AS member_status FROM patients p
         JOIN members m ON m.patient_id = p.id WHERE m.doctor_id = ? ORDER BY p.created_at DESC`,
      )
      .all(doctorId);
  }

  async counts(patientId: string): Promise<PatientCounts> {
    const last = this.db
      .query<{ seq: number | null; at: string | null }, [string]>(
        'SELECT MAX(seq) AS seq, MAX(at) AS at FROM records WHERE patient_id = ?',
      )
      .get(patientId);
    const alerts = this.db
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM alerts WHERE patient_id = ? AND acked_at IS NULL',
      )
      .get(patientId);
    const devices = this.db
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
      )
      .get(patientId);
    return {
      lastSeq: last?.seq ?? 0,
      lastRecordAt: last?.at ?? null,
      openAlerts: alerts?.count ?? 0,
      devices: devices?.count ?? 0,
    };
  }

  async membership(patientId: string, doctorId: string): Promise<MemberRow | undefined> {
    return (
      this.db
        .query<MemberRow, [string, string]>(
          'SELECT role, status FROM members WHERE patient_id = ? AND doctor_id = ?',
        )
        .get(patientId, doctorId) ?? undefined
    );
  }

  async activeDoctors(patientId: string): Promise<string[]> {
    return this.db
      .query<{ doctor_id: string }, [string]>(
        "SELECT doctor_id FROM members WHERE patient_id = ? AND status = 'active'",
      )
      .all(patientId)
      .map((row) => row.doctor_id);
  }

  async memberDoctors(patientId: string): Promise<string[]> {
    return this.db
      .query<{ doctor_id: string }, [string]>('SELECT doctor_id FROM members WHERE patient_id = ?')
      .all(patientId)
      .map((row) => row.doctor_id);
  }

  async members(patientId: string): Promise<(DoctorRow & MemberRow & { added_at: string })[]> {
    return this.db
      .query<DoctorRow & MemberRow & { added_at: string }, [string]>(
        `SELECT d.*, m.role AS role, m.status AS status, m.added_at AS added_at FROM members m
         JOIN doctors d ON d.id = m.doctor_id WHERE m.patient_id = ? ORDER BY m.added_at`,
      )
      .all(patientId);
  }

  async inviteMember(
    patientId: string,
    doctorId: string,
    role: DiaryRole,
    at: string,
    keys: readonly KeyRow[],
  ): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO members (patient_id, doctor_id, role, status, added_at) VALUES (?, ?, ?, 'pending', ?)
           ON CONFLICT(patient_id, doctor_id) DO UPDATE SET role = excluded.role`,
        )
        .run(patientId, doctorId, role, at);
      for (const key of keys) {
        this.db
          .query(
            'INSERT OR REPLACE INTO patient_keys (patient_id, epoch, recipient, wrapped) VALUES (?, ?, ?, ?)',
          )
          .run(patientId, key.epoch, key.recipient, key.wrapped);
      }
    })();
  }

  async acceptMember(patientId: string, doctorId: string): Promise<void> {
    this.db
      .query("UPDATE members SET status = 'active' WHERE patient_id = ? AND doctor_id = ?")
      .run(patientId, doctorId);
  }

  async setRole(patientId: string, doctorId: string, role: DiaryRole): Promise<void> {
    this.db
      .query('UPDATE members SET role = ? WHERE patient_id = ? AND doctor_id = ?')
      .run(role, patientId, doctorId);
  }

  async removeMember(patientId: string, doctorId: string): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query('DELETE FROM members WHERE patient_id = ? AND doctor_id = ?')
        .run(patientId, doctorId);
      this.db
        .query('DELETE FROM patient_keys WHERE patient_id = ? AND recipient = ?')
        .run(patientId, `d:${doctorId}`);
    })();
  }

  async transferOwner(patientId: string, fromDoctorId: string, toDoctorId: string): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query("UPDATE members SET role = 'editor' WHERE patient_id = ? AND doctor_id = ?")
        .run(patientId, fromDoctorId);
      this.db
        .query("UPDATE members SET role = 'owner' WHERE patient_id = ? AND doctor_id = ?")
        .run(patientId, toDoctorId);
      this.db.query('UPDATE patients SET owner_id = ? WHERE id = ?').run(toDoctorId, patientId);
    })();
  }

  async keysFor(patientId: string, recipient: string): Promise<KeyRow[]> {
    return this.db
      .query<KeyRow, [string, string]>(
        'SELECT epoch, recipient, wrapped FROM patient_keys WHERE patient_id = ? AND recipient = ? ORDER BY epoch',
      )
      .all(patientId, recipient);
  }

  async addEpoch(patientId: string, epoch: number, keys: readonly KeyRow[]): Promise<void> {
    this.db.transaction(() => {
      for (const key of keys) {
        this.db
          .query(
            'INSERT INTO patient_keys (patient_id, epoch, recipient, wrapped) VALUES (?, ?, ?, ?)',
          )
          .run(patientId, key.epoch, key.recipient, key.wrapped);
      }
      this.db.query('UPDATE patients SET epoch = ? WHERE id = ?').run(epoch, patientId);
    })();
  }

  async records(patientId: string, after: number, limit: number): Promise<RecordRow[]> {
    return this.db
      .query<RecordRow, [string, number, number]>(
        'SELECT seq, id, rev, epoch, author, body, sig, at FROM records WHERE patient_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      )
      .all(patientId, after, limit);
  }

  async insertRecords(
    patientId: string,
    records: readonly NewRecord[],
    at: string,
  ): Promise<number[]> {
    const seqs: number[] = [];
    try {
      this.db.transaction(() => {
        for (const record of records) {
          const result = this.db
            .query(
              'INSERT INTO records (patient_id, id, rev, epoch, author, body, sig, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              patientId,
              record.id,
              record.rev,
              record.epoch,
              record.author,
              record.body,
              record.sig,
              at,
            );
          seqs.push(Number(result.lastInsertRowid));
        }
      })();
    } catch (cause) {
      if (isUniqueViolation(cause)) throw new StoreConflict('record');
      throw cause;
    }
    return seqs;
  }

  async authors(patientId: string): Promise<string[]> {
    return this.db
      .query<{ author: string }, [string]>(
        'SELECT DISTINCT author FROM records WHERE patient_id = ?',
      )
      .all(patientId)
      .map((row) => row.author);
  }

  async addAlert(patientId: string, kind: AlertRow['kind'], at: string): Promise<number> {
    const result = this.db
      .query('INSERT INTO alerts (patient_id, kind, at) VALUES (?, ?, ?)')
      .run(patientId, kind, at);
    return Number(result.lastInsertRowid);
  }

  async openAlertsFor(doctorId: string, limit: number): Promise<AlertRow[]> {
    return this.db
      .query<AlertRow, [string, number]>(
        `SELECT a.id, a.patient_id, a.kind, a.at FROM alerts a
         JOIN members m ON m.patient_id = a.patient_id AND m.doctor_id = ? AND m.status = 'active'
         WHERE a.acked_at IS NULL ORDER BY a.at DESC LIMIT ?`,
      )
      .all(doctorId, limit);
  }

  async alertPatient(id: number): Promise<string | undefined> {
    return (
      this.db
        .query<{ patient_id: string }, [number]>('SELECT patient_id FROM alerts WHERE id = ?')
        .get(id)?.patient_id ?? undefined
    );
  }

  async ackAlert(id: number, at: string): Promise<void> {
    this.db.query('UPDATE alerts SET acked_at = ? WHERE id = ?').run(at, id);
  }

  async withdraw(patientId: string, at: string): Promise<void> {
    this.db.transaction(() => {
      this.db.query('DELETE FROM records WHERE patient_id = ?').run(patientId);
      this.db.query('DELETE FROM pairings WHERE patient_id = ?').run(patientId);
      this.db
        .query('DELETE FROM patient_keys WHERE patient_id = ? AND recipient LIKE ?')
        .run(patientId, 'p:%');
      this.db
        .query('UPDATE devices SET revoked_at = ? WHERE patient_id = ? AND revoked_at IS NULL')
        .run(at, patientId);
      this.db.query("UPDATE patients SET status = 'withdrawn' WHERE id = ?").run(patientId);
      this.db
        .query("INSERT INTO alerts (patient_id, kind, at) VALUES (?, 'withdrawn', ?)")
        .run(patientId, at);
    })();
  }

  async pushTargets(owners: readonly string[]): Promise<PushTarget[]> {
    if (!owners.length) return [];
    const placeholders = owners.map(() => '?').join(',');
    return this.db
      .query<PushTarget, string[]>(
        `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE owner IN (${placeholders})`,
      )
      .all(...owners);
  }

  async savePushSubscription(
    endpoint: string,
    owner: string,
    at: string,
    p256dh: string | null,
    auth: string | null,
  ): Promise<void> {
    this.db
      .query(
        `INSERT INTO push_subscriptions (endpoint, owner, created_at, p256dh, auth) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(endpoint, owner, at, p256dh, auth);
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    this.db.query('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  async replaceReminders(deviceId: string, moments: readonly string[]): Promise<void> {
    this.db.transaction(() => {
      this.db.query('DELETE FROM reminders WHERE device_id = ?').run(deviceId);
      const insert = this.db.query('INSERT INTO reminders (device_id, at) VALUES (?, ?)');
      for (const at of moments) insert.run(deviceId, at);
    })();
  }

  async takeDueReminders(at: string): Promise<{ device_id: string; at: string }[]> {
    const due = this.db
      .query<{ device_id: string; at: string }, [string]>(
        `SELECT r.device_id, r.at FROM reminders r
         JOIN devices d ON d.id = r.device_id AND d.revoked_at IS NULL
         WHERE r.at <= ? ORDER BY r.at`,
      )
      .all(at);
    this.db.query('DELETE FROM reminders WHERE at <= ?').run(at);
    return due;
  }
}

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/u.test(cause.message);
}
