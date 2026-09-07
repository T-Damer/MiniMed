import type { DownloadContext } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { downloadWithRetry } from '@/features/network/download-retry';
import { setTranscriptionEngine } from '@/state/note-transcription';
import type { AsrTranscribeMessage, AsrWorkerInMessage, AsrWorkerOutMessage } from './asr.worker';
import {
  ASR_DOWNLOAD_VERSION,
  type AsrAssetRequest,
  type AsrAssetResponse,
  asrDownloadId,
  assertAsrAssetRequest,
} from './asr-download-protocol';

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

const downloadContexts = new Map<string, DownloadContext>();
const assetControllers = new Set<AbortController>();
const assetWork = new Map<string, Set<Promise<void>>>();
const assetProgress = new Map<string, Map<string, { loaded: number; total: number | null }>>();

async function fetchAsset(instance: Worker, request: AsrAssetRequest): Promise<void> {
  let response: AsrAssetResponse;
  const controller = new AbortController();
  const context = downloadContexts.get(request.modelId);
  const abort = (): void => controller.abort();
  context?.signal.addEventListener('abort', abort, { once: true });
  assetControllers.add(controller);
  try {
    assertAsrAssetRequest(request);
    if (!context || context.signal.aborted)
      throw new DOMException('Download cancelled.', 'AbortError');
    if (request.metadataOnly) {
      response = await getDownloadQueue().transfer(
        context.id,
        `speech-metadata:${request.url}`,
        controller.signal,
        async () => {
          const head = await fetch(request.url, {
            signal: controller.signal,
            credentials: 'omit',
            headers: { Range: 'bytes=0-0' },
          });
          // The metadata API consumes headers only. Cancel even a server's ignored-range 200 body.
          await head.body?.cancel();
          return {
            type: 'asset-response',
            requestId: request.requestId,
            status: head.status,
            headers: [...head.headers].filter(([key]) =>
              ['content-type', 'content-length', 'content-range'].includes(key),
            ),
            bytes: null,
          };
        },
      );
    } else {
      const data = await downloadWithRetry({
        url: request.url,
        cacheKey: `speech:${ASR_DOWNLOAD_VERSION}:${request.url}`,
        jobId: context.id,
        signal: controller.signal,
        trackProgress: false,
        retryMissingAssets: false,
        onProgress: ({ downloadedBytes, totalBytes }) => {
          const progress =
            assetProgress.get(request.modelId) ??
            new Map<string, { loaded: number; total: number | null }>();
          progress.set(request.url, { loaded: downloadedBytes, total: totalBytes });
          assetProgress.set(request.modelId, progress);
          const items = [...progress.values()];
          // The complete file list is owned by transformers.js; do not invent an aggregate total.
          context.progress(
            items.reduce((sum, item) => sum + item.loaded, 0),
            null,
          );
        },
      });
      const buffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      response = {
        type: 'asset-response',
        requestId: request.requestId,
        status: 200,
        headers: [
          ['content-length', String(data.byteLength)],
          [
            'content-type',
            request.url.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          ],
        ],
        bytes: buffer,
      };
    }
  } catch (cause) {
    const missing = cause instanceof Error && /HTTP 404/u.test(cause.message);
    response = {
      type: 'asset-response',
      requestId: request.requestId,
      status: missing ? 404 : 503,
      headers: [],
      bytes: null,
      ...(missing
        ? {}
        : {
            error: controller.signal.aborted
              ? 'Загрузка отменена.'
              : 'Не удалось скачать файл речевой модели.',
          }),
    };
  } finally {
    context?.signal.removeEventListener('abort', abort);
    assetControllers.delete(controller);
  }
  if (worker === instance) instance.postMessage(response, response.bytes ? [response.bytes] : []);
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
      case 'fetch-asset': {
        const work = fetchAsset(instance, message);
        const pending = assetWork.get(message.modelId) ?? new Set<Promise<void>>();
        pending.add(work);
        assetWork.set(message.modelId, pending);
        void work.then(
          () => pending.delete(work),
          () => {
            pending.delete(work);
            failAll(new Error('Не удалось передать файл речевому движку.'));
          },
        );
        break;
      }
      case 'loading':
        reportProgress(message.modelId, message.progress);
        if (message.progress !== null && message.progress >= 1) {
          const context = downloadContexts.get(message.modelId);
          if (context && !context.signal.aborted) context.phase('verifying');
        }
        break;
      case 'ready': {
        readyModels.add(message.modelId);
        reportProgress(message.modelId, null);
        activationWaiters.get(message.modelId)?.resolve();
        activationWaiters.delete(message.modelId);
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
    for (const controller of assetControllers) controller.abort();
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
  const descriptor = ASR_MODELS.find((model) => model.id === id);
  const promise = getDownloadQueue().run(
    {
      id: asrDownloadId(id),
      kind: 'speech',
      title: descriptor?.name ?? 'Речевая модель',
      resume: { kind: 'speech', id, version: ASR_DOWNLOAD_VERSION },
    },
    async (context) => {
      downloadContexts.set(id, context);
      assetProgress.delete(id);
      const abort = (): void => pauseAsrDownloads();
      context.signal.addEventListener('abort', abort, { once: true });
      try {
        await new Promise<void>((resolve, reject) => {
          activationWaiters.set(id, { resolve, reject });
          workerInstance().postMessage({ type: 'load', modelId: id } satisfies AsrWorkerInMessage);
        });
        context.signal.throwIfAborted();
      } finally {
        context.signal.removeEventListener('abort', abort);
        downloadContexts.delete(id);
        // Terminating a worker alone does not abort the host's downloads. Wait for those too.
        await Promise.allSettled([...(assetWork.get(id) ?? [])]);
        assetWork.delete(id);
        assetProgress.delete(id);
      }
    },
    { retry: () => activateAsrModel(id) },
  );
  activations.set(id, promise);
  const cleanup = (): void => {
    if (activations.get(id) === promise) activations.delete(id);
  };
  void promise.then(cleanup, cleanup);
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
    this.name = 'AbortError';
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
  for (const controller of assetControllers) controller.abort();
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
