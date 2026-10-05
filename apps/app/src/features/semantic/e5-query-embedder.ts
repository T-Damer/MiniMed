import { E5_SMALL_FUSION, E5_SMALL_PROFILE, NeuralQueryEmbedder } from '@localmed/search-semantic';
import type { E5EmbedMessage, E5WorkerOutMessage } from './e5.worker';
import { isE5ModelInstalled } from './e5-model-cache';

/**
 * The on-device e5-small query embedder handed to MedicalCore. Until the model is downloaded,
 * `embedQuery` rejects and the core reports `semantic-error:semantic-model-not-installed` with
 * complete lexical results (ADR 0008 fallback).
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

async function encode(text: string): Promise<Float32Array> {
  installed ??= await isE5ModelInstalled();
  if (!installed) {
    installed = null;
    throw new Error('semantic-model-not-installed');
  }
  const requestId = ++requestCounter;
  return new Promise<Float32Array>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const message: E5EmbedMessage = { type: 'embed', requestId, text };
    embeddingWorker().postMessage(message);
  });
}

export const E5_QUERY_EMBEDDER = new NeuralQueryEmbedder(E5_SMALL_PROFILE, encode, E5_SMALL_FUSION);
