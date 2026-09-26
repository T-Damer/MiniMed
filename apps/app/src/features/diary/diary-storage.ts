import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  MAX_DIARY_ENTRIES,
  parseDiaryInvitation,
  parseDiaryResults,
} from '@/features/diary/diary-model';

/** Entries live only in the patient's browser; there is no server copy. */
const KEY_PREFIX = 'minimed.diary.v1.';
const INDEX_KEY = `${KEY_PREFIX}index`;

export interface DiaryStore {
  list(): readonly DiaryInvitation[];
  warnings(): readonly string[];
  load(invitation: DiaryInvitation): DiaryResults;
  save(results: DiaryResults): void;
  remove(id: string): void;
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

export function createDiaryStore(storage: Storage, now: () => number = Date.now): DiaryStore {
  let lastWarnings: string[] = [];
  const ids = (): string[] => {
    let indexed: string[] = [];
    try {
      const value = readJson(storage, INDEX_KEY);
      if (Array.isArray(value)) {
        indexed = [
          ...new Set(
            value.filter((id): id is string => typeof id === 'string' && id.length > 0),
          ),
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
  return {
    list() {
      const warnings: string[] = [];
      const invitations = ids().flatMap((id) => {
        try {
          const stored = readJson(storage, KEY_PREFIX + id);
          if (stored === null) return [];
          return [parseDiaryResults(stored, now()).invitation];
        } catch {
          // Preserve the raw record for possible recovery; isolate it from the valid diary list.
          warnings.push(`Локальный дневник ${id} повреждён и не открыт.`);
          return [];
        }
      });
      lastWarnings = warnings;
      return invitations;
    },
    warnings() {
      return lastWarnings;
    },
    load(invitation) {
      const stored = readJson(storage, KEY_PREFIX + invitation.id);
      if (stored === null) return { v: DIARY_FORMAT_VERSION, invitation, entries: [] };
      const results = parseDiaryResults(stored, now());
      // A newer link from the doctor (for example an updated medicine list) replaces the header.
      return { ...results, invitation: parseDiaryInvitation(invitation, now()) };
    },
    save(results) {
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
    },
    remove(id) {
      storage.removeItem(KEY_PREFIX + id);
      try {
        storage.setItem(INDEX_KEY, JSON.stringify(ids().filter((candidate) => candidate !== id)));
      } catch {
        // A stale index is harmless: list() skips absent records and can rebuild after corruption.
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
