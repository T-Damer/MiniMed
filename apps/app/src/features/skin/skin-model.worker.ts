/// <reference lib="webworker" />

// The same entry the ECG tool and @huggingface/transformers use: one ONNX Runtime wasm in the app.
import * as ort from 'onnxruntime-web/webgpu';

/** What the page's client sends: the photo's bytes, the details vector and where the model lives. */
interface AnalyzeMessage {
  readonly type: 'analyze';
  readonly requestId: string;
  readonly modelUrl: string;
  readonly inputSide: number;
  readonly image: ArrayBuffer;
  readonly mimeType: string;
  readonly details: Float32Array;
}

type OutMessage =
  | { readonly type: 'result'; readonly requestId: string; readonly probabilities: Float32Array }
  | { readonly type: 'error'; readonly requestId: string; readonly message: string };

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

let session: Promise<ort.InferenceSession> | undefined;
let sessionUrl = '';

function load(url: string): Promise<ort.InferenceSession> {
  if (session && sessionUrl === url) return session;
  sessionUrl = url;
  ort.env.wasm.numThreads = 1;
  session = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Модель кожи: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) =>
      ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      }),
    );
  session.catch(() => {
    session = undefined;
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
    const model = await load(message.modelUrl);
    const side = message.inputSide;
    const available: Record<string, ort.Tensor> = {
      image: new ort.Tensor('float32', await pixels(message.image, message.mimeType, side), [
        1,
        3,
        side,
        side,
      ]),
      details: new ort.Tensor('float32', message.details, [1, message.details.length]),
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
    const probabilities = softmax(output.data as Float32Array);
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
