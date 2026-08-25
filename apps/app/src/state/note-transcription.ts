import { backgroundParity, PARITY_PRIORITIES } from '@/state/parity-controller';

export type TranscriptStatus = 'queued' | 'running' | 'done' | 'failed' | 'unsupported';

export interface NoteTranscript {
  readonly fileId: string;
  readonly noteId: string;
  readonly text: string;
  readonly status: TranscriptStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const NOTE_TRANSCRIPTS_EVENT = 'minimed:note-transcripts-changed';

const DATABASE_NAME = 'minimed-note-transcripts-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'transcripts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
        store.createIndex('noteId', 'noteId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище расшифровок.'));
  });
}

async function putTranscript(record: NoteTranscript): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить расшифровку.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(NOTE_TRANSCRIPTS_EVENT));
}

export async function loadTranscriptsForNotes(
  noteIds: readonly string[],
): Promise<ReadonlyMap<string, readonly NoteTranscript[]>> {
  const wanted = new Set(noteIds.filter(Boolean));
  const grouped = new Map<string, NoteTranscript[]>();
  if (!('indexedDB' in globalThis) || !indexedDB || wanted.size === 0) return grouped;
  for (const noteId of wanted) grouped.set(noteId, []);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as NoteTranscript;
        const bucket = grouped.get(record.noteId);
        if (bucket) bucket.push(record);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось загрузить расшифровки.'));
    });
    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    return new Map([...grouped].map(([noteId, list]) => [noteId, list]));
  } finally {
    database.close();
  }
}

export async function loadTranscript(fileId: string): Promise<NoteTranscript | null> {
  const database = await openDatabase();
  try {
    const result = await new Promise<NoteTranscript | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(fileId);
      request.onsuccess = () => resolve(request.result as NoteTranscript | undefined);
      request.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось загрузить расшифровку.'));
    });
    return result ?? null;
  } finally {
    database.close();
  }
}

/**
 * Engine seam: a loaded ASR model (GigaAM v3 / Parakeet v3 ONNX) provides
 * this; without it the queued job reports `unsupported` and keeps the lane
 * free for more important work such as OCR.
 */
export type TranscribeEngine = (audio: Blob, mimeType: string) => Promise<string>;

let activeEngine: TranscribeEngine | null = null;

export function setTranscriptionEngine(engine: TranscribeEngine | null): void {
  activeEngine = engine;
}

const running = new Map<string, { cancel: () => void }>();

export function isTranscriptionQueued(fileId: string): boolean {
  return running.has(fileId);
}

export function queueTranscription(input: {
  readonly fileId: string;
  readonly noteId: string;
  readonly blob: Blob;
}): void {
  if (running.has(input.fileId)) return;
  const ticket = backgroundParity.submit({
    kind: 'transcription',
    priority: PARITY_PRIORITIES.transcription,
    label: `transcribe:${input.fileId}`,
    run: async (ctx) => {
      const existing = await loadTranscript(input.fileId);
      if (existing?.status === 'done') return;
      if (!activeEngine) {
        await putTranscript({
          fileId: input.fileId,
          noteId: input.noteId,
          text: '',
          status: 'unsupported',
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      await ctx.checkpoint();
      await putTranscript({
        fileId: input.fileId,
        noteId: input.noteId,
        text: existing?.text ?? '',
        status: 'running',
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const text = await activeEngine(input.blob, input.blob.type || 'audio/webm');
      await ctx.checkpoint();
      await putTranscript({
        fileId: input.fileId,
        noteId: input.noteId,
        text,
        status: 'done',
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
  });
  running.set(input.fileId, {
    cancel: () => ticket.cancel(),
  });
  void ticket.done
    .finally(() => {
      running.delete(input.fileId);
    })
    .catch(() => undefined);
}
