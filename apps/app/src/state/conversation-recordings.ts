/**
 * Conversation recordings started from the home screen. Audio is written to IndexedDB one
 * MediaRecorder slice at a time, so a closed tab or a crash keeps everything recorded so far;
 * an unfinished recording is reported as interrupted on the next start.
 * Recordings are stored unencrypted for now and attached to a patient afterwards.
 */

const DATABASE_NAME = 'minimed-conversations';
const DATABASE_VERSION = 1;
const META_STORE = 'recordings';
const CHUNK_STORE = 'chunks';
export const CONVERSATION_RECORDINGS_EVENT = 'minimed:conversation-recordings';
const SLICE_MS = 1_000;
const BITRATE = 48_000;

export type ConversationRecordingStatus = 'recording' | 'stopped' | 'interrupted';

export interface ConversationRecording {
  readonly id: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly mimeType: string;
  readonly status: ConversationRecordingStatus;
  readonly durationMs: number;
  readonly chunkCount: number;
  readonly bytes: number;
  /** Set once the audio has been copied into a patient's card. */
  readonly attachedTo?: { readonly patientId: string; readonly eventId: string };
}

interface StoredChunk {
  readonly recordingId: string;
  readonly index: number;
  readonly blob: Blob;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка хранилища записей.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка хранилища записей.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Запись в хранилище отменена.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        database.createObjectStore(CHUNK_STORE, { keyPath: ['recordingId', 'index'] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Хранилище записей недоступно.'));
  });
}

async function withStores<T>(
  mode: IDBTransactionMode,
  run: (meta: IDBObjectStore, chunks: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([META_STORE, CHUNK_STORE], mode);
    const done = transactionDone(transaction);
    const result = await run(
      transaction.objectStore(META_STORE),
      transaction.objectStore(CHUNK_STORE),
    );
    await done;
    return result;
  } finally {
    database.close();
  }
}

function notify(): void {
  window.dispatchEvent(new Event(CONVERSATION_RECORDINGS_EVENT));
}

export function recorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const candidate of [
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

export function conversationFileExtension(mimeType: string): string {
  if (mimeType.startsWith('audio/ogg')) return 'ogg';
  if (mimeType.startsWith('audio/mp4')) return 'm4a';
  return 'webm';
}

export async function listConversationRecordings(): Promise<readonly ConversationRecording[]> {
  const all = await withStores('readonly', (meta) =>
    requestResult(meta.getAll() as IDBRequest<ConversationRecording[]>),
  );
  return all.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

/** Marks recordings left in `recording` by a previous session as interrupted (still playable). */
export async function recoverInterruptedRecordings(activeId?: string): Promise<number> {
  const recovered = await withStores('readwrite', async (meta) => {
    const all = await requestResult(meta.getAll() as IDBRequest<ConversationRecording[]>);
    let count = 0;
    for (const recording of all) {
      if (recording.status !== 'recording' || recording.id === activeId) continue;
      meta.put({ ...recording, status: 'interrupted' } satisfies ConversationRecording);
      count += 1;
    }
    return count;
  });
  if (recovered > 0) notify();
  return recovered;
}

export async function readConversationAudio(id: string): Promise<Blob> {
  return withStores('readonly', async (meta, chunks) => {
    const recording = await requestResult(
      meta.get(id) as IDBRequest<ConversationRecording | undefined>,
    );
    if (!recording) throw new Error('Запись не найдена.');
    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
    const stored = await requestResult(chunks.getAll(range) as IDBRequest<StoredChunk[]>);
    return new Blob(
      stored.toSorted((left, right) => left.index - right.index).map((chunk) => chunk.blob),
      { type: recording.mimeType.split(';')[0] || 'audio/webm' },
    );
  });
}

export async function markConversationAttached(
  id: string,
  attachedTo: { readonly patientId: string; readonly eventId: string },
): Promise<void> {
  await withStores('readwrite', async (meta) => {
    const recording = await requestResult(
      meta.get(id) as IDBRequest<ConversationRecording | undefined>,
    );
    if (recording) meta.put({ ...recording, attachedTo } satisfies ConversationRecording);
  });
  notify();
}

export async function deleteConversationRecording(id: string): Promise<void> {
  await withStores('readwrite', (meta, chunks) => {
    meta.delete(id);
    chunks.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });
  notify();
}

export interface ConversationRecorder {
  readonly id: string;
  readonly startedAt: number;
  /** 0–1 microphone level for a live meter. */
  level(): number;
  stop(): Promise<ConversationRecording>;
}

/**
 * Starts recording immediately. Every slice is committed before the next arrives; the metadata
 * row is updated alongside it so a partial recording is always consistent.
 */
export async function startConversationRecording(
  onFailure: (message: string) => void,
): Promise<ConversationRecorder> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Запись звука в этом браузере недоступна.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const mimeType = recorderMimeType();
  const id = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let meta: ConversationRecording = {
    id,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date(startedAt).toISOString(),
    mimeType: mimeType || 'audio/webm',
    status: 'recording',
    durationMs: 0,
    chunkCount: 0,
    bytes: 0,
  };
  await withStores('readwrite', (store) => {
    store.put(meta);
  });
  notify();

  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: BITRATE,
  });
  let writes: Promise<void> = Promise.resolve();
  const persist = (blob: Blob, final: boolean): void => {
    const index = meta.chunkCount;
    meta = {
      ...meta,
      updatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      chunkCount: index + (blob.size > 0 ? 1 : 0),
      bytes: meta.bytes + blob.size,
      ...(final ? { status: 'stopped' as const } : {}),
    };
    const snapshot = meta;
    writes = writes
      .then(() =>
        withStores('readwrite', (store, chunks) => {
          if (blob.size > 0) chunks.put({ recordingId: id, index, blob } satisfies StoredChunk);
          store.put(snapshot);
        }),
      )
      .catch(() => onFailure('Не удалось сохранить часть записи на устройство.'));
  };
  recorder.ondataavailable = (event) => persist(event.data, false);
  recorder.onerror = () => onFailure('Запись с микрофона прервалась. Сохранённая часть осталась.');
  recorder.start(SLICE_MS);

  const release = (): void => {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return {
    id,
    startedAt,
    level() {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      return Math.min(1, peak / 64);
    },
    stop() {
      return new Promise((resolve, reject) => {
        recorder.onstop = () => {
          release();
          persist(new Blob([], { type: mimeType }), true);
          writes.then(() => {
            notify();
            resolve(meta);
          }, reject);
        };
        if (recorder.state === 'inactive') recorder.onstop(new Event('stop'));
        else recorder.stop();
      });
    },
  };
}
