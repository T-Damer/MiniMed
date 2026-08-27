import { setTranscriptionEngine } from '@/state/note-transcription';

import type { AsrTranscribeMessage, AsrWorkerInMessage, AsrWorkerOutMessage } from './asr.worker';

export interface AsrModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly language: 'ru' | 'multilingual';
  readonly preferredForRussian: boolean;
  /** False while the weights lack a transformers.js-executable export. */
  readonly runtimeReady: boolean;
}

/** On-device ASR candidates supported by the current transformers.js pipeline. */
export const ASR_MODELS: readonly AsrModelDescriptor[] = [
  {
    id: 'onnx-community/whisper-base',
    name: 'Whisper Base (q8)',
    description: 'Компактная модель для обычных голосовых заметок.',
    language: 'multilingual',
    preferredForRussian: true,
    runtimeReady: true,
  },
  {
    id: 'onnx-community/whisper-small',
    name: 'Whisper Small (q8)',
    description: 'Точнее на шумной записи, но требует больше памяти.',
    language: 'multilingual',
    preferredForRussian: false,
    runtimeReady: true,
  },
  {
    id: 'gigaam-v3-onnx',
    name: 'GigaAM v3 (ONNX)',
    description: 'требует отдельного GigaAM-препроцессора и CTC-декодера',
    language: 'ru',
    preferredForRussian: true,
    runtimeReady: false,
  },
];

const SELECTED_KEY = 'minimed.asr.selected';
const TARGET_SAMPLE_RATE = 16_000;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function selectedAsrModelId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function selectAsrModel(id: string | null): void {
  try {
    if (id) localStorage.setItem(SELECTED_KEY, id);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    // storage unavailable — selection stays in-memory for this page only
  }
  emit();
}

const readyModels = new Set<string>();

export function isModelReady(modelId: string): boolean {
  return readyModels.has(modelId);
}

export function subscribeAsr(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const progressListeners = new Map<string, ((fraction: number | null) => void) | undefined>();

export function onAsrProgress(
  modelId: string,
  listener: (fraction: number | null) => void,
): () => void {
  progressListeners.set(modelId, listener);
  return () => {
    if (progressListeners.get(modelId) === listener) progressListeners.delete(modelId);
  };
}

function reportProgress(modelId: string, fraction: number | null): void {
  progressListeners.get(modelId)?.(fraction);
}

let worker: Worker | null = null;
const activationWaiters = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void }
>();
const activations = new Map<string, Promise<void>>();
const pendingResults = new Map<
  string,
  { resolve: (text: string) => void; reject: (error: Error) => void }
>();
let requestCounter = 0;

function failAll(error: Error): void {
  for (const waiter of activationWaiters.values()) waiter.reject(error);
  activationWaiters.clear();
  activations.clear();
  for (const pending of pendingResults.values()) pending.reject(error);
  pendingResults.clear();
  emit();
}

function workerInstance(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = (event: MessageEvent<AsrWorkerOutMessage>) => {
    const message = event.data;
    switch (message.type) {
      case 'loading':
        reportProgress(message.modelId, message.progress);
        break;
      case 'ready': {
        readyModels.add(message.modelId);
        reportProgress(message.modelId, null);
        activationWaiters.get(message.modelId)?.resolve();
        activationWaiters.delete(message.modelId);
        activations.delete(message.modelId);
        selectAsrModel(message.modelId);
        setTranscriptionEngine(makeEngine(instance, message.modelId));
        emit();
        break;
      }
      case 'load-error': {
        reportProgress(message.modelId, null);
        const waiter = activationWaiters.get(message.modelId);
        waiter?.reject(new Error(message.message));
        activationWaiters.delete(message.modelId);
        activations.delete(message.modelId);
        emit();
        break;
      }
      case 'result': {
        pendingResults.get(message.requestId)?.resolve(message.text);
        pendingResults.delete(message.requestId);
        break;
      }
      case 'transcribe-error': {
        pendingResults.get(message.requestId)?.reject(new Error(message.message));
        pendingResults.delete(message.requestId);
        break;
      }
    }
  };
  instance.onerror = () => {
    worker = null;
    failAll(new Error('Речевой движок остановился с ошибкой.'));
  };
  worker = instance;
  return instance;
}

async function decodeToPcm16k(audio: Blob): Promise<Float32Array> {
  const bytes = await audio.arrayBuffer();
  const decodeContext = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await decodeContext.decodeAudioData(bytes);
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const resampler = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = resampler.createBufferSource();
  source.buffer = decoded;
  source.connect(resampler.destination);
  source.start();
  const rendered = await resampler.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

function makeEngine(instance: Worker, modelId: string) {
  return async (audio: Blob): Promise<string> => {
    if (!readyModels.has(modelId)) throw new Error('Модель не активирована');
    const pcm = await decodeToPcm16k(audio);
    requestCounter += 1;
    const requestId = `asr-${requestCounter}`;
    const promise = new Promise<string>((resolve, reject) => {
      pendingResults.set(requestId, { resolve, reject });
    });
    const message: AsrTranscribeMessage = {
      type: 'transcribe',
      requestId,
      audio: pcm,
      modelId,
    };
    instance.postMessage(message satisfies AsrWorkerInMessage, [pcm.buffer]);
    return promise;
  };
}

/** Loads the model into the worker and registers it as transcription engine. */
export function activateAsrModel(id: string): Promise<void> {
  const inFlight = activations.get(id);
  if (inFlight) return inFlight;
  if (!ASR_MODELS.some((model) => model.id === id && model.runtimeReady)) {
    return Promise.reject(new Error('Модель недоступна в этом рантайме.'));
  }
  if (readyModels.has(id)) {
    selectAsrModel(id);
    setTranscriptionEngine(makeEngine(workerInstance(), id));
    return Promise.resolve();
  }
  const promise = new Promise<void>((resolve, reject) => {
    activationWaiters.set(id, { resolve, reject });
    workerInstance().postMessage({ type: 'load', modelId: id } satisfies AsrWorkerInMessage);
  });
  activations.set(id, promise);
  return promise;
}

export async function activateSelectedAsrModel(): Promise<boolean> {
  const id = selectedAsrModelId();
  if (!id || !ASR_MODELS.some((model) => model.id === id && model.runtimeReady)) {
    setTranscriptionEngine(null);
    return false;
  }
  try {
    await activateAsrModel(id);
    return true;
  } catch {
    setTranscriptionEngine(null);
    return false;
  }
}

/** Rejection payload for loads interrupted by `pauseAsrDownloads` — never user-facing. */
export class AsrCancelledError extends Error {
  constructor() {
    super('Загрузка модели отменена.');
    this.name = 'AsrCancelledError';
  }
}

/**
 * Stops any in-flight model download by terminating the worker (loaded models
 * die with it). No-op when nothing is loading, so a finished model survives
 * switching selection.
 */
export function pauseAsrDownloads(): void {
  if (!worker || activations.size === 0) return;
  const instance = worker;
  worker = null;
  instance.terminate();
  readyModels.clear();
  setTranscriptionEngine(null);
  failAll(new AsrCancelledError());
}

export function isAsrReady(): boolean {
  const id = selectedAsrModelId();
  return Boolean(id && readyModels.has(id));
}

/** Runs the selected ready model over an audio blob. Throws when no model is active. */
export function transcribeBlob(audio: Blob): Promise<string> {
  const id = selectedAsrModelId();
  if (!id || !readyModels.has(id))
    return Promise.reject(new Error('Модель расшифровки не активна.'));
  return makeEngine(workerInstance(), id)(audio);
}
