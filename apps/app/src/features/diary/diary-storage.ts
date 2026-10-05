import {
  type DiarySent,
  type InvitationMergeOutcome,
  mergeInvitation,
  mergeResults,
  type ResultsMerge,
  shareStatus,
} from '@/features/diary/diary-merge';
import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  MAX_DIARY_ENTRIES,
  parseDiaryEntry,
  parseDiaryInvitation,
  parseDiaryResults,
} from '@/features/diary/diary-model';

/** Entries live only in the patient's browser; there is no server copy. */
const KEY_PREFIX = 'minimed.diary.v1.';
const INDEX_KEY = `${KEY_PREFIX}index`;
/** Bookkeeping that is not part of the diary itself: what was handed to the doctor, last use. */
const META_PREFIX = 'minimed.diary.meta.v1.';
/** A record that could not be read as a whole is kept here, untouched, before it is repaired. */
const SALVAGE_PREFIX = 'minimed.diary.salvage.v1.';
const UI_KEY = 'minimed.diary.ui.v1';

export interface DiaryMeta {
  readonly lastOpenedAt?: string;
  readonly sent?: DiarySent;
}

/** Page-level state that is not tied to one diary. */
export interface DiaryUiState {
  readonly lastOpenedId?: string;
  /** ISO time the patient dismissed the «add to home screen» card. */
  readonly installDismissedAt?: string;
}

export interface DiarySummary {
  readonly invitation: DiaryInvitation;
  readonly entries: number;
  readonly lastEntryAt: string | undefined;
  readonly lastOpenedAt: string | undefined;
  /** Entries not yet handed to the doctor (new or edited since). */
  readonly unsent: number;
}

export interface DiaryOpenResult {
  readonly results: DiaryResults;
  readonly outcome: InvitationMergeOutcome;
  /** Entries of a damaged record that could not be read and were set aside. */
  readonly salvagedSkipped: number;
}

export interface DiaryStore {
  list(): readonly DiaryInvitation[];
  summaries(): readonly DiarySummary[];
  warnings(): readonly string[];
  /** The stored diary, or undefined when this device has none with that id. */
  read(id: string): DiaryResults | undefined;
  /** Opens a diary from a link: creates it, or merges the link into the stored diary. */
  open(invitation: DiaryInvitation): DiaryOpenResult;
  /** Adds the entries of a saved copy to the stored diary (or creates it). */
  restore(results: DiaryResults): ResultsMerge;
  save(results: DiaryResults): void;
  remove(id: string): void;
  meta(id: string): DiaryMeta;
  setMeta(id: string, patch: Partial<DiaryMeta>): void;
  ui(): DiaryUiState;
  setUi(patch: Partial<DiaryUiState>): void;
}

function readJson(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

function scanDiaryIds(storage: Storage): string[] {
  const found: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === INDEX_KEY || !key.startsWith(KEY_PREFIX)) continue;
    const id = key.slice(KEY_PREFIX.length);
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSent(value: unknown): DiarySent | undefined {
  if (!isRecord(value) || typeof value['at'] !== 'string' || !isRecord(value['entries'])) {
    return undefined;
  }
  const entries: Record<string, string> = {};
  for (const [id, fingerprint] of Object.entries(value['entries'])) {
    if (typeof fingerprint === 'string') entries[id] = fingerprint;
  }
  return { at: value['at'], entries };
}

export function createDiaryStore(storage: Storage, now: () => number = Date.now): DiaryStore {
  let lastWarnings: string[] = [];
  const ids = (): string[] => {
    let indexed: string[] = [];
    try {
      const value = readJson(storage, INDEX_KEY);
      if (Array.isArray(value)) {
        indexed = [
          ...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0)),
        ];
      }
    } catch {
      // Rebuild the navigation index from the source diary records below.
    }
    const scanned = scanDiaryIds(storage);
    const scannedIds = new Set(scanned);
    const recovered = [
      ...indexed.filter((id) => scannedIds.has(id)),
      ...scanned.filter((id) => !indexed.includes(id)),
    ];
    if (
      recovered.length !== indexed.length ||
      recovered.some((id, index) => id !== indexed[index])
    ) {
      try {
        storage.setItem(INDEX_KEY, JSON.stringify(recovered));
      } catch {
        // The diary records remain the source of truth even if the compact index cannot be rewritten.
      }
    }
    return recovered;
  };

  const meta = (id: string): DiaryMeta => {
    try {
      const value = readJson(storage, META_PREFIX + id);
      if (!isRecord(value)) return {};
      const sent = parseSent(value['sent']);
      return {
        ...(typeof value['lastOpenedAt'] === 'string'
          ? { lastOpenedAt: value['lastOpenedAt'] }
          : {}),
        ...(sent ? { sent } : {}),
      };
    } catch {
      return {};
    }
  };

  /**
   * Reads one record. A record that fails whole-record validation keeps its readable entries;
   * the original text is set aside under a salvage key so nothing is lost for good.
   */
  const readRecord = (
    id: string,
  ): { readonly results: DiaryResults; readonly skipped: number } | undefined => {
    const raw = storage.getItem(KEY_PREFIX + id);
    if (raw === null) return undefined;
    try {
      return { results: parseDiaryResults(JSON.parse(raw) as unknown, now()), skipped: 0 };
    } catch (cause) {
      const stored = (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return null;
        }
      })();
      if (!isRecord(stored)) throw cause;
      const invitation = parseDiaryInvitation(stored['invitation'], now());
      const rawEntries = Array.isArray(stored['entries']) ? stored['entries'] : [];
      const entries: DiaryEntry[] = [];
      for (const candidate of rawEntries) {
        try {
          const entry = parseDiaryEntry(invitation, candidate, now());
          if (!entries.some((known) => known.id === entry.id)) entries.push(entry);
        } catch {
          // An unreadable entry is skipped; the whole original record is preserved below.
        }
      }
      try {
        storage.setItem(SALVAGE_PREFIX + id, raw);
      } catch {
        // Without room for the copy the readable entries are still returned.
      }
      return {
        results: {
          v: DIARY_FORMAT_VERSION,
          invitation,
          entries: entries.toSorted((left, right) => left.at.localeCompare(right.at)),
        },
        skipped: rawEntries.length - entries.length,
      };
    }
  };

  const save = (results: DiaryResults): void => {
    if (results.entries.length > MAX_DIARY_ENTRIES) {
      throw new Error('В дневнике слишком много записей. Покажите их врачу и начните новый.');
    }
    storage.setItem(KEY_PREFIX + results.invitation.id, JSON.stringify(results));
    const current = ids();
    if (!current.includes(results.invitation.id)) {
      try {
        storage.setItem(INDEX_KEY, JSON.stringify([...current, results.invitation.id]));
      } catch {
        // The saved diary itself is durable; a later list() can reconstruct the index from keys.
      }
    }
  };

  const setMeta = (id: string, patch: Partial<DiaryMeta>): void => {
    try {
      storage.setItem(META_PREFIX + id, JSON.stringify({ ...meta(id), ...patch }));
    } catch {
      // Bookkeeping must never block the diary; the worst case is a repeated «not sent» hint.
    }
  };

  const ui = (): DiaryUiState => {
    try {
      const value = readJson(storage, UI_KEY);
      if (!isRecord(value)) return {};
      return {
        ...(typeof value['lastOpenedId'] === 'string'
          ? { lastOpenedId: value['lastOpenedId'] }
          : {}),
        ...(typeof value['installDismissedAt'] === 'string'
          ? { installDismissedAt: value['installDismissedAt'] }
          : {}),
      };
    } catch {
      return {};
    }
  };

  const summaries = (): readonly DiarySummary[] => {
    const warnings: string[] = [];
    const found = ids().flatMap((id): DiarySummary[] => {
      try {
        const record = readRecord(id);
        if (!record) return [];
        const { results } = record;
        const stored = meta(id);
        const status = shareStatus(results.entries, stored.sent);
        return [
          {
            invitation: results.invitation,
            entries: results.entries.length,
            lastEntryAt: results.entries.at(-1)?.at,
            lastOpenedAt: stored.lastOpenedAt,
            unsent: status.unsent + status.changed,
          },
        ];
      } catch {
        // Preserve the raw record for possible recovery; isolate it from the valid diary list.
        warnings.push(`Локальный дневник ${id} повреждён и не открыт.`);
        return [];
      }
    });
    lastWarnings = warnings;
    return found;
  };

  return {
    list() {
      return summaries().map((summary) => summary.invitation);
    },
    summaries,
    warnings() {
      return lastWarnings;
    },
    read(id) {
      return readRecord(id)?.results;
    },
    open(invitation) {
      const incoming = parseDiaryInvitation(invitation, now());
      const record = readRecord(incoming.id);
      if (!record) {
        const results: DiaryResults = {
          v: DIARY_FORMAT_VERSION,
          invitation: incoming,
          entries: [],
        };
        save(results);
        return { results, outcome: 'new', salvagedSkipped: 0 };
      }
      const merged = mergeInvitation(record.results.invitation, incoming, record.results.entries);
      const results: DiaryResults = { ...record.results, invitation: merged.invitation };
      // Persist at once: a patient who opens the link and closes the tab must still find the diary.
      if (
        merged.outcome === 'updated' ||
        merged.invitation.issuedAt !== record.results.invitation.issuedAt ||
        record.skipped > 0
      ) {
        save(results);
      }
      return { results, outcome: merged.outcome, salvagedSkipped: record.skipped };
    },
    restore(copy) {
      const record = readRecord(copy.invitation.id);
      const merge = mergeResults(record?.results, copy);
      save(merge.results);
      return merge;
    },
    save,
    remove(id) {
      storage.removeItem(KEY_PREFIX + id);
      storage.removeItem(META_PREFIX + id);
      storage.removeItem(SALVAGE_PREFIX + id);
      try {
        storage.setItem(INDEX_KEY, JSON.stringify(ids().filter((candidate) => candidate !== id)));
      } catch {
        // A stale index is harmless: list() skips absent records and can rebuild after corruption.
      }
    },
    meta,
    setMeta,
    ui,
    setUi(patch) {
      try {
        storage.setItem(UI_KEY, JSON.stringify({ ...ui(), ...patch }));
      } catch {
        // Remembering the last diary is a convenience only.
      }
    },
  };
}

export function withEntry(results: DiaryResults, entry: DiaryEntry): DiaryResults {
  return {
    ...results,
    entries: [...results.entries, entry].toSorted((left, right) => left.at.localeCompare(right.at)),
  };
}

export function withoutEntry(results: DiaryResults, entryId: string): DiaryResults {
  return { ...results, entries: results.entries.filter((entry) => entry.id !== entryId) };
}
