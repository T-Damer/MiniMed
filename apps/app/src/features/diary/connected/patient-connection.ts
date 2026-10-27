/**
 * The patient's side of a connected diary (ADR-0026): pairing the phone with the doctor's one-time
 * code, keeping the device's keys, and a sync that merges the doctor's plan and corrections into
 * the local diary store and sends the patient's marks. The local store stays the source the
 * screens read, so the diary keeps working offline; sync runs whenever there is a network.
 */
import {
  fromBase64Url,
  generateIdentity,
  openPairingKeys,
  publicIdentity,
  toBase64Url,
  unwrapDataKey,
} from '@localmed/diary-sync';

import {
  createDiaryApi,
  type DiaryApi,
  DiaryApiError,
  diaryDevice,
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
import { entryFingerprint } from '@/features/diary/diary-merge';
import {
  type DiaryEntry,
  DiaryFormatError,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { type DiaryStore, withEntry, withoutEntry } from '@/features/diary/diary-storage';

const CONNECTION_PREFIX = 'minimed.diary.connection.v1.';
const CONSENT_VERSION = 'draft-2026-10-27';

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
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'ended';

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly lastSyncAt: string | undefined;
  /** Local changes the doctor does not have yet. */
  readonly pending: number;
  readonly message?: string;
}

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

/** The pending local changes: entries to send or delete, consent and tip reads. */
function outbox(store: DiaryStore, connection: StoredConnection) {
  const results = store.read(connection.patientId);
  const meta = store.meta(connection.patientId);
  const items: { id: string; payload: unknown; fingerprint: string }[] = [];
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
  if (meta.consentAt && !connection.synced[CONSENT_RECORD]) {
    items.push({
      id: CONSENT_RECORD,
      payload: { kind: 'consent', at: meta.consentAt, version: CONSENT_VERSION },
      fingerprint: '1',
    });
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

  private constructor(
    private readonly storage: Storage,
    private readonly store: DiaryStore,
    private connection: StoredConnection,
    private readonly signKey: CryptoKey,
    private readonly wrapKey: CryptoKey,
  ) {
    this.api = createDiaryApi(() => this.connection.token);
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
    const api = createDiaryApi(() => undefined);
    const paired = await diaryDevice.pair(
      api,
      link.patientId,
      link.secret,
      await publicIdentity(identity),
    );
    const keys = await openPairingKeys(paired.keys, link.secret);
    const connection: StoredConnection = {
      v: 1,
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

  status(): SyncStatus {
    return {
      phase: this.connection.ended ? 'ended' : 'idle',
      lastSyncAt: this.connection.lastSyncAt,
      pending: outbox(this.store, this.connection).length + this.connection.pendingAlerts,
    };
  }

  private save(patch: Partial<StoredConnection>): void {
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
              this.store.save(withoutEntry(results, entryId));
              synced[revision.id] = 'deleted';
            }
          } else if (payload['kind'] === 'entry' && unchangedHere) {
            const entry: DiaryEntry = parseDiaryEntry(results.invitation, payload['entry']);
            if (entry.id !== entryId) continue;
            this.store.save(withEntry(withoutEntry(results, entryId), entry));
            synced[revision.id] = entryFingerprint(entry);
          }
        } else if (revision.id === CONSENT_RECORD && payload['kind'] === 'consent') {
          if (typeof payload['at'] === 'string' && !this.store.meta(this.patientId).consentAt) {
            this.store.setMeta(this.patientId, { consentAt: payload['at'] });
          }
          synced[revision.id] = '1';
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
    this.save({ synced });
  }

  /** Pull, then push; one run at a time. Offline is a normal state, not an error. */
  sync(): Promise<SyncStatus> {
    this.running ??= this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<SyncStatus> {
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
      for (const item of items) synced[item.id] = item.fingerprint;
      this.save({ synced, session: session.snapshot() });
      if (conflicts.length) this.apply(conflicts);
      while (this.connection.pendingAlerts > 0) {
        await diaryDevice.alert(this.api);
        this.save({ pendingAlerts: this.connection.pendingAlerts - 1 });
      }
      this.save({ lastSyncAt: new Date().toISOString() });
      return this.status();
    } catch (cause) {
      this.save({ session: session.snapshot() });
      if (isOffline(cause)) return { ...this.status(), phase: 'offline' };
      if (cause instanceof DiaryApiError && (cause.status === 401 || cause.status === 410)) {
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
   * Live changes from the doctor while the diary is open: the server's event stream says a record
   * arrived and the diary syncs. Returns the stop function.
   */
  listen(onSynced: (status: SyncStatus) => void): () => void {
    if (typeof EventSource === 'undefined' || this.connection.ended) return () => undefined;
    const events = new EventSource(
      `/api/events?token=${encodeURIComponent(this.connection.token)}`,
    );
    events.addEventListener('records', () => {
      void this.sync().then(onSynced);
    });
    return () => events.close();
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
    await diaryPush.subscribe(this.api, subscription.endpoint);
    return 'on';
  }

  /** An urgent answer: sent now if online, otherwise with the next sync. */
  raiseAlert(): Promise<SyncStatus> {
    this.save({ pendingAlerts: this.connection.pendingAlerts + 1 });
    return this.sync();
  }

  /** Consent withdrawn: the server deletes the records; this phone forgets the diary. */
  async withdraw(): Promise<void> {
    await diaryDevice.withdraw(this.api);
    this.storage.removeItem(CONNECTION_PREFIX + this.patientId);
    this.store.remove(this.patientId);
  }
}
