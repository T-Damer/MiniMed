/**
 * Personal notes attached to any official or user document (Wave 2.2).
 * Stored locally in IndexedDB with an in-memory fallback for non-IDB environments (tests).
 */

export interface DocumentNoteRecord {
  readonly documentId: string;
  readonly text: string;
  readonly updatedAt: string;
}

export const DOCUMENT_NOTES_EVENT = 'minimed:document-notes-changed';

const DATABASE_NAME = 'minimed-document-notes-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'notes';

const memoryNotes = new Map<string, DocumentNoteRecord>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'documentId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище заметок к документам.'));
  });
}

function announceNoteChange(documentId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOCUMENT_NOTES_EVENT, { detail: { documentId } }));
}

export async function loadDocumentNote(documentId: string): Promise<DocumentNoteRecord | null> {
  if (!hasIndexedDb()) return memoryNotes.get(documentId) ?? null;
  const database = await openDatabase();
  try {
    return await new Promise<DocumentNoteRecord | null>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(documentId);
      request.onsuccess = () => resolve((request.result as DocumentNoteRecord | undefined) ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error('Не удалось прочитать заметку к документу.'));
    });
  } finally {
    database.close();
  }
}

export async function saveDocumentNote(
  documentId: string,
  rawText: string,
): Promise<DocumentNoteRecord | null> {
  const text = rawText.trim();
  const record: DocumentNoteRecord | null = text
    ? { documentId, text, updatedAt: new Date().toISOString() }
    : null;
  if (!hasIndexedDb()) {
    if (record) memoryNotes.set(documentId, record);
    else memoryNotes.delete(documentId);
    announceNoteChange(documentId);
    return record;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      if (record) store.put(record);
      else store.delete(documentId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить заметку к документу.'));
    });
  } finally {
    database.close();
  }
  announceNoteChange(documentId);
  return record;
}

export function clearMemoryDocumentNotesForTests(): void {
  memoryNotes.clear();
}
