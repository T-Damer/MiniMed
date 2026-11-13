/**
 * Conversation recordings started from the tools list. Audio is written to IndexedDB one
 * MediaRecorder slice at a time, so a closed tab or a crash keeps everything recorded so far;
 * an unfinished recording is reported as interrupted on the next start.
 *
 * REC1 (owner 2026-11-13): beside the compressed audio, an AudioWorklet taps the microphone at
 * 16 kHz for speech recognition and the waveform, so nothing ever decodes the growing file while it
 * records. Those samples are also kept (16-bit, in 5 s blocks) until they have been turned into
 * text: if live recognition cannot keep up, «Расшифровать» reads them later, without decoding the
 * file and without a length limit. Blocks are deleted as soon as their text exists.
 *
 * Recordings are stored unencrypted for now and attached to a patient afterwards; their text lives
 * only in the encrypted vault (`conversation-transcript.ts`).
 */
import pcmTapUrl from '@/features/conversations/pcm-tap.worklet.ts?worker&url';
import { fromInt16, toInt16 } from '@/features/conversations/recording-audio';

const DATABASE_NAME = 'minimed-conversations';
const DATABASE_VERSION = 2;
const META_STORE = 'recordings';
const CHUNK_STORE = 'chunks';
const PCM_STORE = 'pcm';
export const CONVERSATION_RECORDINGS_EVENT = 'minimed:conversation-recordings';
const SLICE_MS = 1_000;
const BITRATE = 48_000;
export const RECORDING_SAMPLE_RATE = 16_000;
/** Samples per stored block: 5 s. */
const PCM_BLOCK = RECORDING_SAMPLE_RATE * 5;
/** Recent waveform peaks kept for the live drawing: 20 a second, 12 s. */
const RECENT_PEAKS = 240;

export type ConversationRecordingStatus = 'recording' | 'stopped' | 'interrupted';

export interface ConversationRecording {
  readonly id: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly mimeType: string;
  readonly status: ConversationRecordingStatus;
  /** Recorded time, pauses excluded. */
  readonly durationMs: number;
  readonly chunkCount: number;
  readonly bytes: number;
  /** Set once the audio has been copied into a patient's card. */
  readonly attachedTo?: { readonly patientId: string; readonly eventId: string };
  /** The patient chosen while recording: the recording goes to their card when it stops. */
  readonly patientId?: string;
  /** 16 kHz samples captured, and how many of them are already text (or silence). */
  readonly samples?: number;
  readonly transcribedSamples?: number;
  /** Waveform overview: the loudest sample of every second, 0–1. */
  readonly peaks?: readonly number[];
}

interface StoredChunk {
  readonly recordingId: string;
  readonly index: number;
  readonly blob: Blob;
}

interface StoredPcm {
  readonly recordingId: string;
  /** Absolute index of the block's first sample. */
  readonly start: number;
  readonly samples: Int16Array;
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
      if (!database.objectStoreNames.contains(PCM_STORE)) {
        database.createObjectStore(PCM_STORE, { keyPath: ['recordingId', 'start'] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Хранилище записей недоступно.'));
  });
}

type Stores = Readonly<Record<'meta' | 'chunks' | 'pcm', IDBObjectStore>>;

async function inTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (stores: Stores) => Promise<T> | T,
): Promise<T> {
  const transaction = database.transaction([META_STORE, CHUNK_STORE, PCM_STORE], mode);
  const done = transactionDone(transaction);
  const result = await run({
    meta: transaction.objectStore(META_STORE),
    chunks: transaction.objectStore(CHUNK_STORE),
    pcm: transaction.objectStore(PCM_STORE),
  });
  await done;
  return result;
}

async function withStores<T>(
  mode: IDBTransactionMode,
  run: (stores: Stores) => Promise<T> | T,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await inTransaction(database, mode, run);
  } finally {
    database.close();
  }
}

function notify(): void {
  window.dispatchEvent(new Event(CONVERSATION_RECORDINGS_EVENT));
}

const recordingRange = (id: string): IDBKeyRange =>
  IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

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
  const all = await withStores('readonly', ({ meta }) =>
    requestResult(meta.getAll() as IDBRequest<ConversationRecording[]>),
  );
  return all.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function readConversationRecording(
  id: string,
): Promise<ConversationRecording | undefined> {
  return withStores('readonly', ({ meta }) =>
    requestResult(meta.get(id) as IDBRequest<ConversationRecording | undefined>),
  );
}

/** Marks recordings left in `recording` by a previous session as interrupted (still playable). */
export async function recoverInterruptedRecordings(activeId?: string): Promise<number> {
  const recovered = await withStores('readwrite', async ({ meta }) => {
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
  return withStores('readonly', async ({ meta, chunks }) => {
    const recording = await requestResult(
      meta.get(id) as IDBRequest<ConversationRecording | undefined>,
    );
    if (!recording) throw new Error('Запись не найдена.');
    const stored = await requestResult(
      chunks.getAll(recordingRange(id)) as IDBRequest<StoredChunk[]>,
    );
    return new Blob(
      stored.toSorted((left, right) => left.index - right.index).map((chunk) => chunk.blob),
      { type: recording.mimeType.split(';')[0] || 'audio/webm' },
    );
  });
}

/** Changes a recording's own fields (patient chosen, text progress, peaks); others stay. */
export async function updateConversationRecording(
  id: string,
  patch: Partial<
    Pick<ConversationRecording, 'patientId' | 'transcribedSamples' | 'peaks' | 'attachedTo'>
  >,
): Promise<void> {
  await withStores('readwrite', async ({ meta }) => {
    const recording = await requestResult(
      meta.get(id) as IDBRequest<ConversationRecording | undefined>,
    );
    if (recording) meta.put({ ...recording, ...patch } satisfies ConversationRecording);
  });
  notify();
}

export async function markConversationAttached(
  id: string,
  attachedTo: { readonly patientId: string; readonly eventId: string },
): Promise<void> {
  await updateConversationRecording(id, { attachedTo });
}

export async function deleteConversationRecording(id: string): Promise<void> {
  await withStores('readwrite', ({ meta, chunks, pcm }) => {
    meta.delete(id);
    chunks.delete(recordingRange(id));
    pcm.delete(recordingRange(id));
  });
  notify();
}

/** The stored 16 kHz samples not yet turned into text, block by block from `from` on. */
export async function* readStoredSamples(
  id: string,
  from = 0,
): AsyncGenerator<{ readonly start: number; readonly samples: Float32Array }> {
  const blocks = await withStores('readonly', ({ pcm }) =>
    requestResult(pcm.getAllKeys(recordingRange(id)) as unknown as IDBRequest<[string, number][]>),
  );
  for (const [, start] of blocks.toSorted((left, right) => left[1] - right[1])) {
    if (start + PCM_BLOCK <= from) continue;
    const block = await withStores('readonly', ({ pcm }) =>
      requestResult(pcm.get([id, start]) as IDBRequest<StoredPcm | undefined>),
    );
    if (!block) continue;
    const samples = fromInt16(block.samples);
    const skip = Math.max(0, from - start);
    yield { start: start + skip, samples: skip > 0 ? samples.subarray(skip) : samples };
  }
}

/** The span of stored samples, or null when all of the recording is already text. */
export async function storedSampleSpan(
  id: string,
): Promise<{ readonly from: number; readonly to: number } | null> {
  const blocks = await withStores('readonly', ({ pcm }) =>
    requestResult(pcm.getAll(recordingRange(id)) as IDBRequest<StoredPcm[]>),
  );
  if (blocks.length === 0) return null;
  const sorted = blocks.toSorted((left, right) => left.start - right.start);
  const last = sorted[sorted.length - 1];
  return { from: sorted[0]?.start ?? 0, to: (last?.start ?? 0) + (last?.samples.length ?? 0) };
}

/** Deletes the stored blocks that lie wholly before `sample`: their text exists now. */
export async function releaseStoredSamples(id: string, sample: number): Promise<void> {
  await withStores('readwrite', ({ pcm }) => {
    pcm.delete(IDBKeyRange.bound([id, 0], [id, sample - PCM_BLOCK]));
  });
}

export interface ConversationRecorder {
  readonly id: string;
  readonly startedAt: number;
  /** Recorded time so far, pauses excluded. */
  elapsedMs(): number;
  paused(): boolean;
  pause(): void;
  resume(): void;
  /** 0–1 level of the last 50 ms. */
  level(): number;
  /** Copies the most recent peaks (oldest first) into `target`; returns how many were written. */
  recentPeaks(target: Float32Array): number;
  /** Every 50 ms of 16 kHz samples as they arrive; returns the unsubscribe. */
  onSamples(listener: (samples: Float32Array) => void): () => void;
  /** Absolute count of 16 kHz samples captured. */
  samples(): number;
  stop(): Promise<ConversationRecording>;
}

/** A 16 kHz context when the browser allows one (it resamples the microphone well), else default. */
function createTapContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE, latencyHint: 'playback' });
  } catch {
    return new AudioContext({ latencyHint: 'playback' });
  }
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
      // A conversation across a table, not a headset call: echo cancellation and noise suppression
      // are tuned for a voice close to the microphone and garble the far speaker (REC1).
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });
  const database = await openDatabase();
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
    samples: 0,
    transcribedSamples: 0,
  };
  let writes: Promise<void> = inTransaction(database, 'readwrite', ({ meta: store }) => {
    store.put(meta);
  });
  await writes;
  notify();

  // Time recorded, pauses excluded.
  let activeSince: number | null = startedAt;
  let activeMs = 0;
  const elapsedMs = (): number => activeMs + (activeSince === null ? 0 : Date.now() - activeSince);

  const queue = (run: (stores: Stores) => void): void => {
    writes = writes
      .then(() => inTransaction(database, 'readwrite', run))
      .catch(() => onFailure('Не удалось сохранить часть записи на устройство.'));
  };

  // The audio-thread tap: 16 kHz samples and a peak every 50 ms.
  const context = createTapContext();
  const source = context.createMediaStreamSource(stream);
  let tap: AudioWorkletNode | undefined;
  const listeners = new Set<(samples: Float32Array) => void>();
  const recent = new Float32Array(RECENT_PEAKS);
  let recentCount = 0;
  let lastPeak = 0;
  let captured = 0;
  const overview: number[] = [];
  let secondPeak = 0;
  let secondFill = 0;
  let block = new Int16Array(PCM_BLOCK);
  let blockFill = 0;
  let blockStart = 0;

  const storeBlock = (): void => {
    if (blockFill === 0) return;
    const stored: StoredPcm = {
      recordingId: id,
      start: blockStart,
      samples: block.slice(0, blockFill),
    };
    queue(({ pcm }) => {
      pcm.put(stored);
    });
    blockStart += blockFill;
    block = new Int16Array(PCM_BLOCK);
    blockFill = 0;
  };

  const onTap = (samples: Float32Array, peak: number): void => {
    lastPeak = peak;
    recent[recentCount % RECENT_PEAKS] = peak;
    recentCount += 1;
    secondPeak = Math.max(secondPeak, peak);
    secondFill += samples.length;
    if (secondFill >= RECORDING_SAMPLE_RATE) {
      overview.push(Math.round(secondPeak * 1000) / 1000);
      secondPeak = 0;
      secondFill -= RECORDING_SAMPLE_RATE;
    }
    const int16 = toInt16(samples);
    let offset = 0;
    while (offset < int16.length) {
      const take = Math.min(PCM_BLOCK - blockFill, int16.length - offset);
      block.set(int16.subarray(offset, offset + take), blockFill);
      blockFill += take;
      offset += take;
      if (blockFill === PCM_BLOCK) storeBlock();
    }
    captured += samples.length;
    for (const listener of listeners) listener(samples);
  };

  try {
    await context.audioWorklet.addModule(pcmTapUrl);
    tap = new AudioWorkletNode(context, 'minimed-pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    tap.port.onmessage = (event: MessageEvent<{ samples: Float32Array; peak: number }>) =>
      onTap(event.data.samples, event.data.peak);
    source.connect(tap);
  } catch {
    // No worklet (very old WebView): the recording still works; there is no live text or waveform.
    onFailure('Живой текст и уровень звука на этом устройстве недоступны. Запись идёт.');
  }

  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: BITRATE,
  });
  const persist = (blob: Blob, final: boolean): void => {
    const index = meta.chunkCount;
    meta = {
      ...meta,
      updatedAt: new Date().toISOString(),
      durationMs: elapsedMs(),
      chunkCount: index + (blob.size > 0 ? 1 : 0),
      bytes: meta.bytes + blob.size,
      samples: captured,
      ...(final ? { status: 'stopped' as const, peaks: overview.slice() } : {}),
    };
    const snapshot = meta;
    queue(({ meta: store, chunks }) => {
      if (blob.size > 0) chunks.put({ recordingId: id, index, blob } satisfies StoredChunk);
      // A patient chosen or text progress written meanwhile by the session is kept.
      const read = store.get(id) as IDBRequest<ConversationRecording | undefined>;
      read.onsuccess = () => {
        const current = read.result;
        store.put({
          ...snapshot,
          ...(current?.patientId ? { patientId: current.patientId } : {}),
          ...(current?.transcribedSamples !== undefined
            ? { transcribedSamples: current.transcribedSamples }
            : {}),
          ...(current?.attachedTo ? { attachedTo: current.attachedTo } : {}),
        } satisfies ConversationRecording);
      };
    });
  };
  recorder.ondataavailable = (event) => persist(event.data, false);
  recorder.onerror = () => onFailure('Запись с микрофона прервалась. Сохранённая часть осталась.');
  recorder.start(SLICE_MS);

  const release = (): void => {
    for (const track of stream.getTracks()) track.stop();
    tap?.port.close();
    source.disconnect();
    void context.close();
  };

  return {
    id,
    startedAt,
    elapsedMs,
    paused: () => activeSince === null,
    pause() {
      if (activeSince === null || recorder.state !== 'recording') return;
      activeMs += Date.now() - activeSince;
      activeSince = null;
      recorder.pause();
      tap?.port.postMessage({ type: 'pause' });
      lastPeak = 0;
    },
    resume() {
      if (activeSince !== null || recorder.state !== 'paused') return;
      activeSince = Date.now();
      recorder.resume();
      tap?.port.postMessage({ type: 'resume' });
    },
    level: () => lastPeak,
    recentPeaks(target) {
      const count = Math.min(target.length, recentCount, RECENT_PEAKS);
      for (let index = 0; index < count; index += 1) {
        target[index] = recent[(recentCount - count + index) % RECENT_PEAKS] ?? 0;
      }
      return count;
    },
    onSamples(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    samples: () => captured,
    stop() {
      return new Promise((resolve, reject) => {
        recorder.onstop = () => {
          if (activeSince !== null) {
            activeMs += Date.now() - activeSince;
            activeSince = null;
          }
          release();
          listeners.clear();
          storeBlock();
          persist(new Blob([], { type: mimeType }), true);
          writes.then(() => {
            database.close();
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
