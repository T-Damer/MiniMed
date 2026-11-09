/**
 * Voice recordings stay on the phone that made them (owner 2026-11-08): only the recognised text
 * goes into the diary and to the doctor. The recording is kept here, in this browser's IndexedDB,
 * with no time limit, so the patient can listen to it again; the entry only names its id.
 */
import { createDiaryId } from '@/features/diary/diary-model';

const DATABASE = 'minimed-diary-voices';
const STORE = 'clips';

export interface VoiceClipRecord {
  readonly id: string;
  readonly blob: Blob;
  readonly seconds: number;
  /** When it was recorded (ISO). */
  readonly at: string;
}

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (opened) return opened;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Хранилище записей недоступно.'));
  });
  opened = promise;
  promise.catch(() => {
    opened = undefined;
  });
  return promise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Хранилище записей недоступно.'));
  });
}

/**
 * Asks the browser not to clear this site's storage under pressure, so recordings «forever» are
 * not dropped with the cache. The browser may say no; the recordings are still kept as long as
 * it keeps the site's data.
 */
export async function keepVoiceStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function saveVoiceClip(blob: Blob, seconds: number): Promise<string> {
  const record: VoiceClipRecord = {
    id: createDiaryId(),
    blob,
    seconds: Math.max(1, Math.round(seconds)),
    at: new Date().toISOString(),
  };
  const db = await database();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
  void keepVoiceStorage().catch((cause: unknown) => {
    console.warn('Браузер не обещал хранить записи:', cause);
  });
  return record.id;
}

export async function loadVoiceClip(id: string): Promise<VoiceClipRecord | undefined> {
  const db = await database();
  return (await done(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) as
    | VoiceClipRecord
    | undefined;
}
