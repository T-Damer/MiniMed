import {
  encodeSkinDetails,
  SKIN_CLASSES,
  SKIN_MODEL_URL,
  type SkinAnalysis,
  type SkinDetails,
  type SkinModel,
  type SkinModelStatus,
} from '@/features/skin/skin-model';
import {
  manifestMatchesClasses,
  parseSkinModelManifest,
  type SkinModelManifest,
} from '@/features/skin/skin-model-manifest';
import {
  readInstalledSkinManifest,
  readSkinPackDescriptor,
  skinPackStorageUrl,
  subscribeSkinPack,
} from '@/features/skin/skin-pack';

export { manifestMatchesClasses, type SkinModelManifest };

/**
 * The app's skin model: the manifest and graphs of the installed skin pack (skin-pack.ts), or — as a
 * developer fallback when no pack is installed — the files tools/derm-cnn staged into
 * `public/models/skin/` (gitignored); and a worker that runs the ONNX graph. A build with neither
 * reports «missing».
 */

/** The best class has to lead the second by this much, and reach this share, to be called. */
const UNCERTAIN_MARGIN = 0.1;
const UNCERTAIN_FLOOR = 0.3;

/** Probabilities in the manifest's class order → the page's analysis (pure; unit-tested). */
export function skinAnalysisFrom(
  probabilities: ArrayLike<number>,
  manifest: SkinModelManifest,
): SkinAnalysis {
  const malignant = new Set(
    SKIN_CLASSES.filter((entry) => entry.malignant).map((entry) => entry.id),
  );
  const predictions = manifest.classes
    .map((classId, index) => ({ classId, probability: probabilities[index] ?? 0 }))
    .toSorted((left, right) => right.probability - left.probability);
  const malignantScore = predictions
    .filter((entry) => malignant.has(entry.classId))
    .reduce((sum, entry) => sum + entry.probability, 0);
  const first = predictions[0]?.probability ?? 0;
  const second = predictions[1]?.probability ?? 0;
  return {
    predictions,
    malignantScore,
    malignantFlag: malignantScore >= manifest.malignantThreshold,
    uncertain: first < UNCERTAIN_FLOOR || first - second < UNCERTAIN_MARGIN,
  };
}

const baseUrl = (): string =>
  new URL(`${import.meta.env.BASE_URL}${SKIN_MODEL_URL}`, window.location.href).href;

/** Where the graphs of the model in use are read from. */
interface ModelSource {
  readonly manifest: SkinModelManifest;
  readonly urlFor: (file: string) => string;
  /** The pack's cache; absent for the developer files, which are fetched. */
  readonly cacheName?: string;
}

let source: Promise<ModelSource | undefined> | undefined;

async function readDevSource(): Promise<ModelSource | undefined> {
  try {
    const response = await fetch(`${baseUrl()}skin-model.json`, { cache: 'no-cache' });
    if (!response.ok) return undefined;
    const manifest = parseSkinModelManifest(await response.text());
    if (!manifest) {
      console.warn('The skin model manifest is invalid.');
      return undefined;
    }
    return { manifest, urlFor: (file) => `${baseUrl()}${file}` };
  } catch (cause) {
    console.warn(
      'The skin model manifest could not be read.',
      cause instanceof Error ? cause.name : cause,
    );
    return undefined;
  }
}

async function readSource(): Promise<ModelSource | undefined> {
  const descriptor = readSkinPackDescriptor();
  const manifest = descriptor ? await readInstalledSkinManifest() : undefined;
  if (descriptor && manifest) {
    return { manifest, urlFor: skinPackStorageUrl, cacheName: descriptor.cacheName };
  }
  return readDevSource();
}

function currentSource(): Promise<ModelSource | undefined> {
  source ??= readSource();
  return source;
}

// A pack installed or removed changes the graphs: forget the manifest and the loaded sessions.
// Registered when this module loads, so it runs before any page listener of the same event.
if (typeof window !== 'undefined') {
  subscribeSkinPack(() => {
    source = undefined;
    resetWorker();
  });
}

type WorkerReply =
  | { readonly type: 'result'; readonly requestId: string; readonly probabilities: Float32Array }
  | { readonly type: 'error'; readonly requestId: string; readonly message: string };

let worker: Worker | undefined;
let requests = 0;
const pending = new Map<
  string,
  { resolve: (value: Float32Array) => void; reject: (cause: Error) => void }
>();

function failPending(error: Error): void {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
}

function resetWorker(): void {
  worker?.terminate();
  worker = undefined;
  failPending(new Error('Модель кожи была заменена.'));
}

function workerInstance(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL('./skin-model.worker.ts', import.meta.url), {
    type: 'module',
  });
  instance.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const waiter = pending.get(reply.requestId);
    if (!waiter) return;
    pending.delete(reply.requestId);
    if (reply.type === 'result') waiter.resolve(reply.probabilities);
    else waiter.reject(new Error(reply.message));
  };
  instance.onerror = () => {
    worker = undefined;
    failPending(new Error('Модель кожи остановилась с ошибкой.'));
  };
  worker = instance;
  return instance;
}

export const skinModel: SkinModel = {
  async status(): Promise<SkinModelStatus> {
    return (await currentSource()) ? 'ready' : 'missing';
  },
  async analyze(photo: Blob, details: SkinDetails): Promise<SkinAnalysis> {
    const current = await currentSource();
    if (!current) throw new Error('Модель кожи не найдена.');
    requests += 1;
    const requestId = `skin-${requests}`;
    const image = await photo.arrayBuffer();
    const probabilities = await new Promise<Float32Array>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      workerInstance().postMessage(
        {
          type: 'analyze',
          requestId,
          models: current.manifest.models.map((entry) => ({
            url: current.urlFor(entry.file),
            ...(current.cacheName ? { cacheName: current.cacheName } : {}),
            inputSide: entry.inputSide,
            details: entry.details,
          })),
          image,
          mimeType: photo.type || 'image/jpeg',
          details: encodeSkinDetails(details),
          blankDetails: encodeSkinDetails({}),
        },
        [image],
      );
    });
    return skinAnalysisFrom(probabilities, current.manifest);
  },
};
