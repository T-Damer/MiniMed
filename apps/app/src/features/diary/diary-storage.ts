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
  load(invitation: DiaryInvitation): DiaryResults;
  save(results: DiaryResults): void;
  remove(id: string): void;
}

function readJson(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

export function createDiaryStore(storage: Storage, now: () => number = Date.now): DiaryStore {
  const ids = (): string[] => {
    const value = readJson(storage, INDEX_KEY);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  };
  return {
    list() {
      return ids().flatMap((id) => {
        const stored = readJson(storage, KEY_PREFIX + id);
        if (stored === null) return [];
        return [parseDiaryResults(stored, now()).invitation];
      });
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
        storage.setItem(INDEX_KEY, JSON.stringify([...current, results.invitation.id]));
      }
    },
    remove(id) {
      storage.removeItem(KEY_PREFIX + id);
      storage.setItem(INDEX_KEY, JSON.stringify(ids().filter((candidate) => candidate !== id)));
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
