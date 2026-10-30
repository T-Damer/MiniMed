/// <reference lib="webworker" />

// The same entry the ECG tool and @huggingface/transformers use: one ONNX Runtime wasm in the app.
import * as ort from 'onnxruntime-web/webgpu';

interface ModelRef {
  readonly url: string;
  /** Set for a graph of the installed skin pack: it is read from this Cache Storage cache. */
  readonly cacheName?: string;
  readonly inputSide: number;
  /** Whether this graph was trained to use the details (others get every field unknown). */
  readonly details: boolean;
}

/** What the page's client sends: the photo's bytes, the details vector and the graphs to run. */
interface AnalyzeMessage {
  readonly type: 'analyze';
  readonly requestId: string;
  readonly models: readonly ModelRef[];
  readonly image: ArrayBuffer;
  readonly mimeType: string;
  readonly details: Float32Array;
  /** Every field unknown: what a graph trained without details expects. */
  readonly blankDetails: Float32Array;
}

type OutMessage =
  | { readonly type: 'result'; readonly requestId: string; readonly probabilities: Float32Array }
  | { readonly type: 'error'; readonly requestId: string; readonly message: string };

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** One session per graph, kept for the worker's life; a failed load is forgotten so it can retry. */
const sessions = new Map<string, Promise<ort.InferenceSession>>();

async function modelBytes(ref: ModelRef): Promise<ArrayBuffer> {
  if (ref.cacheName) {
    const cache = await caches.open(ref.cacheName);
    const hit = await cache.match(ref.url);
    if (!hit) throw new Error('Модель кожи: файл пакета не найден.');
    return hit.arrayBuffer();
  }
  const response = await fetch(ref.url);
  if (!response.ok) throw new Error(`Модель кожи: ${response.status}`);
  return response.arrayBuffer();
}

function load(ref: ModelRef): Promise<ort.InferenceSession> {
  const key = `${ref.cacheName ?? ''}|${ref.url}`;
  const known = sessions.get(key);
  if (known) return known;
  ort.env.wasm.numThreads = 1;
  const session = modelBytes(ref).then((bytes) =>
    ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }),
  );
  sessions.set(key, session);
  session.catch(() => {
    sessions.delete(key);
  });
  return session;
}

/**
 * The evaluation transform of tools/derm-cnn (Resize(side + 16) then CenterCrop(side)), ImageNet
 * normalisation, NCHW float32.
 */
async function pixels(image: ArrayBuffer, mimeType: string, side: number): Promise<Float32Array> {
  const bitmap = await createImageBitmap(new Blob([image], { type: mimeType }));
  const resized = side + 16;
  const scale = resized / Math.min(bitmap.width, bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(side, side);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Модель кожи: нет 2D-контекста.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height);
  bitmap.close();
  const rgba = context.getImageData(0, 0, side, side).data;
  const plane = side * side;
  const tensor = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (rgba[index * 4 + channel] ?? 0) / 255;
      tensor[channel * plane + index] = (value - (MEAN[channel] ?? 0)) / (STD[channel] ?? 1);
    }
  }
  return tensor;
}

function softmax(logits: Float32Array): Float32Array {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of logits) max = Math.max(max, value);
  const result = new Float32Array(logits.length);
  let total = 0;
  logits.forEach((value, index) => {
    result[index] = Math.exp(value - max);
    total += result[index] ?? 0;
  });
  return result.map((value) => value / total);
}

self.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  const message = event.data;
  try {
    // Graphs of the same input side share one decoded image.
    const images = new Map<number, Promise<Float32Array>>();
    const runs = message.models.map(async (ref) => {
      const model = await load(ref);
      const side = ref.inputSide;
      let image = images.get(side);
      if (!image) {
        image = pixels(message.image, message.mimeType, side);
        images.set(side, image);
      }
      const details = ref.details ? message.details : message.blankDetails;
      const available: Record<string, ort.Tensor> = {
        image: new ort.Tensor('float32', await image, [1, 3, side, side]),
        details: new ort.Tensor('float32', details, [1, details.length]),
      };
      // A photo-only model has no details input: feed only what the graph asks for.
      const feeds = Object.fromEntries(
        model.inputNames.map((name) => {
          const tensor = available[name];
          if (!tensor) throw new Error(`Модель кожи: неизвестный вход ${name}.`);
          return [name, tensor];
        }),
      );
      const output = (await model.run(feeds))[model.outputNames[0] ?? 'logits'];
      if (!output) throw new Error('Модель кожи не вернула результат.');
      return softmax(output.data as Float32Array);
    });
    // Sequential in practice (one wasm thread); the ensemble's answer is the mean probability.
    const all = await Promise.all(runs);
    const probabilities = new Float32Array(all[0]?.length ?? 0);
    for (const entry of all)
      entry.forEach((value, index) => {
        probabilities[index] = (probabilities[index] ?? 0) + value / all.length;
      });
    (self as unknown as Worker).postMessage(
      { type: 'result', requestId: message.requestId, probabilities } satisfies OutMessage,
      [probabilities.buffer],
    );
  } catch (cause) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      requestId: message.requestId,
      message: cause instanceof Error ? cause.message : String(cause),
    } satisfies OutMessage);
  }
};
