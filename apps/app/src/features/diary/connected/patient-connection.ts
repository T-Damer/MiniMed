/**
 * The patient's side of a connected diary (ADR-0026): pairing the phone with the doctor's one-time
 * code, keeping the device's keys, and a sync that merges the doctor's plan and corrections into
 * the local diary store and sends the patient's marks. The local store stays the source the
 * screens read, so the diary keeps working offline; sync runs whenever there is a network.
 */
import type { DiaryDeviceKind, DiaryPatientDetail, DiaryWrappedKey } from '@localmed/contracts';
import {
  fromBase64Url,
  generateIdentity,
  newDataKey,
  openPairingKeys,
  pairingProof,
  publicIdentity,
  toBase64Url,
  unwrapDataKey,
  wrapDataKey,
} from '@localmed/diary-sync';

import {
  carerName,
  type DiaryPhone,
  diaryPhones,
  doseMoments,
  memberName,
  memberRecordId,
} from '@/features/diary/connected/carer';
import {
  createDiaryApi,
  type DiaryApi,
  DiaryApiError,
  diaryChanges,
  diaryDevice,
  diaryLiveMode,
  diaryPush,
  isOffline,
} from '@/features/diary/connected/diary-api';
import {
  CONSENT_RECORD,
  entryRecordId,
  PLAN_RECORD,
  tipReadRecordId,
} from '@/features/diary/connected/diary-replica';
import {
  DiarySession,
  type Keyring,
  type SessionState,
} from '@/features/diary/connected/diary-session';
import {
  pendingReminderActions,
  writeReminderNotices,
} from '@/features/diary/connected/reminder-cache';
import {
  JOINING_SET_VERSION,
  parseJoiningAcceptances,
} from '@/features/diary/consent/joining-documents';
import { CARE_DOSE_FIELD } from '@/features/diary/diary-care';
import { diaryServiceBase } from '@/features/diary/diary-links';
import { entryFingerprint } from '@/features/diary/diary-merge';
import {
  type DiaryEntry,
  DiaryFormatError,
  type DiaryInvitation,
  type DiaryPlanValue,
  describeDiaryEntry,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import {
  applyReminderAction,
  reminderMoments,
  reminderNotices,
  reminderSlots,
} from '@/features/diary/diary-reminders';
import {
  type DiaryRemoval,
  type DiaryStore,
  MAX_DIARY_REMOVALS,
  withEntry,
  withoutEntry,
} from '@/features/diary/diary-storage';
import { mergePlanChange, planChanges } from '@/features/diary/plan-changes';

const CONNECTION_PREFIX = 'minimed.diary.connection.v1.';
/** `poll` mode (ADR-0027): how often an open diary reads its change counter. */
const POLL_MS = 20_000;

/** What the address of a connected diary carries: the patient id and the one-time secret. */
export interface PairingLink {
  readonly patientId: string;
  readonly secret: string;
}

export function readPairingFragment(hash: string): PairingLink | undefined {
  const match = /^#c=([a-z0-9]{12,32})\.([A-Za-z0-9_-]{20,64})$/u.exec(hash.trim());
  return match ? { patientId: match[1] as string, secret: match[2] as string } : undefined;
}

export function pairingLink(base: string, link: PairingLink): string {
  return `${base}#c=${link.patientId}.${link.secret}`;
}

interface StoredIdentity {
  readonly wrap: JsonWebKey;
  readonly sign: JsonWebKey;
}

interface StoredConnection {
  readonly v: 1;
  readonly patientId: string;
  readonly deviceId: string;
  readonly token: string;
  readonly identity: StoredIdentity;
  /** Epoch → base64url data key. */
  readonly keys: Readonly<Record<string, string>>;
  readonly epoch: number;
  readonly session: SessionState;
  /** Record id → fingerprint of what the server has (entries) or `1` (consent, tip reads). */
  readonly synced: Readonly<Record<string, string>>;
  readonly pendingAlerts: number;
  readonly lastSyncAt?: string;
  readonly ended?: boolean;
  /** Dose and checkpoint reminders by push (on once notifications are allowed). */
  readonly reminders?: boolean;
  /** Medicine names in reminder texts (off: «Приём лекарств», for the lock screen). */
  readonly reminderNames?: boolean;
  /** The moments the server has, joined, so an unchanged list is not sent again. */
  readonly remindersSent?: string;
  /** A carer's phone (DIARY25); absent: the patient's own. */
  readonly kind?: 'carer';
  /** The name this carer's phone shows to the patient and the doctor. */
  readonly name?: string;
  /** Who has the diary, as last read: doctors and phones. */
  readonly detail?: DiaryPatientDetail;
  readonly detailAt?: string;
  /** Device id → the name a carer gave (their `member-` records). */
  readonly names?: Readonly<Record<string, string>>;
  /** Entry id → who wrote it, when that was not this phone (`p:<device>`, `d:<doctor>`). */
  readonly authors?: Readonly<Record<string, string>>;
}

export interface ReminderSettings {
  readonly on: boolean;
  readonly names: boolean;
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'ended';

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly lastSyncAt: string | undefined;
  /** Local changes the doctor does not have yet. */
  readonly pending: number;
  readonly message?: string;
}

/** Who has the diary is read again at least this often while it is open (and on every change). */
const PEOPLE_MS = 10 * 60_000;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

function read(storage: Storage, patientId: string): StoredConnection | undefined {
  const raw = storage.getItem(CONNECTION_PREFIX + patientId);
  if (!raw) return undefined;
  const value = JSON.parse(raw) as StoredConnection;
  return value.v === 1 ? value : undefined;
}

function write(storage: Storage, connection: StoredConnection): void {
  storage.setItem(CONNECTION_PREFIX + connection.patientId, JSON.stringify(connection));
}

export function isConnectedDiary(storage: Storage, diaryId: string): boolean {
  return storage.getItem(CONNECTION_PREFIX + diaryId) !== null;
}

function keyring(connection: StoredConnection): Keyring {
  return {
    keys: new Map(
      Object.entries(connection.keys).map(([epoch, key]) => [Number(epoch), fromBase64Url(key)]),
    ),
    current: connection.epoch,
  };
}

/**
 * The pending local changes: entries to send or delete, consent and tip reads. Nothing leaves the
 * phone before the patient has accepted the joining documents of a plan that asks for them.
 */
function outbox(store: DiaryStore, connection: StoredConnection) {
  const results = store.read(connection.patientId);
  const meta = store.meta(connection.patientId);
  const items: { id: string; payload: unknown; fingerprint: string }[] = [];
  if (results?.invitation.consent && !meta.consentAt) return items;
  const local = new Set<string>();
  for (const entry of results?.entries ?? []) {
    const id = entryRecordId(entry.id);
    local.add(id);
    const fingerprint = entryFingerprint(entry);
    if (connection.synced[id] !== fingerprint) {
      items.push({ id, payload: { kind: 'entry', entry }, fingerprint });
    }
  }
  for (const id of Object.keys(connection.synced)) {
    if (id.startsWith('e-') && !local.has(id) && connection.synced[id] !== 'deleted') {
      items.push({ id, payload: { kind: 'deleted' }, fingerprint: 'deleted' });
    }
  }
  // Consent is the patient's own: a carer's phone only reads it.
  if (meta.consentAt && !connection.synced[CONSENT_RECORD] && connection.kind !== 'carer') {
    items.push({
      id: CONSENT_RECORD,
      payload: {
        kind: 'consent',
        at: meta.consentAt,
        version: JOINING_SET_VERSION,
        documents: meta.consents ?? [],
      },
      fingerprint: '1',
    });
  }
  if (connection.kind === 'carer' && connection.name) {
    const id = memberRecordId(connection.deviceId);
    if (connection.synced[id] !== connection.name) {
      items.push({
        id,
        payload: { kind: 'member', name: connection.name },
        fingerprint: connection.name,
      });
    }
  }
  for (const tip of meta.tipsRead ?? []) {
    const id = tipReadRecordId(tip);
    if (!connection.synced[id]) {
      items.push({
        id,
        payload: { kind: 'tip-read', tip, at: new Date().toISOString() },
        fingerprint: '1',
      });
    }
  }
  return items;
}

export class PatientConnection {
  private readonly api: DiaryApi;
  private running: Promise<SyncStatus> | undefined;
  /** Who has the diary may have changed (opened, or the service said so): read it with the next sync. */
  private peopleStale = true;

  private constructor(
    private readonly storage: Storage,
    private readonly store: DiaryStore,
    private connection: StoredConnection,
    private readonly signKey: CryptoKey,
    private readonly wrapKey: CryptoKey,
  ) {
    this.api = createDiaryApi(() => this.connection.token, diaryServiceBase());
  }

  static async open(
    storage: Storage,
    store: DiaryStore,
    patientId: string,
  ): Promise<PatientConnection | undefined> {
    const connection = read(storage, patientId);
    if (!connection) return undefined;
    const signKey = await crypto.subtle.importKey('jwk', connection.identity.sign, ECDSA, false, [
      'sign',
    ]);
    const wrapKey = await crypto.subtle.importKey('jwk', connection.identity.wrap, ECDH, false, [
      'deriveBits',
    ]);
    return new PatientConnection(storage, store, connection, signKey, wrapKey);
  }

  /**
   * Pairs this phone with the doctor's code, then loads the plan. The code works once; the diary
   * opens offline afterwards from the local store.
   */
  static async pair(
    storage: Storage,
    store: DiaryStore,
    link: PairingLink,
  ): Promise<PatientConnection> {
    const existing = await PatientConnection.open(storage, store, link.patientId);
    if (existing) return existing;
    const identity = await generateIdentity(true);
    const api = createDiaryApi(() => undefined, diaryServiceBase());
    const paired = await diaryDevice.pair(
      api,
      link.patientId,
      await pairingProof(link.secret),
      await publicIdentity(identity),
    );
    const keys = await openPairingKeys(paired.keys, link.secret);
    const connection: StoredConnection = {
      v: 1,
      ...(paired.kind === 'carer' ? { kind: 'carer' as const } : {}),
      patientId: link.patientId,
      deviceId: paired.deviceId,
      token: paired.token,
      identity: {
        wrap: await crypto.subtle.exportKey('jwk', identity.wrap.privateKey),
        sign: await crypto.subtle.exportKey('jwk', identity.sign.privateKey),
      },
      keys: Object.fromEntries([...keys].map(([epoch, key]) => [String(epoch), toBase64Url(key)])),
      epoch: Math.max(...keys.keys()),
      session: { cursor: 0, revs: {} },
      synced: {},
      pendingAlerts: 0,
    };
    write(storage, connection);
    const opened = new PatientConnection(
      storage,
      store,
      connection,
      identity.sign.privateKey,
      identity.wrap.privateKey,
    );
    const status = await opened.sync();
    if (!store.read(link.patientId)) {
      throw new DiaryFormatError(
        status.message ?? 'Врач ещё не заполнил дневник. Откройте ссылку позже.',
      );
    }
    return opened;
  }

  get patientId(): string {
    return this.connection.patientId;
  }

  /** The patient's own phone or a carer's. */
  get kind(): DiaryDeviceKind {
    return this.connection.kind ?? 'patient';
  }

  get deviceId(): string {
    return this.connection.deviceId;
  }

  /** The name this carer's phone shows; empty until the carer gives one. */
  get name(): string {
    return this.connection.name ?? '';
  }

  /** The carer names this phone; the next sync tells the patient and the doctor. */
  setName(name: string): Promise<SyncStatus> {
    const clean = carerName(name);
    if (!clean) return Promise.resolve(this.status());
    this.save({ name: clean });
    return this.sync();
  }

  /** The phones with access as last read (this one included). */
  phones(): DiaryPhone[] {
    this.refresh();
    return diaryPhones(
      this.connection.detail,
      this.connection.names ?? {},
      this.connection.deviceId,
    );
  }

  /** The doctors with access as last read. */
  doctors(): DiaryPatientDetail['members'] {
    this.refresh();
    return this.connection.detail?.members ?? [];
  }

  /** Carers' names by device id, removed carers included (their old marks keep a name). */
  names(): Readonly<Record<string, string>> {
    return this.connection.names ?? {};
  }

  /** Who wrote an entry, when not this phone: `p:<device>` or `d:<doctor>`. */
  authorOf(entryId: string): string | undefined {
    return this.connection.authors?.[entryId];
  }

  private carers(): number {
    return (this.connection.detail?.devices ?? []).filter((device) => device.kind === 'carer')
      .length;
  }

  private async refreshPeople(force = false): Promise<void> {
    const at = this.connection.detailAt ? Date.parse(this.connection.detailAt) : 0;
    if (!force && !this.peopleStale && Date.now() - at < PEOPLE_MS) return;
    const detail = await diaryDevice.detail(this.api, this.patientId);
    this.peopleStale = false;
    this.save({ detail, detailAt: new Date().toISOString() });
  }

  /**
   * The patient's phone removes a carer and locks the diary with a new key wrapped for everyone
   * left (the owner does the same after removing a curator), so the removed phone's key opens
   * nothing written from now on. A carer's phone removing itself leaves the diary instead.
   */
  async removeCarer(deviceId: string): Promise<void> {
    await diaryDevice.removeCarer(this.api, deviceId);
    if (deviceId === this.connection.deviceId) {
      this.forget();
      return;
    }
    await this.rotate();
    await this.refreshPeople(true);
  }

  private async rotate(): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const current = await this.refreshKeys();
      const detail = await diaryDevice.detail(this.api, this.patientId);
      const key = newDataKey();
      const epoch = current.current + 1;
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
      try {
        await diaryDevice.rotate(this.api, this.patientId, epoch, keys);
        break;
      } catch (cause) {
        // Someone else rotated meanwhile (the doctor): read the keys again and lock once more.
        if (!(cause instanceof DiaryApiError && cause.status === 409) || attempt > 0) throw cause;
      }
    }
    await this.refreshKeys();
  }

  /** A carer leaves the diary: the service forgets this phone, and so does the phone. */
  leave(): Promise<void> {
    return this.removeCarer(this.connection.deviceId);
  }

  private forget(): void {
    this.storage.removeItem(CONNECTION_PREFIX + this.patientId);
    this.store.remove(this.patientId);
  }

  status(): SyncStatus {
    return {
      phase: this.connection.ended ? 'ended' : 'idle',
      lastSyncAt: this.connection.lastSyncAt,
      pending: outbox(this.store, this.connection).length + this.connection.pendingAlerts,
    };
  }

  /**
   * The stored state again: another tab of the same diary keeps its own copy, and writing back a
   * stale whole copy would undo what that tab saved (the reminder switches, for one).
   */
  private refresh(): void {
    const stored = read(this.storage, this.connection.patientId);
    if (stored) this.connection = stored;
  }

  private save(patch: Partial<StoredConnection>): void {
    this.refresh();
    this.connection = { ...this.connection, ...patch };
    write(this.storage, this.connection);
  }

  private async refreshKeys(): Promise<Keyring> {
    const answer = await diaryDevice.keys(this.api);
    const keys: Record<string, string> = { ...this.connection.keys };
    for (const key of answer.keys) {
      keys[String(key.epoch)] = toBase64Url(await unwrapDataKey(key.wrapped, this.wrapKey));
    }
    this.save({ keys, epoch: answer.epoch });
    return keyring(this.connection);
  }

  /** Applies what the server sent to the local store; local edits not yet sent are kept. */
  private apply(revisions: readonly { id: string; author: string; payload: unknown }[]): void {
    const synced = { ...this.connection.synced };
    const names = { ...this.connection.names };
    const authors = { ...this.connection.authors };
    const self = `p:${this.connection.deviceId}`;
    // The plan the phone had before this pull: a new plan is told against it once, however many
    // revisions the pull brings (a fresh phone has none, so it is told nothing).
    const planBefore = this.store.read(this.patientId)?.invitation;
    const removals: DiaryRemoval[] = [];
    const restored = new Set<string>();
    const ordered = [
      ...revisions.filter((revision) => revision.id === PLAN_RECORD),
      ...revisions.filter((revision) => revision.id !== PLAN_RECORD),
    ];
    for (const revision of ordered) {
      const payload = revision.payload as Record<string, unknown> | null;
      if (!payload || typeof payload !== 'object') continue;
      try {
        if (
          revision.id === PLAN_RECORD &&
          payload['kind'] === 'plan' &&
          revision.author.startsWith('d:')
        ) {
          const invitation = parseDiaryInvitation(payload['invitation']);
          if (invitation.id !== this.patientId) continue;
          this.store.open(invitation);
        } else if (revision.id.startsWith('e-')) {
          const results = this.store.read(this.patientId);
          if (!results) continue;
          const entryId = revision.id.slice(2);
          const local = results.entries.find((entry) => entry.id === entryId);
          const unchangedHere = !local || entryFingerprint(local) === synced[revision.id];
          if (payload['kind'] === 'deleted') {
            if (unchangedHere) {
              // The doctor's deletion stays visible to the patient: what it said and when.
              if (local && revision.author.startsWith('d:')) {
                const mark = local.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
                removals.push({
                  id: entryId,
                  at: local.at,
                  line: describeDiaryEntry(results.invitation, local),
                  ...(mark?.item ? { item: mark.item } : {}),
                  ...(mark?.slot ? { slot: mark.slot } : {}),
                  removedAt: new Date().toISOString(),
                });
              }
              this.store.save(withoutEntry(results, entryId));
              synced[revision.id] = 'deleted';
              delete authors[entryId];
            }
          } else if (payload['kind'] === 'entry' && unchangedHere) {
            restored.add(entryId);
            const entry: DiaryEntry = parseDiaryEntry(results.invitation, payload['entry']);
            if (entry.id !== entryId) continue;
            this.store.save(withEntry(withoutEntry(results, entryId), entry));
            synced[revision.id] = entryFingerprint(entry);
            if (revision.author === self) delete authors[entryId];
            else authors[entryId] = revision.author;
          }
        } else if (revision.id === CONSENT_RECORD && payload['kind'] === 'consent') {
          // Accepted on another phone of this patient: the documents count here too.
          if (typeof payload['at'] === 'string' && !this.store.meta(this.patientId).consentAt) {
            const consents = parseJoiningAcceptances(payload['documents']);
            this.store.setMeta(this.patientId, {
              consentAt: payload['at'],
              ...(consents.length ? { consents } : {}),
            });
          }
          synced[revision.id] = '1';
        } else if (revision.id.startsWith('member-')) {
          const name = memberName(revision.id, revision.author, payload);
          if (name) {
            names[revision.id.slice(7)] = name;
            synced[revision.id] = name;
          }
        } else if (revision.id.startsWith('read-') && payload['kind'] === 'tip-read') {
          const tip = payload['tip'];
          const read = this.store.meta(this.patientId).tipsRead ?? [];
          if (typeof tip === 'string' && !read.includes(tip)) {
            this.store.setMeta(this.patientId, { tipsRead: [...read, tip] });
          }
          synced[revision.id] = '1';
        }
      } catch (cause) {
        // A record this version cannot read is skipped; the next plan or app update may read it.
        if (!(cause instanceof DiaryFormatError)) throw cause;
        console.warn('Запись дневника с сервера пропущена:', cause.message);
      }
    }
    this.save({ synced, names, authors });
    this.remember(planBefore, removals, restored);
  }

  /** Keeps what the doctor changed where the patient will see it (DIARY19). */
  private remember(
    planBefore: DiaryInvitation | undefined,
    removals: readonly DiaryRemoval[],
    restored: ReadonlySet<string>,
  ): void {
    const meta = this.store.meta(this.patientId);
    const planAfter = this.store.read(this.patientId)?.invitation;
    const lines = planBefore && planAfter ? planChanges(planBefore, planAfter) : [];
    const planChange = mergePlanChange(meta.planChange, lines, new Date().toISOString());
    const kept = (meta.removedByDoctor ?? []).filter(
      (removal) => !restored.has(removal.id) && !removals.some((next) => next.id === removal.id),
    );
    const removedByDoctor = [...kept, ...removals].slice(-MAX_DIARY_REMOVALS);
    const removalsChanged =
      removals.length > 0 || kept.length !== (meta.removedByDoctor ?? []).length;
    if (planChange === meta.planChange && !removalsChanged) return;
    this.store.setMeta(this.patientId, {
      ...(planChange ? { planChange } : {}),
      ...(removalsChanged ? { removedByDoctor } : {}),
    });
  }

  /** Pull, then push; one run at a time. Offline is a normal state, not an error. */
  sync(): Promise<SyncStatus> {
    this.running ??= this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<SyncStatus> {
    this.refresh();
    if (this.connection.ended) return this.status();
    const open = (state: SessionState) =>
      new DiarySession(
        this.api,
        this.patientId,
        `p:${this.connection.deviceId}`,
        this.signKey,
        keyring(this.connection),
        state,
        () => this.refreshKeys(),
      );
    let session = open(this.connection.session);
    // Notices first: they are local and must follow a tick even when offline.
    const moments = await this.refreshNotices();
    try {
      let pulled = await session.pull();
      if (pulled.refused > 0) {
        // A key this phone did not have yet (a new epoch): fetch it and read everything again.
        await this.refreshKeys();
        session = open({ cursor: 0, revs: {} });
        pulled = await session.pull();
      }
      this.apply(pulled.revisions);
      this.save({ session: session.snapshot() });
      const items = outbox(this.store, this.connection);
      const conflicts = await session.push(items.map(({ id, payload }) => ({ id, payload })));
      const synced = { ...this.connection.synced };
      const authors = { ...this.connection.authors };
      for (const item of items) {
        synced[item.id] = item.fingerprint;
        // This phone wrote the latest revision now, whoever wrote the one before.
        if (item.id.startsWith('e-')) delete authors[item.id.slice(2)];
      }
      this.save({ synced, authors, session: session.snapshot() });
      if (conflicts.length) this.apply(conflicts);
      while (this.connection.pendingAlerts > 0) {
        await diaryDevice.alert(this.api);
        this.save({ pendingAlerts: this.connection.pendingAlerts - 1 });
      }
      await this.refreshPeople();
      // The plan may have changed with this pull: work the moments out again before sending.
      const fresh = this.connection.reminders ? await this.refreshNotices() : moments;
      const doses = this.doseReport();
      const joined = [fresh.join(','), doses?.checks?.join(',') ?? '', doses?.taken.join(',') ?? '']
        .join('|')
        .replace(/\|+$/u, '');
      if (joined !== (this.connection.remindersSent ?? '')) {
        await diaryPush.reminders(this.api, fresh, doses);
        this.save({ remindersSent: joined });
      }
      this.save({ lastSyncAt: new Date().toISOString() });
      return this.status();
    } catch (cause) {
      this.save({ session: session.snapshot() });
      if (isOffline(cause)) return { ...this.status(), phase: 'offline' };
      if (cause instanceof DiaryApiError && (cause.status === 401 || cause.status === 410)) {
        if (this.kind === 'carer') {
          // A removed carer keeps nothing of the patient's diary on this phone.
          this.forget();
          return {
            ...this.status(),
            phase: 'ended',
            message: 'Вас отключили от этого дневника: записи пациента удалены с этого телефона.',
          };
        }
        this.save({ ended: true });
        return {
          ...this.status(),
          phase: 'ended',
          message: 'Врач завершил наблюдение по этому дневнику.',
        };
      }
      return {
        ...this.status(),
        phase: 'error',
        message: cause instanceof Error ? cause.message : 'Не удалось синхронизировать.',
      };
    }
  }

  /**
   * While the diary has a carer: the dose moments for the missed-dose notice. The patient's phone
   * says which are still open (in the patient's time zone); every phone which are all taken.
   */
  private doseReport(): { checks?: readonly string[]; taken: readonly string[] } | undefined {
    if (this.carers() === 0) return undefined;
    const results = this.store.read(this.patientId);
    if (!results) return undefined;
    const moments = doseMoments(results.invitation, results.entries);
    return this.kind === 'patient'
      ? { checks: moments.open, taken: moments.taken }
      : { taken: moments.taken };
  }

  /**
   * Live changes from the doctor while the diary is open: the server's event stream says a record
   * arrived and the diary syncs; in `poll` mode (ADR-0027) the change counter is read every
   * `POLL_MS` while the page is visible. Returns the stop function.
   */
  listen(onSynced: (status: SyncStatus) => void): () => void {
    if (this.connection.ended) return () => undefined;
    let stop: () => void = () => undefined;
    let stopped = false;
    diaryLiveMode(this.api)
      .then((mode) => {
        if (stopped) return;
        stop = mode === 'poll' ? this.pollChanges(onSynced) : this.openStream(onSynced);
      })
      .catch((cause: unknown) => console.warn('Дневник: режим обновлений не узнать', cause));
    return () => {
      stopped = true;
      stop();
    };
  }

  private openStream(onSynced: (status: SyncStatus) => void): () => void {
    if (typeof EventSource === 'undefined') return () => undefined;
    const events = new EventSource(
      `${diaryServiceBase()}/api/events?token=${encodeURIComponent(this.connection.token)}`,
    );
    events.addEventListener('records', () => {
      void this.sync().then(onSynced);
    });
    // A carer joined or left, or the key changed: read who has the diary again.
    events.addEventListener('members', () => {
      this.peopleStale = true;
      void this.sync().then(onSynced);
    });
    return () => events.close();
  }

  private pollChanges(onSynced: (status: SyncStatus) => void): () => void {
    let seen: number | undefined;
    const tick = async (): Promise<void> => {
      if (document.visibilityState !== 'visible' || this.connection.ended) return;
      const n = await diaryChanges(this.api);
      if (seen !== undefined && n !== seen) {
        this.peopleStale = true;
        onSynced(await this.sync());
      }
      seen = n;
    };
    const run = (): void => {
      tick().catch((cause: unknown) => {
        if (!isOffline(cause)) console.warn('Дневник: опрос не удался', cause);
      });
    };
    const timer = window.setInterval(run, POLL_MS);
    run();
    return () => window.clearInterval(timer);
  }

  /**
   * Notifications when the doctor changes the plan or leaves a tip. Content-free: the diary's
   * worker shows a fixed text. Needs the installed diary (iPhone) and the patient's permission.
   */
  async enablePush(): Promise<'on' | 'unsupported' | 'denied'> {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return 'unsupported';
    }
    if ((await Notification.requestPermission()) !== 'granted') return 'denied';
    const registration = await navigator.serviceWorker.getRegistration('./');
    if (!registration) return 'unsupported';
    const { publicKey } = await diaryPush.key(this.api);
    if (!publicKey) return 'unsupported';
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(publicKey),
      }));
    await diaryPush.subscribe(this.api, subscription);
    // A carer hears of missed doses; reminders at dose times are the patient's unless switched on.
    if (this.connection.reminders === undefined) this.save({ reminders: this.kind === 'patient' });
    void this.sync();
    return 'on';
  }

  /**
   * Re-sends an existing subscription with its payload keys (subscriptions saved before reminders
   * had none). Asks nothing: without a granted permission it does nothing.
   */
  async refreshPush(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker.getRegistration('./');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return false;
    await diaryPush.subscribe(this.api, subscription);
    return true;
  }

  reminderSettings(): ReminderSettings {
    this.refresh();
    return {
      on: this.connection.reminders === true,
      names: this.connection.reminderNames === true,
    };
  }

  /** Switches reminders or their medicine names; the next sync tells the server. */
  setReminders(patch: Partial<ReminderSettings>): Promise<SyncStatus> {
    this.save({
      ...(patch.on === undefined ? {} : { reminders: patch.on }),
      ...(patch.names === undefined ? {} : { reminderNames: patch.names }),
    });
    return this.sync();
  }

  /** Writes the worker's notices for the coming moments; returns the moments (none when off). */
  private async refreshNotices(): Promise<string[]> {
    const results = this.store.read(this.patientId);
    const slots =
      this.connection.reminders && results
        ? reminderSlots(results.invitation, results.entries)
        : [];
    await writeReminderNotices(
      this.patientId,
      reminderNotices(slots, this.connection.reminderNames === true),
    );
    return reminderMoments(slots);
  }

  /**
   * Applies the «Принял» pressed in notifications while the diary was closed. Returns whether
   * anything was marked (the caller reloads and syncs).
   */
  async applyReminderActions(): Promise<boolean> {
    const pending = await pendingReminderActions(this.patientId);
    if (!pending.actions.length) return false;
    let results = this.store.read(this.patientId);
    if (results) {
      for (const action of pending.actions) results = applyReminderAction(results, action);
      this.store.save(results);
    }
    await pending.clear();
    return true;
  }

  /** An urgent answer: sent now if online, otherwise with the next sync. */
  raiseAlert(): Promise<SyncStatus> {
    this.save({ pendingAlerts: this.connection.pendingAlerts + 1 });
    return this.sync();
  }

  /** Consent withdrawn: the server deletes the records; this phone forgets the diary. */
  async withdraw(): Promise<void> {
    await diaryDevice.withdraw(this.api);
    this.forget();
  }
}
