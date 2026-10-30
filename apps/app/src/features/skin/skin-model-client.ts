import { z } from 'zod';

import {
  encodeSkinDetails,
  SKIN_CLASSES,
  SKIN_MODEL_URL,
  type SkinAnalysis,
  type SkinDetails,
  type SkinModel,
  type SkinModelStatus,
} from '@/features/skin/skin-model';

/**
 * The app's skin model: the manifest beside the weights (written by tools/derm-cnn on export and
 * staged into `public/models/skin/`, gitignored), and a worker that runs the ONNX graph. A build
 * without the local weights has no manifest and reports «missing».
 */
const SkinModelManifestSchema = z.object({
  format: z.literal('minimed-skin-cnn'),
  version: z.literal(2),
  /** One graph, or several whose probabilities are averaged (an ensemble). */
  models: z
    .array(
      z.object({
        file: z.string().regex(/^[\w.-]+\.onnx$/u),
        inputSide: z.number().int().min(96).max(512),
        details: z.boolean(),
      }),
    )
    .min(1)
    .max(4),
  classes: z.array(z.string()).min(2),
  /** Sum of the malignant classes' probabilities at which the check fires (set on validation). */
  malignantThreshold: z.number().min(0).max(1),
});
export type SkinModelManifest = z.infer<typeof SkinModelManifestSchema>;

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

/** The model's classes must be the app's, in the same order: a stale model is reported missing. */
export function manifestMatchesClasses(manifest: SkinModelManifest): boolean {
  return (
    manifest.classes.length === SKIN_CLASSES.length &&
    manifest.classes.every((id, index) => SKIN_CLASSES[index]?.id === id)
  );
}

const baseUrl = (): string =>
  new URL(`${import.meta.env.BASE_URL}${SKIN_MODEL_URL}`, window.location.href).href;

let manifest: Promise<SkinModelManifest | undefined> | undefined;

function readManifest(): Promise<SkinModelManifest | undefined> {
  manifest ??= fetch(`${baseUrl()}skin-model.json`, { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const parsed = SkinModelManifestSchema.safeParse(await response.json());
      if (!parsed.success) {
        console.warn('The skin model manifest is invalid.', parsed.error.issues.length);
        return undefined;
      }
      return manifestMatchesClasses(parsed.data) ? parsed.data : undefined;
    })
    .catch((cause: unknown) => {
      console.warn(
        'The skin model manifest could not be read.',
        cause instanceof Error ? cause.name : cause,
      );
      return undefined;
    });
  return manifest;
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
    for (const waiter of pending.values())
      waiter.reject(new Error('Модель кожи остановилась с ошибкой.'));
    pending.clear();
  };
  worker = instance;
  return instance;
}

export const skinModel: SkinModel = {
  async status(): Promise<SkinModelStatus> {
    return (await readManifest()) ? 'ready' : 'missing';
  },
  async analyze(photo: Blob, details: SkinDetails): Promise<SkinAnalysis> {
    const current = await readManifest();
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
          models: current.models.map((entry) => ({
            url: `${baseUrl()}${entry.file}`,
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
    return skinAnalysisFrom(probabilities, current);
  },
};
