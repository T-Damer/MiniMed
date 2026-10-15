import { KD1_FUSION, KD1_PROFILE, NeuralQueryEmbedder } from '@localmed/search-semantic';
import type { E5EmbedMessage, E5WorkerOutMessage } from './e5.worker';
import { discardDownloadedE5Model, isDownloadedE5ModelInstalled } from './e5-model-cache';
import { resolveE5ModelSource } from './e5-model-source';

/**
 * The on-device query embedder handed to MedicalCore. The model is loaded lazily, by the worker, on
 * the first query that needs it: from the APK's bundled copy on Android, from the downloaded copy
 * elsewhere. Until the downloaded model exists, `embedQuery` rejects and the core reports
 * `semantic-error:semantic-model-not-installed` with complete lexical results (ADR 0008 fallback).
 */
let worker: Worker | null = null;
let requestCounter = 0;
const pending = new Map<
  number,
  { resolve: (values: Float32Array) => void; reject: (error: Error) => void }
>();

function embeddingWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./e5.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<E5WorkerOutMessage>) => {
    const message = event.data;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.type === 'embedding') request.resolve(message.values);
    else request.reject(new Error(message.message));
  };
  created.onerror = () => {
    for (const request of pending.values()) request.reject(new Error('semantic-worker-failed'));
    pending.clear();
    created.terminate();
    worker = null;
  };
  worker = created;
  return created;
}

let installed: boolean | null = null;

/** Called after an install or removal so the next query re-reads the cache state. */
export function resetE5QueryEmbedder(): void {
  installed = null;
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) request.reject(new Error('semantic-worker-reset'));
  pending.clear();
}

let downloadedCopyDiscarded = false;

/** Once the bundled model has answered, an older downloaded copy (≈130 MB) is no longer needed. */
function discardDownloadedCopyOnce(): void {
  if (downloadedCopyDiscarded) return;
  downloadedCopyDiscarded = true;
  discardDownloadedE5Model().catch((cause: unknown) => {
    downloadedCopyDiscarded = false;
    console.warn('Загруженная копия модели поиска по смыслу не удалена.', cause);
  });
}

async function encode(text: string): Promise<Float32Array> {
  const source = await resolveE5ModelSource();
  if (source.kind === 'download') {
    installed ??= await isDownloadedE5ModelInstalled();
    if (!installed) {
      installed = null;
      throw new Error('semantic-model-not-installed');
    }
  }
  const requestId = ++requestCounter;
  const values = await new Promise<Float32Array>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const message: E5EmbedMessage = { type: 'embed', requestId, text, source };
    embeddingWorker().postMessage(message);
  });
  if (source.kind === 'bundled') discardDownloadedCopyOnce();
  return values;
}

export const E5_QUERY_EMBEDDER = new NeuralQueryEmbedder(KD1_PROFILE, encode, KD1_FUSION);
