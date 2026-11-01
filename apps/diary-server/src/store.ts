/**
 * The diary service's storage port (ADR-0027). The HTTP app talks only to this interface; the
 * `server` mode keeps it in SQLite (`sqlite-store.ts`), the `serverless` mode in YDB
 * (`ydb-store.ts`). Every method is one consistent step: the multi-row ones run in one transaction.
 * Record bodies, identity blobs and wrapped keys are ciphertext; what is plain is ADR-0026 §7.
 */
import type { DiaryRole } from '@localmed/contracts';

/** A unique key already exists (e-mail, patient id, record id + revision). */
export class StoreConflict extends Error {
  constructor(message = 'conflict') {
    super(message);
    this.name = 'StoreConflict';
  }
}

export interface DoctorRow {
  id: string;
  email: string;
  name: string;
  auth_hash: string;
  kdf_salt: string;
  kdf_iterations: number;
  identity_wrap: string;
  identity_sign: string;
  identity_blob: string;
  recovery_hash: string;
  recovery_blob: string;
  created_at: string;
}

export interface PatientRow {
  id: string;
  owner_id: string;
  epoch: number;
  status: string;
  created_at: string;
}

export interface KeyRow {
  epoch: number;
  recipient: string;
  wrapped: string;
}

export interface DeviceRow {
  id: string;
  identity_wrap: string;
  identity_sign: string;
  created_at: string;
  last_seen_at: string | null;
}

export interface MemberRow {
  role: DiaryRole;
  status: string;
}

export interface RecordRow {
  seq: number;
  id: string;
  rev: number;
  epoch: number;
  author: string;
  body: string;
  sig: string;
  at: string;
}

export interface NewRecord {
  id: string;
  rev: number;
  epoch: number;
  author: string;
  body: string;
  sig: string;
}

export interface AlertRow {
  id: number;
  patient_id: string;
  kind: 'urgent' | 'withdrawn';
  at: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

export interface PatientCounts {
  lastSeq: number;
  lastRecordAt: string | null;
  openAlerts: number;
  devices: number;
}

export interface DiaryStore {
  setting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  /** Records one attempt under `key`; false (and nothing recorded) when `limit` were made within `windowMs`. */
  attempt(key: string, windowMs: number, limit: number): Promise<boolean>;

  doctorById(id: string): Promise<DoctorRow | undefined>;
  doctorByEmail(email: string): Promise<DoctorRow | undefined>;
  /** StoreConflict when the e-mail is taken; marks the invite used in the same step. */
  createDoctor(row: DoctorRow, inviteCode?: string): Promise<void>;
  /** New password material; every session of the doctor ends. */
  resetDoctorAuth(
    id: string,
    authHash: string,
    kdfSalt: string,
    kdfIterations: number,
    identityBlob: string,
  ): Promise<void>;
  invite(code: string): Promise<{ code: string; used_by: string | null } | undefined>;
  createInvite(code: string, at: string): Promise<void>;

  createSession(tokenHash: string, doctorId: string, expiresAt: string): Promise<void>;
  session(tokenHash: string): Promise<{ doctor_id: string; expires_at: string } | undefined>;
  deleteSession(tokenHash: string): Promise<void>;

  /** An active (not revoked) device by its token hash. */
  deviceByToken(tokenHash: string): Promise<{ id: string; patient_id: string } | undefined>;
  touchDevice(id: string, at: string): Promise<void>;
  /** Latest `last_seen_at` of the patient's active devices. */
  lastSeen(patientId: string): Promise<string | undefined>;
  activeDevices(patientId: string): Promise<DeviceRow[]>;
  /** Signing key of a device of this patient, revoked ones included (old records stay verifiable). */
  deviceSign(deviceId: string, patientId: string): Promise<string | undefined>;
  revokeDevice(deviceId: string, patientId: string, at: string): Promise<void>;

  createPairing(
    secretHash: string,
    patientId: string,
    sealedKeys: string,
    expiresAt: string,
  ): Promise<void>;
  pairing(
    secretHash: string,
  ): Promise<{ patient_id: string; sealed_keys: string; expires_at: string } | undefined>;
  /** Adds the device and deletes the one-time pairing in the same step. */
  pairDevice(
    device: {
      id: string;
      patient_id: string;
      token_hash: string;
      identity_wrap: string;
      identity_sign: string;
      created_at: string;
    },
    secretHash: string,
  ): Promise<void>;

  patient(id: string): Promise<PatientRow | undefined>;
  /** Patient, owner membership and the owner's first key; StoreConflict when the id exists. */
  createPatient(id: string, ownerId: string, key: KeyRow, at: string): Promise<void>;
  /** The patient and everything under it. */
  deletePatient(id: string): Promise<void>;
  patientsOf(
    doctorId: string,
  ): Promise<(PatientRow & { role: DiaryRole; member_status: string })[]>;
  counts(patientId: string): Promise<PatientCounts>;

  membership(patientId: string, doctorId: string): Promise<MemberRow | undefined>;
  activeDoctors(patientId: string): Promise<string[]>;
  /** Every member doctor, pending ones included. */
  memberDoctors(patientId: string): Promise<string[]>;
  members(patientId: string): Promise<(DoctorRow & MemberRow & { added_at: string })[]>;
  /** Pending membership (role updated when it exists) plus the doctor's keys. */
  inviteMember(
    patientId: string,
    doctorId: string,
    role: DiaryRole,
    at: string,
    keys: readonly KeyRow[],
  ): Promise<void>;
  acceptMember(patientId: string, doctorId: string): Promise<void>;
  setRole(patientId: string, doctorId: string, role: DiaryRole): Promise<void>;
  /** The membership and the doctor's keys of this patient. */
  removeMember(patientId: string, doctorId: string): Promise<void>;
  /** The old owner becomes an editor. */
  transferOwner(patientId: string, fromDoctorId: string, toDoctorId: string): Promise<void>;

  keysFor(patientId: string, recipient: string): Promise<KeyRow[]>;
  /** The new epoch's keys and the patient's epoch number. */
  addEpoch(patientId: string, epoch: number, keys: readonly KeyRow[]): Promise<void>;

  records(patientId: string, after: number, limit: number): Promise<RecordRow[]>;
  /** Server sequence numbers in order; StoreConflict when an id + revision exists (nothing stored). */
  insertRecords(patientId: string, records: readonly NewRecord[], at: string): Promise<number[]>;
  authors(patientId: string): Promise<string[]>;

  addAlert(patientId: string, kind: AlertRow['kind'], at: string): Promise<number>;
  openAlertsFor(doctorId: string, limit: number): Promise<AlertRow[]>;
  alertPatient(id: number): Promise<string | undefined>;
  ackAlert(id: number, at: string): Promise<void>;
  /** Consent withdrawn: records, pairings and device keys deleted, devices revoked, a withdrawn alert. */
  withdraw(patientId: string, at: string): Promise<void>;

  pushTargets(owners: readonly string[]): Promise<PushTarget[]>;
  savePushSubscription(
    endpoint: string,
    owner: string,
    at: string,
    p256dh: string | null,
    auth: string | null,
  ): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;

  replaceReminders(deviceId: string, moments: readonly string[]): Promise<void>;
  /** Reminders at or before `at` of active devices, oldest first; all reminders up to `at` are forgotten. */
  takeDueReminders(at: string): Promise<{ device_id: string; at: string }[]>;
}

export function now(): string {
  return new Date().toISOString();
}
