/**
 * The doctor's connected diaries: every patient the doctor curates, decrypted on this device.
 * Creates patients and pairing codes, writes plans, profiles and corrections, manages curators
 * and rotates the patient's key after a removal (ADR-0026 §5). No Solid here: the dashboard
 * subscribes to changes.
 */
import type {
  DiaryAlert,
  DiaryPatientDetail,
  DiaryPatientSummary,
  DiaryRole,
  DiaryWrappedKey,
} from '@localmed/contracts';
import {
  newDataKey,
  newPairingSecret,
  publicIdentity,
  randomId,
  sealPairingKeys,
  sha256,
  unwrapDataKey,
  wrapDataKey,
} from '@localmed/diary-sync';

import { diaryAlerts, diaryDoctors, diaryPatients } from '@/features/diary/connected/diary-api';
import {
  applyRevisions,
  type DiaryProfile,
  type DiaryReplica,
  EMPTY_REPLICA,
  entryRecordId,
  PLAN_RECORD,
  PROFILE_RECORD,
} from '@/features/diary/connected/diary-replica';
import { DiarySession, type Keyring } from '@/features/diary/connected/diary-session';
import { type DoctorSession, doctorApi } from '@/features/diary/connected/doctor-account';
import { pairingLink } from '@/features/diary/connected/patient-connection';
import { connectedDiaryPageUrl, diaryServiceBase } from '@/features/diary/diary-links';
import type { DiaryEntry, DiaryInvitation } from '@/features/diary/diary-model';

export interface DoctorPatient {
  readonly summary: DiaryPatientSummary;
  readonly replica: DiaryReplica;
  /** Records this device could not verify or decrypt. */
  readonly refused: number;
}

type Listener = () => void;

export class DoctorDiaries {
  private readonly api;
  private readonly entries = new Map<string, DoctorPatient>();
  private readonly sessions = new Map<string, DiarySession>();
  private readonly listeners = new Set<Listener>();
  private alertList: readonly DiaryAlert[] = [];
  private events: EventSource | undefined;
  private loaded = false;

  constructor(readonly session: DoctorSession) {
    this.api = doctorApi(session);
  }

  get doctorId(): string {
    return this.session.doctor.id;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  patients(): readonly DoctorPatient[] {
    return [...this.entries.values()].toSorted((left, right) => {
      if (left.summary.openAlerts !== right.summary.openAlerts) {
        return right.summary.openAlerts - left.summary.openAlerts;
      }
      return (right.summary.lastRecordAt ?? right.summary.createdAt).localeCompare(
        left.summary.lastRecordAt ?? left.summary.createdAt,
      );
    });
  }

  patient(id: string): DoctorPatient | undefined {
    return this.entries.get(id);
  }

  alerts(): readonly DiaryAlert[] {
    return this.alertList;
  }

  private async keyring(summary: DiaryPatientSummary): Promise<Keyring> {
    const keys = new Map<number, Uint8Array<ArrayBuffer>>();
    for (const key of summary.keys) {
      keys.set(key.epoch, await unwrapDataKey(key.wrapped, this.session.identity.wrap.privateKey));
    }
    return { keys, current: summary.epoch };
  }

  private async sessionFor(summary: DiaryPatientSummary): Promise<DiarySession> {
    const existing = this.sessions.get(summary.id);
    const keyring = await this.keyring(summary);
    if (existing) {
      existing.setKeyring(keyring);
      return existing;
    }
    const session = new DiarySession(
      this.api,
      summary.id,
      `d:${this.doctorId}`,
      this.session.identity.sign.privateKey,
      keyring,
      undefined,
      async () => {
        const fresh = (await diaryPatients.list(this.api)).find((item) => item.id === summary.id);
        return fresh ? this.keyring(fresh) : keyring;
      },
    );
    this.sessions.set(summary.id, session);
    return session;
  }

  /** Pulls one patient's new records into its replica. */
  private async load(summary: DiaryPatientSummary): Promise<void> {
    const previous = this.entries.get(summary.id);
    if (summary.status === 'pending' || summary.status === 'withdrawn') {
      this.entries.set(summary.id, {
        summary,
        replica:
          summary.status === 'withdrawn' ? EMPTY_REPLICA : (previous?.replica ?? EMPTY_REPLICA),
        refused: 0,
      });
      if (summary.status === 'withdrawn') this.sessions.delete(summary.id);
      return;
    }
    const session = await this.sessionFor(summary);
    const pulled = await session.pull();
    this.entries.set(summary.id, {
      summary,
      replica: applyRevisions(previous?.replica ?? EMPTY_REPLICA, pulled.revisions),
      refused: (previous?.refused ?? 0) + pulled.refused,
    });
  }

  async refresh(): Promise<void> {
    const summaries = await diaryPatients.list(this.api);
    const seen = new Set(summaries.map((summary) => summary.id));
    for (const id of this.entries.keys()) if (!seen.has(id)) this.entries.delete(id);
    await Promise.all(summaries.map((summary) => this.load(summary)));
    this.alertList = await diaryAlerts.list(this.api);
    this.loaded = true;
    this.emit();
  }

  async refreshPatient(id: string): Promise<void> {
    const summary = (await diaryPatients.list(this.api)).find((item) => item.id === id);
    if (!summary) {
      this.entries.delete(id);
    } else {
      await this.load(summary);
    }
    this.alertList = await diaryAlerts.list(this.api);
    this.emit();
  }

  /** Live updates while the dashboard is open (server-sent events). */
  connectLive(): void {
    if (this.events || typeof EventSource === 'undefined') return;
    const url = `${diaryServiceBase()}/api/events?token=${encodeURIComponent(this.session.token)}`;
    const events = new EventSource(url);
    const onPatient = (event: MessageEvent<string>): void => {
      const data = JSON.parse(event.data) as { patientId?: string };
      const run = data.patientId ? this.refreshPatient(data.patientId) : this.refresh();
      run.catch((cause: unknown) => console.warn('Дневники: обновление не удалось', cause));
    };
    for (const name of ['records', 'alert', 'members', 'invite', 'device']) {
      events.addEventListener(name, onPatient as EventListener);
    }
    this.events = events;
  }

  disconnect(): void {
    this.events?.close();
    this.events = undefined;
  }

  private async write(
    patientId: string,
    items: readonly { readonly id: string; readonly payload: unknown }[],
  ): Promise<void> {
    const entry = this.entries.get(patientId);
    if (!entry) throw new Error('Пациент не найден.');
    const session = await this.sessionFor(entry.summary);
    const pulled = await session.push(items);
    const after = await session.pull();
    this.entries.set(patientId, {
      ...entry,
      replica: applyRevisions(entry.replica, [...pulled, ...after.revisions]),
    });
    this.emit();
  }

  /** A new patient: its own data key, the profile and the first plan. */
  async createPatient(
    profile: DiaryProfile,
    buildInvitation: (patientId: string) => DiaryInvitation,
  ): Promise<string> {
    const id = randomId(20);
    const key = newDataKey();
    const own = await publicIdentity(this.session.identity);
    const summary = await diaryPatients.create(this.api, id, {
      epoch: 1,
      recipient: `d:${this.doctorId}`,
      wrapped: await wrapDataKey(key, own.wrap),
    });
    this.entries.set(id, { summary, replica: EMPTY_REPLICA, refused: 0 });
    await this.write(id, [
      { id: PROFILE_RECORD, payload: { kind: 'profile', ...profile } },
      { id: PLAN_RECORD, payload: { kind: 'plan', invitation: buildInvitation(id) } },
    ]);
    return id;
  }

  writePlan(patientId: string, invitation: DiaryInvitation): Promise<void> {
    return this.write(patientId, [{ id: PLAN_RECORD, payload: { kind: 'plan', invitation } }]);
  }

  writeProfile(patientId: string, profile: DiaryProfile): Promise<void> {
    return this.write(patientId, [
      { id: PROFILE_RECORD, payload: { kind: 'profile', ...profile } },
    ]);
  }

  /** A correction: a new revision signed by the doctor; the patient sees it marked. */
  correctEntry(patientId: string, entry: DiaryEntry): Promise<void> {
    return this.write(patientId, [
      {
        id: entryRecordId(entry.id),
        payload: { kind: 'entry', entry: { ...entry, corrected: true } },
      },
    ]);
  }

  deleteEntry(patientId: string, entryId: string): Promise<void> {
    return this.write(patientId, [{ id: entryRecordId(entryId), payload: { kind: 'deleted' } }]);
  }

  /** A one-time code for the patient's phone, valid 72 hours. */
  async pairingLink(patientId: string): Promise<string> {
    const entry = this.entries.get(patientId);
    if (!entry) throw new Error('Пациент не найден.');
    const keyring = await this.keyring(entry.summary);
    const secret = newPairingSecret();
    await diaryPatients.pairing(
      this.api,
      patientId,
      await sha256(secret),
      await sealPairingKeys(keyring.keys, secret),
    );
    return pairingLink(connectedDiaryPageUrl(), { patientId, secret });
  }

  detail(patientId: string): Promise<DiaryPatientDetail> {
    return diaryPatients.detail(this.api, patientId);
  }

  async invite(patientId: string, email: string, role: Exclude<DiaryRole, 'owner'>): Promise<void> {
    const entry = this.entries.get(patientId);
    if (!entry) throw new Error('Пациент не найден.');
    const doctor = await diaryDoctors.lookup(this.api, email);
    if (doctor.id === this.doctorId) throw new Error('Это вы.');
    const keyring = await this.keyring(entry.summary);
    const keys: DiaryWrappedKey[] = [];
    for (const [epoch, key] of keyring.keys) {
      keys.push({
        epoch,
        recipient: `d:${doctor.id}`,
        wrapped: await wrapDataKey(key, doctor.identity.wrap),
      });
    }
    await diaryPatients.invite(this.api, patientId, doctor.id, role, keys);
  }

  async accept(patientId: string): Promise<void> {
    await diaryPatients.accept(this.api, patientId);
    await this.refreshPatient(patientId);
  }

  setRole(patientId: string, doctorId: string, role: Exclude<DiaryRole, 'owner'>) {
    return diaryPatients.setRole(this.api, patientId, doctorId, role);
  }

  async transfer(patientId: string, doctorId: string): Promise<void> {
    await diaryPatients.transfer(this.api, patientId, doctorId);
    await this.refreshPatient(patientId);
  }

  /** Removes a curator (or leaves, for oneself) and, as the owner, rotates the key. */
  async removeMember(patientId: string, doctorId: string): Promise<void> {
    await diaryPatients.removeMember(this.api, patientId, doctorId);
    if (doctorId === this.doctorId) {
      this.entries.delete(patientId);
      this.sessions.delete(patientId);
      this.emit();
      return;
    }
    await this.rotate(patientId);
  }

  async revokeDevice(patientId: string, deviceId: string): Promise<void> {
    await diaryPatients.revokeDevice(this.api, patientId, deviceId);
    if (this.entries.get(patientId)?.summary.role === 'owner') await this.rotate(patientId);
    else await this.refreshPatient(patientId);
  }

  /** A new epoch key wrapped for every remaining curator and device. */
  async rotate(patientId: string): Promise<void> {
    const entry = this.entries.get(patientId);
    if (!entry) throw new Error('Пациент не найден.');
    const detail = await this.detail(patientId);
    const key = newDataKey();
    const epoch = entry.summary.epoch + 1;
    const keys: DiaryWrappedKey[] = [];
    for (const member of detail.members) {
      keys.push({
        epoch,
        recipient: `d:${member.doctor.id}`,
        wrapped: await wrapDataKey(key, member.doctor.identity.wrap),
      });
    }
    for (const device of detail.devices) {
      keys.push({
        epoch,
        recipient: `p:${device.id}`,
        wrapped: await wrapDataKey(key, device.identity.wrap),
      });
    }
    await diaryPatients.rotate(this.api, patientId, epoch, keys);
    await this.refreshPatient(patientId);
  }

  async removePatient(patientId: string): Promise<void> {
    await diaryPatients.remove(this.api, patientId);
    this.entries.delete(patientId);
    this.sessions.delete(patientId);
    this.emit();
  }

  async ackAlert(id: number): Promise<void> {
    await diaryAlerts.ack(this.api, id);
    this.alertList = this.alertList.filter((alert) => alert.id !== id);
    this.emit();
  }
}
