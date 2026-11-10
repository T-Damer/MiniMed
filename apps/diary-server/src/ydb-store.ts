/**
 * The `serverless` mode's store (ADR-0027): Yandex Database (serverless) through the Query service,
 * Node only (Bun 1.2's HTTP/2 stalls on its streaming calls). Same port and the same rules as
 * `sqlite-store.ts`; what SQLite gets from UNIQUE, AUTOINCREMENT and ON DELETE CASCADE is spelled
 * out here: an e-mail table, BigSerial keys and explicit deletes, each step in one serializable
 * transaction. Schema changes go through the numbered `MIGRATIONS` below.
 */
import type { DiaryDeviceKind, DiaryDoctorTotals, DiaryRole } from '@localmed/contracts';
import type { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { Optional } from '@ydbjs/value/optional';
import { Text, TextType } from '@ydbjs/value/primitive';

import {
  type AlertRow,
  type DeviceRow,
  type DiaryStore,
  type DoctorRow,
  type DoctorTotalsRow,
  type DoseCheckRow,
  InviteSpent,
  type KeyRow,
  type MemberRow,
  type NewRecord,
  type PatientCounts,
  type PatientRow,
  type PushTarget,
  type RecordRow,
  type ServiceStatsRaw,
  StoreConflict,
} from './store';

/** Numbered schema steps; `schema_version` in `settings` says how many ran. Never edit a shipped one. */
const MIGRATIONS: readonly string[][] = [
  [
    'CREATE TABLE settings (key Utf8 NOT NULL, value Utf8 NOT NULL, PRIMARY KEY (key))',
    // Rate-limit attempts; YDB drops rows an hour old by itself.
    `CREATE TABLE attempts (key Utf8 NOT NULL, at Timestamp NOT NULL, nonce Utf8 NOT NULL,
       PRIMARY KEY (key, at, nonce)) WITH (TTL = Interval("PT1H") ON at)`,
    `CREATE TABLE doctors (id Utf8 NOT NULL, email Utf8 NOT NULL, name Utf8 NOT NULL,
       auth_hash Utf8 NOT NULL, kdf_salt Utf8 NOT NULL, kdf_iterations Int64 NOT NULL,
       identity_wrap Utf8 NOT NULL, identity_sign Utf8 NOT NULL, identity_blob Utf8 NOT NULL,
       recovery_hash Utf8 NOT NULL, recovery_blob Utf8 NOT NULL, created_at Utf8 NOT NULL,
       PRIMARY KEY (id))`,
    // UNIQUE (email): an insert of a taken address fails on this key.
    'CREATE TABLE doctor_emails (email Utf8 NOT NULL, doctor_id Utf8 NOT NULL, PRIMARY KEY (email))',
    `CREATE TABLE sessions (token_hash Utf8 NOT NULL, doctor_id Utf8 NOT NULL, expires_at Utf8 NOT NULL,
       PRIMARY KEY (token_hash), INDEX by_doctor GLOBAL ON (doctor_id))`,
    'CREATE TABLE invites (code Utf8 NOT NULL, created_at Utf8 NOT NULL, used_by Utf8, PRIMARY KEY (code))',
    `CREATE TABLE patients (id Utf8 NOT NULL, owner_id Utf8 NOT NULL, epoch Int64 NOT NULL,
       status Utf8 NOT NULL, created_at Utf8 NOT NULL, PRIMARY KEY (id))`,
    `CREATE TABLE members (patient_id Utf8 NOT NULL, doctor_id Utf8 NOT NULL, role Utf8 NOT NULL,
       status Utf8 NOT NULL, added_at Utf8 NOT NULL, PRIMARY KEY (patient_id, doctor_id),
       INDEX by_doctor GLOBAL ON (doctor_id))`,
    `CREATE TABLE patient_keys (patient_id Utf8 NOT NULL, epoch Int64 NOT NULL, recipient Utf8 NOT NULL,
       wrapped Utf8 NOT NULL, PRIMARY KEY (patient_id, epoch, recipient))`,
    `CREATE TABLE pairings (secret_hash Utf8 NOT NULL, patient_id Utf8 NOT NULL, sealed_keys Utf8 NOT NULL,
       expires_at Utf8 NOT NULL, PRIMARY KEY (secret_hash), INDEX by_patient GLOBAL ON (patient_id))`,
    `CREATE TABLE devices (id Utf8 NOT NULL, patient_id Utf8 NOT NULL, token_hash Utf8 NOT NULL,
       identity_wrap Utf8 NOT NULL, identity_sign Utf8 NOT NULL, created_at Utf8 NOT NULL,
       last_seen_at Utf8, revoked_at Utf8, PRIMARY KEY (id),
       INDEX by_token GLOBAL ON (token_hash), INDEX by_patient GLOBAL ON (patient_id))`,
    `CREATE TABLE records (patient_id Utf8 NOT NULL, seq BigSerial NOT NULL, id Utf8 NOT NULL,
       rev Int64 NOT NULL, epoch Int64 NOT NULL, author Utf8 NOT NULL, body Utf8 NOT NULL,
       sig Utf8 NOT NULL, at Utf8 NOT NULL, PRIMARY KEY (patient_id, seq))`,
    // UNIQUE (patient_id, id, rev).
    `CREATE TABLE record_revisions (patient_id Utf8 NOT NULL, id Utf8 NOT NULL, rev Int64 NOT NULL,
       PRIMARY KEY (patient_id, id, rev))`,
    `CREATE TABLE alerts (id BigSerial NOT NULL, patient_id Utf8 NOT NULL, kind Utf8 NOT NULL,
       at Utf8 NOT NULL, acked_at Utf8, PRIMARY KEY (id), INDEX by_patient GLOBAL ON (patient_id))`,
    `CREATE TABLE push_subscriptions (endpoint Utf8 NOT NULL, owner Utf8 NOT NULL, created_at Utf8 NOT NULL,
       p256dh Utf8, auth Utf8, PRIMARY KEY (endpoint), INDEX by_owner GLOBAL ON (owner))`,
    'CREATE TABLE reminders (device_id Utf8 NOT NULL, at Utf8 NOT NULL, PRIMARY KEY (device_id, at))',
    'CREATE TABLE changes (owner Utf8 NOT NULL, n Int64 NOT NULL, PRIMARY KEY (owner))',
  ],
  // Carers' phones (DIARY25; a missing kind is the patient's phone) and the dose moments kept for
  // their missed-dose notice.
  [
    'ALTER TABLE devices ADD COLUMN kind Utf8',
    'ALTER TABLE pairings ADD COLUMN kind Utf8',
    `CREATE TABLE dose_checks (patient_id Utf8 NOT NULL, at Utf8 NOT NULL, state Utf8 NOT NULL,
       PRIMARY KEY (patient_id, at))`,
  ],
  // The totals each doctor's app reports for the owner's overview (ADR-0026 §7): one row per doctor.
  [
    `CREATE TABLE doctor_totals (doctor_id Utf8 NOT NULL, diaries Int64 NOT NULL,
       prescriptions Int64 NOT NULL, done7 Int64 NOT NULL, total7 Int64 NOT NULL,
       done30 Int64 NOT NULL, total30 Int64 NOT NULL, at Utf8 NOT NULL, PRIMARY KEY (doctor_id))`,
  ],
];

type Sql = ReturnType<typeof query>;

/** A nullable text parameter (the SDK refuses a bare JS null). */
const maybe = (value: string | null): Optional<TextType> =>
  new Optional(value === null ? null : new Text(value), new TextType());

/** First result set of a query, numbers from YDB's Int64 (bigint) made plain numbers. */
async function rows<T>(pending: PromiseLike<unknown[][]>): Promise<T[]> {
  const [set = []] = await pending;
  return set.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[key] = typeof value === 'bigint' ? Number(value) : value;
    }
    return out as T;
  });
}

async function first<T>(pending: PromiseLike<unknown[][]>): Promise<T | undefined> {
  return (await rows<T>(pending))[0];
}

/** A primary-key conflict (YDB PRECONDITION_FAILED, issue 2012), also when wrapped by a transaction error. */
function isKeyConflict(cause: unknown): boolean {
  for (let error = cause; error instanceof Error; error = error.cause) {
    if ((error as { code?: number }).code === 400120 && /Constraint violated/u.test(error.message))
      return true;
  }
  return false;
}

/**
 * The error thrown inside `sql.begin`, which the SDK hands back wrapped («Transaction failed»
 * with the thrown error as its `cause`): the store's own errors must reach the caller as they are.
 */
function thrownInside<T extends Error>(
  cause: unknown,
  type: new (...args: never[]) => T,
): T | undefined {
  for (let error = cause; error instanceof Error; error = error.cause) {
    if (error instanceof type) return error;
  }
  return undefined;
}

export class YdbStore implements DiaryStore {
  private readonly sql: Sql;

  constructor(driver: Driver) {
    this.sql = query(driver);
  }

  /** Runs the schema steps not yet applied. Safe to call on every cold start. */
  async migrate(): Promise<void> {
    await this
      .sql`CREATE TABLE IF NOT EXISTS settings (key Utf8 NOT NULL, value Utf8 NOT NULL, PRIMARY KEY (key))`;
    const done = Number((await this.setting('schema_version')) ?? 0);
    for (let step = done; step < MIGRATIONS.length; step += 1) {
      for (const statement of MIGRATIONS[step] as string[]) {
        const text = statement.replace(/^CREATE TABLE /u, 'CREATE TABLE IF NOT EXISTS ');
        await this.sql(text);
      }
      await this.setSetting('schema_version', String(step + 1));
    }
  }

  async setting(key: string): Promise<string | undefined> {
    return (await first<{ value: string }>(this.sql`SELECT value FROM settings WHERE key = ${key}`))
      ?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.sql`UPSERT INTO settings (key, value) VALUES (${key}, ${value})`;
  }

  async attempt(key: string, windowMs: number, limit: number, record = true): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    return this.sql.begin(async (tx) => {
      const row = await first<{ n: number }>(
        tx`SELECT COUNT(*) AS n FROM attempts WHERE key = ${key} AND at > CAST(${since.toISOString()} AS Timestamp)`,
      );
      if ((row?.n ?? 0) >= limit) return false;
      if (!record) return true;
      await tx`INSERT INTO attempts (key, at, nonce) VALUES (${key}, CurrentUtcTimestamp(), ${crypto.randomUUID()})`;
      return true;
    });
  }

  async doctorById(id: string): Promise<DoctorRow | undefined> {
    return first<DoctorRow>(this.sql`SELECT * FROM doctors WHERE id = ${id}`);
  }

  async doctorByEmail(email: string): Promise<DoctorRow | undefined> {
    return first<DoctorRow>(
      this
        .sql`SELECT d.* FROM doctor_emails AS e JOIN doctors AS d ON d.id = e.doctor_id WHERE e.email = ${email}`,
    );
  }

  async createDoctor(row: DoctorRow, inviteCode?: string): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        await tx`INSERT INTO doctor_emails (email, doctor_id) VALUES (${row.email}, ${row.id})`;
        await tx`INSERT INTO doctors (id, email, name, auth_hash, kdf_salt, kdf_iterations, identity_wrap,
            identity_sign, identity_blob, recovery_hash, recovery_blob, created_at)
          VALUES (${row.id}, ${row.email}, ${row.name}, ${row.auth_hash}, ${row.kdf_salt},
            ${BigInt(row.kdf_iterations)}, ${row.identity_wrap}, ${row.identity_sign}, ${row.identity_blob},
            ${row.recovery_hash}, ${row.recovery_blob}, ${row.created_at})`;
        if (inviteCode) {
          // Spent only if still unused: of two registrations racing for one code, one wins.
          const invite = await first<{ used_by: string | null }>(
            tx`SELECT used_by FROM invites WHERE code = ${inviteCode}`,
          );
          if (!invite || invite.used_by) throw new InviteSpent();
          await tx`UPDATE invites SET used_by = ${row.id} WHERE code = ${inviteCode}`;
        }
      });
    } catch (cause) {
      const spent = thrownInside(cause, InviteSpent);
      if (spent) throw spent;
      if (isKeyConflict(cause)) throw new StoreConflict('e-mail');
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
    await this.sql.begin(async (tx) => {
      await tx`UPDATE doctors SET auth_hash = ${authHash}, kdf_salt = ${kdfSalt},
        kdf_iterations = ${BigInt(kdfIterations)}, identity_blob = ${identityBlob} WHERE id = ${id}`;
      await tx`DELETE FROM sessions ON SELECT token_hash FROM sessions VIEW by_doctor WHERE doctor_id = ${id}`;
    });
  }

  async invite(code: string): Promise<{ code: string; used_by: string | null } | undefined> {
    return first(this.sql`SELECT code, used_by FROM invites WHERE code = ${code}`);
  }

  async createInvite(code: string, at: string): Promise<void> {
    await this.sql`INSERT INTO invites (code, created_at) VALUES (${code}, ${at})`;
  }

  async plainInvites(): Promise<string[]> {
    return (
      await rows<{ code: string }>(
        this.sql`SELECT code FROM invites WHERE NOT StartsWith(code, 'h1:')`,
      )
    ).map((row) => row.code);
  }

  async rekeyInvite(code: string, key: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const row = await first<{ created_at: string; used_by: string | null }>(
        tx`SELECT created_at, used_by FROM invites WHERE code = ${code}`,
      );
      if (!row) return;
      await tx`UPSERT INTO invites (code, created_at, used_by) VALUES (${key}, ${row.created_at}, ${maybe(row.used_by)})`;
      await tx`DELETE FROM invites WHERE code = ${code}`;
    });
  }

  async createSession(tokenHash: string, doctorId: string, expiresAt: string): Promise<void> {
    await this
      .sql`INSERT INTO sessions (token_hash, doctor_id, expires_at) VALUES (${tokenHash}, ${doctorId}, ${expiresAt})`;
  }

  async session(tokenHash: string): Promise<{ doctor_id: string; expires_at: string } | undefined> {
    return first(
      this.sql`SELECT doctor_id, expires_at FROM sessions WHERE token_hash = ${tokenHash}`,
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
  }

  async deviceByToken(
    tokenHash: string,
  ): Promise<{ id: string; patient_id: string; kind: DiaryDeviceKind } | undefined> {
    return first(
      this.sql`SELECT id, patient_id, COALESCE(kind, 'patient') AS kind FROM devices VIEW by_token
        WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`,
    );
  }

  async touchDevice(id: string, at: string): Promise<void> {
    await this.sql`UPDATE devices SET last_seen_at = ${at} WHERE id = ${id}`;
  }

  async lastSeen(patientId: string): Promise<string | undefined> {
    const row = await first<{ at: string | null }>(
      this
        .sql`SELECT MAX(last_seen_at) AS at FROM devices VIEW by_patient WHERE patient_id = ${patientId}
          AND revoked_at IS NULL AND COALESCE(kind, 'patient') = 'patient'`,
    );
    return row?.at ?? undefined;
  }

  async activeDevices(patientId: string): Promise<DeviceRow[]> {
    return rows<DeviceRow>(
      this
        .sql`SELECT id, COALESCE(kind, 'patient') AS kind, identity_wrap, identity_sign, created_at,
          last_seen_at FROM devices VIEW by_patient WHERE patient_id = ${patientId} AND revoked_at IS NULL`,
    );
  }

  async deviceSign(deviceId: string, patientId: string): Promise<string | undefined> {
    return (
      await first<{ identity_sign: string }>(
        this
          .sql`SELECT identity_sign FROM devices WHERE id = ${deviceId} AND patient_id = ${patientId}`,
      )
    )?.identity_sign;
  }

  async revokeDevice(deviceId: string, patientId: string, at: string): Promise<void> {
    await this
      .sql`UPDATE devices SET revoked_at = ${at} WHERE id = ${deviceId} AND patient_id = ${patientId}`;
  }

  async createPairing(
    secretHash: string,
    patientId: string,
    sealedKeys: string,
    expiresAt: string,
    kind: DiaryDeviceKind,
  ): Promise<void> {
    await this.sql`INSERT INTO pairings (secret_hash, patient_id, sealed_keys, expires_at, kind)
      VALUES (${secretHash}, ${patientId}, ${sealedKeys}, ${expiresAt}, ${kind})`;
  }

  async pairing(
    secretHash: string,
  ): Promise<
    | { patient_id: string; sealed_keys: string; expires_at: string; kind: DiaryDeviceKind }
    | undefined
  > {
    return first(
      this.sql`SELECT patient_id, sealed_keys, expires_at, COALESCE(kind, 'patient') AS kind
        FROM pairings WHERE secret_hash = ${secretHash}`,
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
      kind: DiaryDeviceKind;
    },
    secretHash: string,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`INSERT INTO devices (id, patient_id, token_hash, identity_wrap, identity_sign, created_at, kind)
        VALUES (${device.id}, ${device.patient_id}, ${device.token_hash}, ${device.identity_wrap},
          ${device.identity_sign}, ${device.created_at}, ${device.kind})`;
      await tx`DELETE FROM pairings WHERE secret_hash = ${secretHash}`;
    });
  }

  async patient(id: string): Promise<PatientRow | undefined> {
    return first<PatientRow>(this.sql`SELECT * FROM patients WHERE id = ${id}`);
  }

  async createPatient(id: string, ownerId: string, key: KeyRow, at: string): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        await tx`INSERT INTO patients (id, owner_id, epoch, status, created_at)
          VALUES (${id}, ${ownerId}, ${BigInt(1)}, ${'active'}, ${at})`;
        await tx`INSERT INTO members (patient_id, doctor_id, role, status, added_at)
          VALUES (${id}, ${ownerId}, ${'owner'}, ${'active'}, ${at})`;
        await tx`INSERT INTO patient_keys (patient_id, epoch, recipient, wrapped)
          VALUES (${id}, ${BigInt(key.epoch)}, ${key.recipient}, ${key.wrapped})`;
      });
    } catch (cause) {
      if (isKeyConflict(cause)) throw new StoreConflict('patient');
      throw cause;
    }
  }

  async deletePatient(id: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const devices = (
        await rows<{ id: string }>(
          tx`SELECT id FROM devices VIEW by_patient WHERE patient_id = ${id}`,
        )
      ).map((row) => row.id);
      if (devices.length) await tx`DELETE FROM reminders WHERE device_id IN ${devices}`;
      await tx`DELETE FROM devices ON SELECT id FROM devices VIEW by_patient WHERE patient_id = ${id}`;
      await tx`DELETE FROM pairings ON SELECT secret_hash FROM pairings VIEW by_patient WHERE patient_id = ${id}`;
      await tx`DELETE FROM alerts ON SELECT id FROM alerts VIEW by_patient WHERE patient_id = ${id}`;
      await tx`DELETE FROM dose_checks WHERE patient_id = ${id}`;
      await tx`DELETE FROM records WHERE patient_id = ${id}`;
      await tx`DELETE FROM record_revisions WHERE patient_id = ${id}`;
      await tx`DELETE FROM patient_keys WHERE patient_id = ${id}`;
      await tx`DELETE FROM members WHERE patient_id = ${id}`;
      await tx`DELETE FROM patients WHERE id = ${id}`;
    });
  }

  async patientsOf(
    doctorId: string,
  ): Promise<(PatientRow & { role: DiaryRole; member_status: string })[]> {
    return rows(
      this.sql`SELECT p.id AS id, p.owner_id AS owner_id, p.epoch AS epoch, p.status AS status,
          p.created_at AS created_at, m.role AS role, m.status AS member_status
        FROM members VIEW by_doctor AS m JOIN patients AS p ON p.id = m.patient_id
        WHERE m.doctor_id = ${doctorId} ORDER BY created_at DESC`,
    );
  }

  async counts(patientId: string): Promise<PatientCounts> {
    const [last = {}, alerts = {}, devices = {}] = (
      await this
        .sql`SELECT MAX(seq) AS seq, MAX(at) AS at FROM records WHERE patient_id = ${patientId};
        SELECT COUNT(*) AS n FROM alerts VIEW by_patient WHERE patient_id = ${patientId} AND acked_at IS NULL;
        SELECT COUNT_IF(COALESCE(kind, 'patient') = 'patient') AS patients,
          COUNT_IF(kind = 'carer') AS carers
          FROM devices VIEW by_patient WHERE patient_id = ${patientId} AND revoked_at IS NULL;`
    ).map((set) => (set[0] ?? {}) as Record<string, unknown>);
    return {
      lastSeq: Number(last['seq'] ?? 0),
      lastRecordAt: (last['at'] as string | null | undefined) ?? null,
      openAlerts: Number(alerts['n'] ?? 0),
      devices: Number(devices['patients'] ?? 0),
      carers: Number(devices['carers'] ?? 0),
    };
  }

  async serviceStats(since7: string, since30: string): Promise<ServiceStatsRaw> {
    // Aggregates only: records are grouped by patient (the body column is never selected) and the
    // other tables are small. Times are ISO strings, so text comparison orders them.
    const doctors = await rows<ServiceStatsRaw['doctors'][number]>(
      this.sql`SELECT id, email, name, created_at FROM doctors`,
    );
    const patients = await rows<ServiceStatsRaw['patients'][number]>(
      this.sql`SELECT id, status, created_at FROM patients`,
    );
    const members = await rows<ServiceStatsRaw['members'][number]>(
      this.sql`SELECT patient_id, doctor_id FROM members WHERE status = 'active'`,
    );
    const records = await rows<ServiceStatsRaw['records'][number]>(
      this.sql`SELECT patient_id, COUNT(*) AS total, COUNT_IF(at >= ${since7}) AS last7,
          COUNT_IF(at >= ${since30}) AS last30, MAX(at) AS last_at
        FROM records GROUP BY patient_id`,
    );
    const devices = await rows<ServiceStatsRaw['devices'][number]>(
      this.sql`SELECT patient_id, COUNT_IF(COALESCE(kind, 'patient') = 'patient') AS phones,
          COUNT_IF(kind = 'carer') AS carers
        FROM devices WHERE revoked_at IS NULL GROUP BY patient_id`,
    );
    const [alerts] = await rows<ServiceStatsRaw['alerts']>(
      this.sql`SELECT COUNT(*) AS total, COUNT_IF(acked_at IS NULL) AS open FROM alerts`,
    );
    const totals = await rows<DoctorTotalsRow>(
      this.sql`SELECT doctor_id, diaries, prescriptions, done7, total7, done30, total30, at
        FROM doctor_totals`,
    );
    return {
      doctors,
      patients,
      members,
      records,
      devices,
      alerts: alerts ?? { total: 0, open: 0 },
      totals,
    };
  }

  async putDoctorTotals(doctorId: string, totals: DiaryDoctorTotals, at: string): Promise<void> {
    await this.sql`UPSERT INTO doctor_totals
      (doctor_id, diaries, prescriptions, done7, total7, done30, total30, at)
      VALUES (${doctorId}, ${BigInt(totals.diaries)}, ${BigInt(totals.prescriptions)},
        ${BigInt(totals.adherence7.done)}, ${BigInt(totals.adherence7.total)},
        ${BigInt(totals.adherence30.done)}, ${BigInt(totals.adherence30.total)}, ${at})`;
  }

  async membership(patientId: string, doctorId: string): Promise<MemberRow | undefined> {
    return first<MemberRow>(
      this
        .sql`SELECT role, status FROM members WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}`,
    );
  }

  async activeDoctors(patientId: string): Promise<string[]> {
    return (
      await rows<{ doctor_id: string }>(
        this
          .sql`SELECT doctor_id FROM members WHERE patient_id = ${patientId} AND status = 'active'`,
      )
    ).map((row) => row.doctor_id);
  }

  async memberDoctors(patientId: string): Promise<string[]> {
    return (
      await rows<{ doctor_id: string }>(
        this.sql`SELECT doctor_id FROM members WHERE patient_id = ${patientId}`,
      )
    ).map((row) => row.doctor_id);
  }

  async members(patientId: string): Promise<(DoctorRow & MemberRow & { added_at: string })[]> {
    return rows(
      this.sql`SELECT d.id AS id, d.email AS email, d.name AS name, d.auth_hash AS auth_hash,
          d.kdf_salt AS kdf_salt, d.kdf_iterations AS kdf_iterations, d.identity_wrap AS identity_wrap,
          d.identity_sign AS identity_sign, d.identity_blob AS identity_blob,
          d.recovery_hash AS recovery_hash, d.recovery_blob AS recovery_blob, d.created_at AS created_at,
          m.role AS role, m.status AS status, m.added_at AS added_at
        FROM members AS m JOIN doctors AS d ON d.id = m.doctor_id
        WHERE m.patient_id = ${patientId} ORDER BY added_at`,
    );
  }

  async inviteMember(
    patientId: string,
    doctorId: string,
    role: DiaryRole,
    at: string,
    keys: readonly KeyRow[],
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const existing = await first(
        tx`SELECT role FROM members WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}`,
      );
      if (existing) {
        await tx`UPDATE members SET role = ${role} WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}`;
      } else {
        await tx`INSERT INTO members (patient_id, doctor_id, role, status, added_at)
          VALUES (${patientId}, ${doctorId}, ${role}, ${'pending'}, ${at})`;
      }
      for (const key of keys) {
        await tx`UPSERT INTO patient_keys (patient_id, epoch, recipient, wrapped)
          VALUES (${patientId}, ${BigInt(key.epoch)}, ${key.recipient}, ${key.wrapped})`;
      }
    });
  }

  async acceptMember(patientId: string, doctorId: string): Promise<void> {
    await this
      .sql`UPDATE members SET status = 'active' WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}`;
  }

  async setRole(patientId: string, doctorId: string, role: DiaryRole): Promise<void> {
    await this
      .sql`UPDATE members SET role = ${role} WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}`;
  }

  async removeMember(patientId: string, doctorId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM members WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}`;
      await tx`DELETE FROM patient_keys WHERE patient_id = ${patientId} AND recipient = ${`d:${doctorId}`}`;
      // Pairings carry no issuer: unused codes of the diary go with any removed curator (SEC-AUDIT1).
      await tx`DELETE FROM pairings ON SELECT secret_hash FROM pairings VIEW by_patient WHERE patient_id = ${patientId}`;
    });
  }

  async transferOwner(patientId: string, fromDoctorId: string, toDoctorId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`UPDATE members SET role = 'editor' WHERE patient_id = ${patientId} AND doctor_id = ${fromDoctorId}`;
      await tx`UPDATE members SET role = 'owner' WHERE patient_id = ${patientId} AND doctor_id = ${toDoctorId}`;
      await tx`UPDATE patients SET owner_id = ${toDoctorId} WHERE id = ${patientId}`;
    });
  }

  async keysFor(patientId: string, recipient: string): Promise<KeyRow[]> {
    return rows<KeyRow>(
      this.sql`SELECT epoch, recipient, wrapped FROM patient_keys
        WHERE patient_id = ${patientId} AND recipient = ${recipient} ORDER BY epoch`,
    );
  }

  async addEpoch(patientId: string, epoch: number, keys: readonly KeyRow[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const key of keys) {
        await tx`INSERT INTO patient_keys (patient_id, epoch, recipient, wrapped)
          VALUES (${patientId}, ${BigInt(key.epoch)}, ${key.recipient}, ${key.wrapped})`;
      }
      await tx`UPDATE patients SET epoch = ${BigInt(epoch)} WHERE id = ${patientId}`;
    });
  }

  async records(patientId: string, after: number, limit: number): Promise<RecordRow[]> {
    return rows<RecordRow>(
      this.sql`SELECT seq, id, rev, epoch, author, body, sig, at FROM records
        WHERE patient_id = ${patientId} AND seq > ${BigInt(after)} ORDER BY seq LIMIT ${limit}`,
    );
  }

  async insertRecords(
    patientId: string,
    records: readonly NewRecord[],
    at: string,
  ): Promise<number[]> {
    try {
      return await this.sql.begin(async (tx) => {
        const seqs: number[] = [];
        for (const record of records) {
          await tx`INSERT INTO record_revisions (patient_id, id, rev)
            VALUES (${patientId}, ${record.id}, ${BigInt(record.rev)})`;
          const row = await first<{ seq: number }>(
            tx`INSERT INTO records (patient_id, id, rev, epoch, author, body, sig, at)
              VALUES (${patientId}, ${record.id}, ${BigInt(record.rev)}, ${BigInt(record.epoch)},
                ${record.author}, ${record.body}, ${record.sig}, ${at}) RETURNING seq`,
          );
          seqs.push(Number(row?.seq));
        }
        return seqs;
      });
    } catch (cause) {
      if (isKeyConflict(cause)) throw new StoreConflict('record');
      throw cause;
    }
  }

  async authors(patientId: string): Promise<string[]> {
    return (
      await rows<{ author: string }>(
        this.sql`SELECT DISTINCT author FROM records WHERE patient_id = ${patientId}`,
      )
    ).map((row) => row.author);
  }

  async addAlert(patientId: string, kind: AlertRow['kind'], at: string): Promise<number> {
    const row = await first<{ id: number }>(
      this
        .sql`INSERT INTO alerts (patient_id, kind, at) VALUES (${patientId}, ${kind}, ${at}) RETURNING id`,
    );
    return Number(row?.id);
  }

  async openAlertsFor(doctorId: string, limit: number): Promise<AlertRow[]> {
    return rows<AlertRow>(
      this.sql`SELECT a.id AS id, a.patient_id AS patient_id, a.kind AS kind, a.at AS at
        FROM members VIEW by_doctor AS m JOIN alerts VIEW by_patient AS a ON a.patient_id = m.patient_id
        WHERE m.doctor_id = ${doctorId} AND m.status = 'active' AND a.acked_at IS NULL
        ORDER BY at DESC LIMIT ${limit}`,
    );
  }

  async alertPatient(id: number): Promise<string | undefined> {
    return (
      await first<{ patient_id: string }>(
        this.sql`SELECT patient_id FROM alerts WHERE id = ${BigInt(id)}`,
      )
    )?.patient_id;
  }

  async ackAlert(id: number, at: string): Promise<void> {
    await this.sql`UPDATE alerts SET acked_at = ${at} WHERE id = ${BigInt(id)}`;
  }

  async withdraw(patientId: string, at: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM records WHERE patient_id = ${patientId}`;
      await tx`DELETE FROM record_revisions WHERE patient_id = ${patientId}`;
      await tx`DELETE FROM pairings ON SELECT secret_hash FROM pairings VIEW by_patient WHERE patient_id = ${patientId}`;
      await tx`DELETE FROM dose_checks WHERE patient_id = ${patientId}`;
      await tx`DELETE FROM patient_keys WHERE patient_id = ${patientId} AND StartsWith(recipient, 'p:')`;
      await tx`UPDATE devices ON SELECT id, ${at} AS revoked_at FROM devices VIEW by_patient
        WHERE patient_id = ${patientId} AND revoked_at IS NULL`;
      await tx`UPDATE patients SET status = 'withdrawn' WHERE id = ${patientId}`;
      await tx`INSERT INTO alerts (patient_id, kind, at) VALUES (${patientId}, 'withdrawn', ${at})`;
    });
  }

  async pushTargets(owners: readonly string[]): Promise<PushTarget[]> {
    if (!owners.length) return [];
    return rows<PushTarget>(
      this
        .sql`SELECT endpoint, p256dh, auth FROM push_subscriptions VIEW by_owner WHERE owner IN ${[...owners]}`,
    );
  }

  async savePushSubscription(
    endpoint: string,
    owner: string,
    at: string,
    p256dh: string | null,
    auth: string | null,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const existing = await first(
        tx`SELECT endpoint FROM push_subscriptions WHERE endpoint = ${endpoint}`,
      );
      if (existing) {
        await tx`UPDATE push_subscriptions SET owner = ${owner}, p256dh = ${maybe(p256dh)}, auth = ${maybe(auth)}
          WHERE endpoint = ${endpoint}`;
      } else {
        await tx`INSERT INTO push_subscriptions (endpoint, owner, created_at, p256dh, auth)
          VALUES (${endpoint}, ${owner}, ${at}, ${maybe(p256dh)}, ${maybe(auth)})`;
      }
    });
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await this.sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  }

  async bumpChanges(owners: readonly string[]): Promise<void> {
    if (!owners.length) return;
    await this.sql.begin(async (tx) => {
      for (const owner of new Set(owners)) {
        await tx`UPSERT INTO changes (owner, n)
          SELECT ${owner} AS owner, COALESCE(MAX(n), 0) + 1 AS n FROM changes WHERE owner = ${owner}`;
      }
    });
  }

  async changes(owner: string): Promise<number> {
    return Number(
      (await first<{ n: number }>(this.sql`SELECT n FROM changes WHERE owner = ${owner}`))?.n ?? 0,
    );
  }

  async replaceReminders(deviceId: string, moments: readonly string[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM reminders WHERE device_id = ${deviceId}`;
      for (const at of moments)
        await tx`INSERT INTO reminders (device_id, at) VALUES (${deviceId}, ${at})`;
    });
  }

  async takeDueReminders(at: string): Promise<{ device_id: string; at: string }[]> {
    return this.sql.begin(async (tx) => {
      const due = await rows<{ device_id: string; at: string }>(
        tx`SELECT r.device_id AS device_id, r.at AS at FROM reminders AS r
          JOIN devices AS d ON d.id = r.device_id
          WHERE r.at <= ${at} AND d.revoked_at IS NULL ORDER BY at`,
      );
      await tx`DELETE FROM reminders WHERE at <= ${at}`;
      return due;
    });
  }

  async replaceDoseChecks(
    patientId: string,
    moments: readonly string[],
    after: string,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM dose_checks
        WHERE patient_id = ${patientId} AND at > ${after} AND state = 'open'`;
      for (const at of moments)
        await tx`UPSERT INTO dose_checks (patient_id, at, state) VALUES (${patientId}, ${at}, 'open')`;
    });
  }

  async markDosesTaken(patientId: string, moments: readonly string[]): Promise<void> {
    if (!moments.length) return;
    await this.sql.begin(async (tx) => {
      for (const at of moments)
        await tx`UPSERT INTO dose_checks (patient_id, at, state) VALUES (${patientId}, ${at}, 'taken')`;
    });
  }

  async takeMissedDoses(due: string, stale: string): Promise<DoseCheckRow[]> {
    return this.sql.begin(async (tx) => {
      const missed = await rows<DoseCheckRow>(
        tx`SELECT patient_id, at FROM dose_checks
          WHERE state = 'open' AND at <= ${due} AND at > ${stale} ORDER BY at`,
      );
      await tx`DELETE FROM dose_checks WHERE state = 'open' AND at <= ${due}`;
      await tx`DELETE FROM dose_checks WHERE state = 'taken' AND at <= ${stale}`;
      return missed;
    });
  }
}
