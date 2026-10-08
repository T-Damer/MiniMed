import { createSignal } from 'solid-js';

import { asrDownloadId } from '@/features/asr/asr-download-protocol';
import type { AsrModelDescriptor } from '@/features/asr/asr-models';
import { type DownloadTask, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';

/**
 * Where the on-device speech model stands, for screens that offer to install it in place (the
 * recording window today). The speech runtime loads on demand, so the first screen stays light;
 * everything here is a thin view over `asr-models.ts` and the shared download queue.
 */
export type AsrInstallPhase =
  /** The runtime has not been asked yet. */
  | 'checking'
  /** A model is loaded: recognition can run right now. */
  | 'ready'
  /** Nothing on the device: a download is needed. */
  | 'missing'
  /** The files are already on the device: switching on needs no network. */
  | 'cached'
  | 'loading'
  | 'failed';

/** The model to offer: the chosen one, else one already on the device, else the fast default. */
export function chooseInstallModel(
  models: readonly AsrModelDescriptor[],
  selectedId: string | null,
  cachedIds: ReadonlySet<string>,
): AsrModelDescriptor | undefined {
  const usable = models.filter((model) => model.runtimeReady);
  return (
    usable.find((model) => model.id === selectedId) ??
    usable.find((model) => cachedIds.has(model.id)) ??
    usable.find((model) => model.preferredForRussian) ??
    usable[0]
  );
}

export function installPhase(input: {
  readonly ready: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly cached: boolean;
  readonly known: boolean;
}): AsrInstallPhase {
  if (input.ready) return 'ready';
  if (input.loading) return 'loading';
  if (!input.known) return 'checking';
  if (input.failed) return 'failed';
  return input.cached ? 'cached' : 'missing';
}

/** «81 МБ»: the size a doctor decides on before downloading. */
export function formatModelSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} МБ`;
}

const REFRESH_THROTTLE_MS = 250;

type AsrModels = typeof import('@/features/asr/asr-models');

const [phase, setPhase] = createSignal<AsrInstallPhase>('checking');
const [model, setModel] = createSignal<AsrModelDescriptor | undefined>();
const [progress, setProgress] = createSignal<number | null>(null);
const [error, setError] = createSignal('');
/** The queue is waiting out a network hiccup before it tries the download again. */
const [retrying, setRetrying] = createSignal(false);

let runtime: Promise<AsrModels> | undefined;
let known = false;
let failed = false;
let installing = false;
let cached = false;

function loadRuntime(): Promise<AsrModels> {
  runtime ??= import('@/features/asr/asr-models');
  return runtime;
}

/** The shared queue's active speech tasks, started here or in Settings. */
function queueTasks(models: readonly AsrModelDescriptor[]): readonly DownloadTask[] {
  const queue = getDownloadQueue();
  return models.flatMap((candidate) => {
    const task = queue.get(asrDownloadId(candidate.id));
    return task !== undefined && isDownloadActive(task) ? [task] : [];
  });
}

async function refresh(): Promise<void> {
  const asr = await loadRuntime();
  const cachedIds = new Set<string>();
  await Promise.all(
    asr.ASR_MODELS.filter((candidate) => candidate.runtimeReady).map(async (candidate) => {
      if (await asr.isAsrModelCached(candidate.id)) cachedIds.add(candidate.id);
    }),
  );
  const chosen = chooseInstallModel(asr.ASR_MODELS, asr.selectedAsrModelId(), cachedIds);
  cached = chosen !== undefined && cachedIds.has(chosen.id);
  known = true;
  const tasks = queueTasks(asr.ASR_MODELS);
  setModel(chosen);
  setRetrying(tasks.some((task) => task.state === 'retrying'));
  setPhase(
    installPhase({
      ready: asr.liveRecognitionReady(),
      loading: installing || tasks.length > 0,
      failed,
      cached,
      known,
    }),
  );
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** The download queue ticks on every progress byte; the cache lookups behind a refresh need not. */
function scheduleRefresh(): void {
  if (refreshTimer !== undefined) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refresh();
  }, REFRESH_THROTTLE_MS);
}

/**
 * Starts following the speech model while a screen shows its install card; call the returned
 * function when the screen goes away. Several screens may watch at once.
 */
export function watchAsrInstall(): () => void {
  let active = true;
  const offs: (() => void)[] = [];
  const queue = getDownloadQueue();
  offs.push(queue.subscribe(scheduleRefresh));
  void loadRuntime().then((asr) => {
    if (!active) return;
    offs.push(asr.subscribeAsr(scheduleRefresh));
    for (const candidate of asr.ASR_MODELS) {
      offs.push(asr.onAsrProgress(candidate.id, (fraction) => setProgress(fraction)));
    }
    void refresh();
  });
  return () => {
    active = false;
    for (const off of offs) off();
  };
}

/** Downloads (or switches on) the offered model; the screen keeps working meanwhile. */
export async function installAsrModel(): Promise<void> {
  if (installing) return;
  const asr = await loadRuntime();
  const target = model();
  if (!target) return;
  installing = true;
  failed = false;
  setError('');
  setProgress(null);
  setPhase('loading');
  try {
    await asr.activateAsrModel(target.id);
  } catch (cause) {
    if (!(cause instanceof asr.AsrCancelledError)) {
      failed = true;
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить модель.');
    }
  } finally {
    installing = false;
    await refresh();
  }
}

export const asrInstall = { phase, model, progress, error, retrying };
