import { type AutomaticSpeechRecognitionPipeline, env, pipeline } from '@huggingface/transformers';

export interface AsrLoadMessage {
  readonly type: 'load';
  readonly modelId: string;
}

export interface AsrTranscribeMessage {
  readonly type: 'transcribe';
  readonly requestId: string;
  readonly audio: Float32Array;
  readonly modelId: string;
}

export type AsrWorkerInMessage = AsrLoadMessage | AsrTranscribeMessage;

export interface AsrLoadingMessage {
  readonly type: 'loading';
  readonly modelId: string;
  readonly progress: number | null;
}

export interface AsrReadyMessage {
  readonly type: 'ready';
  readonly modelId: string;
}

export interface AsrLoadErrorMessage {
  readonly type: 'load-error';
  readonly modelId: string;
  readonly message: string;
}

export interface AsrResultMessage {
  readonly type: 'result';
  readonly requestId: string;
  readonly text: string;
}

export interface AsrTranscribeErrorMessage {
  readonly type: 'transcribe-error';
  readonly requestId: string;
  readonly message: string;
}

export type AsrWorkerOutMessage =
  | AsrLoadingMessage
  | AsrReadyMessage
  | AsrLoadErrorMessage
  | AsrResultMessage
  | AsrTranscribeErrorMessage;

interface ModelSpec {
  readonly options: {
    readonly dtype: 'fp32' | 'q8';
    readonly device?: 'wasm';
  };
  readonly callOptions?: {
    readonly chunk_length_s: number;
    readonly language: string;
    readonly task: 'transcribe';
  };
}

const MODEL_SPECS: Readonly<Record<string, ModelSpec>> = {
  // ponytail: fp32 because onnxruntime-web ≥1.25 crashes int8 whisper decoders
  // (TransposeDQWeightsForMatMulNBits, microsoft/onnxruntime#28306); switch to
  // q8 when transformers.js ships the fixed ORT.
  'onnx-community/whisper-tiny': {
    options: { dtype: 'fp32' },
    callOptions: { chunk_length_s: 30, language: 'russian', task: 'transcribe' },
  },
};

env.allowLocalModels = false;

const scope = self as unknown as {
  postMessage(message: AsrWorkerOutMessage): void;
  onmessage: ((event: MessageEvent<AsrWorkerInMessage>) => void) | null;
};

type SpeechPipeline = AutomaticSpeechRecognitionPipeline;

let current: { readonly id: string; readonly pipe: SpeechPipeline } | null = null;
let tail: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadPipeline(modelId: string): Promise<SpeechPipeline> {
  if (current?.id === modelId) return current.pipe;
  const spec = MODEL_SPECS[modelId];
  if (!spec) throw new Error(`Неизвестная модель: ${modelId}`);
  const created = await pipeline('automatic-speech-recognition', modelId, {
    ...spec.options,
    progress_callback: (info: { readonly status?: string; readonly progress?: number }) => {
      if (info.status !== 'progress') return;
      scope.postMessage({
        type: 'loading',
        modelId,
        progress: typeof info.progress === 'number' ? info.progress / 100 : null,
      });
    },
  });
  current = { id: modelId, pipe: created };
  return created;
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'load') {
    void enqueue(async () => {
      scope.postMessage({ type: 'loading', modelId: message.modelId, progress: 0 });
      try {
        await loadPipeline(message.modelId);
        scope.postMessage({ type: 'ready', modelId: message.modelId });
      } catch (cause) {
        scope.postMessage({
          type: 'load-error',
          modelId: message.modelId,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    });
    return;
  }
  void enqueue(async () => {
    try {
      const pipe = current?.pipe;
      const spec = current?.id === message.modelId ? MODEL_SPECS[message.modelId] : undefined;
      if (!pipe || !spec) throw new Error(`Модель не загружена: ${message.modelId}`);
      const output: unknown = await pipe(message.audio, spec.callOptions ?? {});
      const first = Array.isArray(output) ? (output[0] as { text?: unknown } | undefined) : output;
      const text =
        typeof first === 'object' && first !== null && 'text' in first
          ? String((first as { text: unknown }).text ?? '')
          : '';
      scope.postMessage({ type: 'result', requestId: message.requestId, text });
    } catch (cause) {
      scope.postMessage({
        type: 'transcribe-error',
        requestId: message.requestId,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
};
