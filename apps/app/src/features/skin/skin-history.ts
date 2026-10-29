/**
 * The gallery of «Кожа по фото»: every analysis stays on this device — the compressed photo, its
 * thumbnail, the details, the ranking, the time, a note and an optional patient. Nothing here is
 * sent anywhere. Entries are read back through `parseSkinHistoryEntry`, which keeps only what this
 * version of the model's class list and details still understand.
 */
import { type SkinFindings, sanitizeSkinFindings } from '@/features/skin/skin-atlas';
import { sanitizeSkinDetails } from '@/features/skin/skin-details';
import {
  SKIN_CLASSES,
  type SkinAnalysis,
  type SkinDetails,
  type SkinPrediction,
} from '@/features/skin/skin-model';

export interface SkinHistoryResults {
  readonly predictions: readonly SkinPrediction[];
  readonly malignantScore: number;
  readonly malignantFlag: boolean;
  readonly uncertain: boolean;
}

export interface SkinHistoryEntry {
  readonly id: string;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  /** The compressed square photo. */
  readonly photo: Blob;
  readonly thumbnail: Blob;
  readonly details: SkinDetails;
  /** What the doctor described: elements, colours, signs, how the elements evolved. */
  readonly findings?: SkinFindings;
  /** Absent when the photo was kept without an analysis (the model was not installed). */
  readonly results?: SkinHistoryResults;
  readonly note: string;
  readonly patientId?: string;
}

/** `patientId: null` detaches the entry from its patient. */
export interface SkinHistoryPatch {
  readonly details?: SkinDetails;
  readonly findings?: SkinFindings;
  readonly results?: SkinHistoryResults;
  readonly note?: string;
  readonly patientId?: string | null;
}

export interface SkinHistoryStore {
  /** Newest first. */
  list(): Promise<readonly SkinHistoryEntry[]>;
  put(entry: SkinHistoryEntry): Promise<void>;
  update(id: string, patch: SkinHistoryPatch): Promise<SkinHistoryEntry | undefined>;
  remove(id: string): Promise<void>;
}

export const SKIN_HISTORY_EVENT = 'minimed:skin-history-changed';
const KEPT_PREDICTIONS = 5;
const MAX_NOTE_LENGTH = 4000;

export function skinHistoryResults(analysis: SkinAnalysis): SkinHistoryResults {
  return {
    predictions: analysis.predictions.slice(0, KEPT_PREDICTIONS),
    malignantScore: analysis.malignantScore,
    malignantFlag: analysis.malignantFlag,
    uncertain: analysis.uncertain,
  };
}

function parseResults(value: unknown): SkinHistoryResults | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const known = new Set(SKIN_CLASSES.map((entry) => entry.id));
  const predictions = (Array.isArray(raw['predictions']) ? raw['predictions'] : []).flatMap(
    (entry: unknown): SkinPrediction[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { classId, probability } = entry as Record<string, unknown>;
      return typeof classId === 'string' &&
        known.has(classId) &&
        typeof probability === 'number' &&
        Number.isFinite(probability)
        ? [{ classId, probability: Math.min(1, Math.max(0, probability)) }]
        : [];
    },
  );
  if (predictions.length === 0) return undefined;
  const score = raw['malignantScore'];
  return {
    predictions,
    malignantScore: typeof score === 'number' && Number.isFinite(score) ? score : 0,
    malignantFlag: raw['malignantFlag'] === true,
    uncertain: raw['uncertain'] === true,
  };
}

/** Validates one stored record; anything unreadable is dropped rather than shown half-broken. */
export function parseSkinHistoryEntry(value: unknown): SkinHistoryEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const id = raw['id'];
  const createdAt = raw['createdAt'];
  if (typeof id !== 'string' || id.length === 0 || id.length > 80) return undefined;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return undefined;
  if (!(raw['photo'] instanceof Blob) || !(raw['thumbnail'] instanceof Blob)) return undefined;
  const results = parseResults(raw['results']);
  const findings = sanitizeSkinFindings(raw['findings']);
  const note = typeof raw['note'] === 'string' ? raw['note'].slice(0, MAX_NOTE_LENGTH) : '';
  const patientId =
    typeof raw['patientId'] === 'string' && raw['patientId'].length > 0
      ? raw['patientId']
      : undefined;
  return {
    id,
    createdAt,
    photo: raw['photo'],
    thumbnail: raw['thumbnail'],
    details: sanitizeSkinDetails(raw['details']),
    ...(Object.keys(findings).length > 0 ? { findings } : {}),
    ...(results ? { results } : {}),
    note,
    ...(patientId ? { patientId } : {}),
  };
}

export function applySkinHistoryPatch(
  entry: SkinHistoryEntry,
  patch: SkinHistoryPatch,
): SkinHistoryEntry {
  const { patientId: current, ...rest } = entry;
  const patientId = patch.patientId === undefined ? current : (patch.patientId ?? undefined);
  return {
    ...rest,
    ...(patch.details ? { details: patch.details } : {}),
    ...(patch.findings ? { findings: patch.findings } : {}),
    ...(patch.results ? { results: patch.results } : {}),
    ...(patch.note !== undefined ? { note: patch.note.slice(0, MAX_NOTE_LENGTH) } : {}),
    ...(patientId ? { patientId } : {}),
  };
}

export function newestFirst(entries: readonly SkinHistoryEntry[]): readonly SkinHistoryEntry[] {
  return entries.toSorted((left, right) => right.createdAt - left.createdAt);
}

/** In memory: tests, and the page when IndexedDB is unavailable (it still works, until reload). */
export function createMemorySkinHistory(): SkinHistoryStore {
  const entries = new Map<string, SkinHistoryEntry>();
  return {
    list: async () => newestFirst([...entries.values()]),
    put: async (entry) => {
      entries.set(entry.id, entry);
    },
    update: async (id, patch) => {
      const current = entries.get(id);
      if (!current) return undefined;
      const next = applySkinHistoryPatch(current, patch);
      entries.set(id, next);
      return next;
    },
    remove: async (id) => {
      entries.delete(id);
    },
  };
}

const DATABASE_NAME = 'minimed-skin-photos';
const STORE_NAME = 'entries';

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка хранилища снимков.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка хранилища снимков.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Запись снимка отменена.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище.'));
  });
}

function notifyChanged(): void {
  window.dispatchEvent(new Event(SKIN_HISTORY_EVENT));
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const done = transactionDone(transaction);
    const result = await operate(transaction.objectStore(STORE_NAME));
    await done;
    return result;
  } finally {
    database.close();
  }
}

/** The device's own IndexedDB store; photos never leave it. */
export function createIndexedDbSkinHistory(): SkinHistoryStore {
  return {
    list: async () => {
      const rows = await withStore('readonly', (store) => requestDone(store.getAll()));
      return newestFirst(
        rows.flatMap((row: unknown) => {
          const entry = parseSkinHistoryEntry(row);
          return entry ? [entry] : [];
        }),
      );
    },
    put: async (entry) => {
      await withStore('readwrite', (store) => requestDone(store.put(entry)));
      notifyChanged();
    },
    update: async (id, patch) => {
      const next = await withStore('readwrite', async (store) => {
        const current = parseSkinHistoryEntry(await requestDone(store.get(id)));
        if (!current) return undefined;
        const updated = applySkinHistoryPatch(current, patch);
        await requestDone(store.put(updated));
        return updated;
      });
      if (next) notifyChanged();
      return next;
    },
    remove: async (id) => {
      await withStore('readwrite', (store) => requestDone(store.delete(id)));
      notifyChanged();
    },
  };
}

let shared: SkinHistoryStore | undefined;

/** The page's store: IndexedDB when there is one, memory otherwise. */
export function skinHistory(): SkinHistoryStore {
  shared ??=
    typeof indexedDB === 'undefined' ? createMemorySkinHistory() : createIndexedDbSkinHistory();
  return shared;
}
