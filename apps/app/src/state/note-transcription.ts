import { backgroundParity, PARITY_PRIORITIES, PreemptedError } from '@/state/parity-controller';

export type TranscriptStatus = 'queued' | 'running' | 'done' | 'failed' | 'unsupported';

export interface TranscriptSegment {
  readonly speakerId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface TranscriptionOutput {
  readonly text: string;
  readonly segments?: readonly TranscriptSegment[];
  readonly diarized?: boolean;
}

export interface NoteTranscript {
  readonly fileId: string;
  readonly noteId: string;
  readonly text: string;
  readonly segments?: readonly TranscriptSegment[];
  readonly speakerNames?: Readonly<Record<string, string>>;
  readonly diarized?: boolean;
  readonly status: TranscriptStatus;
  readonly error?: string;
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

async function putTranscript(
  record: NoteTranscript,
  canWrite: (() => boolean) | undefined = undefined,
): Promise<void> {
  const database = await openDatabase();
  try {
    if (canWrite && !canWrite()) {
      const error = new Error('Операция отменена.');
      error.name = 'AbortError';
      throw error;
    }
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
  window.dispatchEvent(
    new CustomEvent(NOTE_TRANSCRIPTS_EVENT, { detail: { fileId: record.fileId } }),
  );
}

function normalizeStoredTranscript(value: NoteTranscript): NoteTranscript {
  return {
    ...value,
    ...(Array.isArray(value.segments) ? { segments: value.segments } : {}),
    ...(value.speakerNames && typeof value.speakerNames === 'object'
      ? { speakerNames: value.speakerNames }
      : {}),
    ...(value.diarized === true ? { diarized: true } : {}),
  };
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
        const record = normalizeStoredTranscript(cursor.value as NoteTranscript);
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
    return result ? normalizeStoredTranscript(result) : null;
  } finally {
    database.close();
  }
}

export async function deleteTranscript(fileId: string): Promise<void> {
  if (!fileId) return;
  cancelTranscription(fileId);
  if (!('indexedDB' in globalThis) || !indexedDB) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(fileId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить расшифровку.'));
    });
  } finally {
    database.close();
  }
  emitTranscriptChange(fileId);
}

export async function deleteTranscriptsForNotes(noteIds: readonly string[]): Promise<void> {
  const wanted = new Set(noteIds.filter(Boolean));
  if (wanted.size === 0) return;
  cancelTranscriptionsForNotes(wanted);
  if (!('indexedDB' in globalThis) || !indexedDB) return;
  const deletedFileIds: string[] = [];
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as NoteTranscript;
        if (wanted.has(record.noteId)) {
          deletedFileIds.push(record.fileId);
          cursor.delete();
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить расшифровки заметок.'));
    });
  } finally {
    database.close();
  }
  for (const fileId of deletedFileIds) emitTranscriptChange(fileId);
}

export async function updateTranscript(input: {
  readonly fileId: string;
  readonly text?: string;
  readonly speakerNames?: Readonly<Record<string, string>>;
}): Promise<NoteTranscript> {
  const canWrite = (): boolean => !cancelledTranscriptions.has(input.fileId);
  if (!canWrite()) throw new Error('Расшифровка удалена.');
  const current = await loadTranscript(input.fileId);
  if (!current) throw new Error('Расшифровка не найдена.');
  const next: NoteTranscript = {
    ...current,
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.speakerNames !== undefined ? { speakerNames: input.speakerNames } : {}),
    updatedAt: new Date().toISOString(),
  };
  await putTranscript(next, canWrite);
  return next;
}

/**
 * Engine seam: a loaded browser ASR model provides this. Engines may return
 * timestamped chunks; speaker diarization can later replace their speaker IDs
 * without changing note storage or viewer UI.
 */
export type TranscribeEngine = (
  audio: Blob,
  mimeType: string,
) => Promise<string | TranscriptionOutput>;

let activeEngine: TranscribeEngine | null = null;

export function setTranscriptionEngine(engine: TranscribeEngine | null): void {
  activeEngine = engine;
}

const running = new Map<string, { noteId: string; cancel: () => void }>();
const cancelledTranscriptions = new Set<string>();

export function isTranscriptionQueued(fileId: string): boolean {
  return running.has(fileId);
}

export function cancelTranscription(fileId: string): void {
  cancelledTranscriptions.add(fileId);
  running.get(fileId)?.cancel();
}

function cancelTranscriptionsForNotes(noteIds: ReadonlySet<string>): void {
  for (const [fileId, active] of running) {
    if (noteIds.has(active.noteId)) cancelTranscription(fileId);
  }
}

function emitTranscriptChange(fileId: string): void {
  window.dispatchEvent(new CustomEvent(NOTE_TRANSCRIPTS_EVENT, { detail: { fileId } }));
}

function retainedSpeakerNames(
  names: Readonly<Record<string, string>> | undefined,
  output: TranscriptionOutput,
): Readonly<Record<string, string>> | undefined {
  if (output.diarized !== true || !names || !output.segments?.length) return undefined;
  const speakerIds = new Set(output.segments.map((segment) => segment.speakerId));
  const entries = Object.entries(names).filter(
    ([speakerId, label]) => speakerIds.has(speakerId) && label.trim().length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeOutput(output: string | TranscriptionOutput): TranscriptionOutput {
  if (typeof output === 'string') return { text: output };
  return {
    text: output.text,
    ...(output.segments?.length ? { segments: output.segments } : {}),
    ...(output.diarized === true ? { diarized: true } : {}),
  };
}

export function queueTranscription(input: {
  readonly fileId: string;
  readonly noteId: string;
  readonly blob: Blob;
  readonly force?: boolean;
}): void {
  if (running.has(input.fileId)) return;
  cancelledTranscriptions.delete(input.fileId);
  const canWrite = (): boolean => !cancelledTranscriptions.has(input.fileId);
  const ticket = backgroundParity.submit({
    kind: 'transcription',
    priority: PARITY_PRIORITIES.transcription,
    label: `transcribe:${input.fileId}`,
    run: async (ctx) => {
      const existing = await loadTranscript(input.fileId);
      if (existing?.status === 'done' && !input.force) return;
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      if (!activeEngine) {
        await putTranscript({
          fileId: input.fileId,
          noteId: input.noteId,
          text: existing?.text ?? '',
          ...(existing?.segments ? { segments: existing.segments } : {}),
          ...(existing?.speakerNames ? { speakerNames: existing.speakerNames } : {}),
          ...(existing?.diarized === true ? { diarized: true } : {}),
          status: 'unsupported',
          createdAt,
          updatedAt: new Date().toISOString(),
        }, canWrite);
        return;
      }
      await ctx.checkpoint();
      await putTranscript({
        fileId: input.fileId,
        noteId: input.noteId,
        text: existing?.text ?? '',
        ...(existing?.segments ? { segments: existing.segments } : {}),
        ...(existing?.speakerNames ? { speakerNames: existing.speakerNames } : {}),
        ...(existing?.diarized === true ? { diarized: true } : {}),
        status: 'running',
        createdAt,
        updatedAt: new Date().toISOString(),
      }, canWrite);
      try {
        const output = normalizeOutput(
          await activeEngine(input.blob, input.blob.type || 'audio/webm'),
        );
        await ctx.checkpoint();
        const speakerNames = retainedSpeakerNames(existing?.speakerNames, output);
        await putTranscript({
          fileId: input.fileId,
          noteId: input.noteId,
          text: output.text,
          ...(output.segments ? { segments: output.segments } : {}),
          ...(speakerNames ? { speakerNames } : {}),
          ...(output.diarized === true ? { diarized: true } : {}),
          status: 'done',
          createdAt,
          updatedAt: new Date().toISOString(),
        }, canWrite);
      } catch (cause) {
        if (
          ctx.signal.aborted ||
          !canWrite() ||
          cause instanceof PreemptedError ||
          (cause instanceof Error && cause.name === 'AbortError')
        ) {
          throw cause;
        }
        const message = cause instanceof Error ? cause.message : 'Не удалось расшифровать запись.';
        await putTranscript({
          fileId: input.fileId,
          noteId: input.noteId,
          text: existing?.text ?? '',
          ...(existing?.segments ? { segments: existing.segments } : {}),
          ...(existing?.speakerNames ? { speakerNames: existing.speakerNames } : {}),
          ...(existing?.diarized === true ? { diarized: true } : {}),
          status: 'failed',
          error: message,
          createdAt,
          updatedAt: new Date().toISOString(),
        }, canWrite);
        throw cause;
      }
    },
  });
  running.set(input.fileId, {
    noteId: input.noteId,
    cancel: () => ticket.cancel(),
  });
  emitTranscriptChange(input.fileId);
  void ticket.done
    .finally(() => {
      running.delete(input.fileId);
      emitTranscriptChange(input.fileId);
    })
    .catch(() => undefined);
}
