import { env, type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';
import { E5_MODEL_ID, E5_MODEL_REVISION, pinnedE5File } from './e5-model';
import { readE5ModelFile } from './e5-model-cache';

/** Query text in, float embedding out. Query text never leaves this worker or reaches a log. */
export interface E5EmbedMessage {
  readonly type: 'embed';
  readonly requestId: number;
  readonly text: string;
}

export type E5WorkerOutMessage =
  | { readonly type: 'embedding'; readonly requestId: number; readonly values: Float32Array }
  | { readonly type: 'embed-error'; readonly requestId: number; readonly message: string };

env.allowLocalModels = false;
// Every model file comes from the verified local cache; a missing file is an error, not a download.
env.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  const file = pinnedE5File(url);
  if (!file) throw new Error('Unsupported semantic model request.');
  const data = await readE5ModelFile(file.path);
  if (!data) throw new Error('semantic-model-not-installed');
  return new Response(data, {
    status: 200,
    headers: { 'content-length': String(data.size) },
  });
};

const scope = self as unknown as {
  postMessage(message: E5WorkerOutMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<E5EmbedMessage>) => void) | null;
};

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function loadExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= pipeline('feature-extraction', E5_MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    revision: E5_MODEL_REVISION,
  }).catch((cause: unknown) => {
    extractor = null;
    throw cause;
  });
  return extractor;
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type !== 'embed') return;
  void (async () => {
    try {
      const output = await (await loadExtractor())(message.text, {
        pooling: 'mean',
        normalize: true,
      });
      const values = Float32Array.from(output.data as Float32Array);
      scope.postMessage({ type: 'embedding', requestId: message.requestId, values }, [
        values.buffer,
      ]);
    } catch (cause) {
      scope.postMessage({
        type: 'embed-error',
        requestId: message.requestId,
        message: cause instanceof Error ? cause.message : 'semantic-model-error',
      });
    }
  })();
};
