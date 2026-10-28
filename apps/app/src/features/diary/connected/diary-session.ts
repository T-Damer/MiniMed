/**
 * One patient's records on one device: pulls new revisions after a cursor, checks each author's
 * signature, decrypts with the epoch key, and seals and pushes local changes as the next revision.
 * Used by the patient's phone and by the doctor's dashboard alike.
 */
import type { DiaryRecordsNotice } from '@localmed/contracts';
import { openRecord, sealRecord, verifyRecord } from '@localmed/diary-sync';

import {
  type DiaryApi,
  DiaryApiError,
  diaryPatients,
  diaryRecords,
} from '@/features/diary/connected/diary-api';
import type { DiaryRecordRevision } from '@/features/diary/connected/diary-replica';

export interface Keyring {
  /** Epoch → raw AES key. */
  readonly keys: ReadonlyMap<number, Uint8Array<ArrayBuffer>>;
  /** The epoch new records are written in. */
  readonly current: number;
}

export interface SessionState {
  readonly cursor: number;
  /** Record id → latest revision known (pulled or pushed). */
  readonly revs: Readonly<Record<string, number>>;
}

export interface PullResult {
  readonly revisions: readonly DiaryRecordRevision[];
  /** Records refused: bad signature, unknown author or a key this device does not have. */
  readonly refused: number;
}

export class DiarySession {
  private authorKeys: Readonly<Record<string, string>> = {};
  private state: SessionState;

  constructor(
    private readonly api: DiaryApi,
    readonly patientId: string,
    private readonly author: string,
    private readonly signKey: CryptoKey,
    private keyring: Keyring,
    initial: SessionState = { cursor: 0, revs: {} },
    /** Fetches this device's keys again after the server says a newer epoch exists. */
    private readonly refreshKeys?: () => Promise<Keyring>,
  ) {
    this.state = initial;
  }

  snapshot(): SessionState {
    return this.state;
  }

  setKeyring(keyring: Keyring): void {
    this.keyring = keyring;
  }

  private async authorKey(author: string): Promise<string | undefined> {
    if (!this.authorKeys[author]) {
      this.authorKeys = await diaryPatients.authors(this.api, this.patientId);
    }
    return this.authorKeys[author];
  }

  /** Everything new since the cursor, oldest first. */
  async pull(): Promise<PullResult> {
    const revisions: DiaryRecordRevision[] = [];
    let refused = 0;
    let more = true;
    while (more) {
      const page = await diaryRecords.page(this.api, this.patientId, this.state.cursor);
      for (const record of page.records) {
        const key = this.keyring.keys.get(record.epoch);
        const sign = await this.authorKey(record.author);
        if (!key || !sign || !(await verifyRecord(this.patientId, record, sign))) {
          refused += 1;
          continue;
        }
        try {
          const payload = await openRecord(this.patientId, record, key);
          revisions.push({
            id: record.id,
            rev: record.rev,
            author: record.author,
            at: record.at,
            payload,
          });
        } catch {
          refused += 1;
        }
      }
      const revs = { ...this.state.revs };
      for (const record of page.records)
        revs[record.id] = Math.max(revs[record.id] ?? 0, record.rev);
      this.state = { cursor: page.last, revs };
      more = page.more;
    }
    return { revisions, refused };
  }

  /**
   * Seals and sends local changes as next revisions. A conflict (409: a revision another device
   * took, or a newer epoch) is resolved by refreshing keys, pulling and retrying once with fresh
   * numbers; what that pull brought is returned so the caller can apply it.
   */
  /** `notice`: what the patient's phone is told (a doctor's plan, tip or correction). */
  async push(
    items: readonly { readonly id: string; readonly payload: unknown }[],
    notice?: DiaryRecordsNotice,
  ): Promise<readonly DiaryRecordRevision[]> {
    const pulled: DiaryRecordRevision[] = [];
    if (!items.length) return pulled;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const key = this.keyring.keys.get(this.keyring.current);
      if (!key) throw new DiaryApiError(409, 'Нет ключа текущей эпохи.');
      const envelopes = await Promise.all(
        items.map((item) =>
          sealRecord(
            {
              patientId: this.patientId,
              id: item.id,
              rev: (this.state.revs[item.id] ?? 0) + 1,
              epoch: this.keyring.current,
              author: this.author,
            },
            item.payload,
            key,
            this.signKey,
          ),
        ),
      );
      try {
        for (let start = 0; start < envelopes.length; start += 200) {
          await diaryRecords.push(
            this.api,
            this.patientId,
            envelopes.slice(start, start + 200),
            notice,
          );
        }
        const revs = { ...this.state.revs };
        for (const envelope of envelopes) revs[envelope.id] = envelope.rev;
        this.state = { ...this.state, revs };
        return pulled;
      } catch (cause) {
        if (!(cause instanceof DiaryApiError) || cause.status !== 409 || attempt === 1) throw cause;
        if (this.refreshKeys) this.keyring = await this.refreshKeys();
        pulled.push(...(await this.pull()).revisions);
      }
    }
    return pulled;
  }
}
