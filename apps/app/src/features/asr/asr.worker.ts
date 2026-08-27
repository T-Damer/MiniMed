import {
  type AutomaticSpeechRecognitionPipeline,
  env,
  type ProgressInfo,
  pipeline,
} from '@huggingface/transformers';

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
  // onnxruntime-web 1.27 contains microsoft/onnxruntime#28326, which fixes the
  // tied-weight crash that previously made quantized Whisper decoders unusable.
  'onnx-community/whisper-base': {
    options: { dtype: 'q8' },
    callOptions: { chunk_length_s: 30, language: 'russian', task: 'transcribe' },
  },
  'onnx-community/whisper-small': {
    options: { dtype: 'q8' },
    callOptions: { chunk_length_s: 30, language: 'russian', task: 'transcribe' },
  },
};

const NETWORK_RETRY_DELAYS_MS = [750, 2000] as const;

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

function isNetworkError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    /failed to fetch|network\s*error|networkerror|load failed/iu.test(cause.message)
  );
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function loadPipeline(modelId: string): Promise<SpeechPipeline> {
  if (current?.id === modelId) return current.pipe;
  const spec = MODEL_SPECS[modelId];
  if (!spec) throw new Error(`Неизвестная модель: ${modelId}`);
  let reportedProgress = 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const created = await pipeline('automatic-speech-recognition', modelId, {
        ...spec.options,
        progress_callback: (info: ProgressInfo) => {
          if (info.status !== 'progress_total') return;
          reportedProgress = Math.max(
            reportedProgress,
            Math.min(1, Math.max(0, info.progress / 100)),
          );
          scope.postMessage({ type: 'loading', modelId, progress: reportedProgress });
        },
      });
      current = { id: modelId, pipe: created };
      return created;
    } catch (cause) {
      const retryDelay = NETWORK_RETRY_DELAYS_MS[attempt];
      if (!isNetworkError(cause) || retryDelay === undefined) {
        if (isNetworkError(cause)) {
          throw new Error('Ошибка сети. Проверьте подключение и повторите загрузку.');
        }
        throw cause;
      }
      await wait(retryDelay);
    }
  }
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
