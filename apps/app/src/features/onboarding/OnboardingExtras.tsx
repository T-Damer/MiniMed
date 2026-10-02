import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { asrDownloadId } from '@/features/asr/asr-download-protocol';
import {
  ASR_MODELS,
  AsrCancelledError,
  activateAsrModel,
  isAsrModelCached,
  isModelReady,
  pauseAsrDownloads,
  subscribeAsr,
} from '@/features/asr/asr-models';
import { isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { useDrugDownload } from '@/features/medications/use-drug-download';
import { downloadPercent } from '@/features/setup/setup-state';
import { motionMs } from '@/state/motion';
import {
  formatDownloadSize,
  LARGE_DOWNLOAD_BYTES,
  mriAttribution,
  parseMriManifest,
} from './onboarding-downloads';
import type { OnboardingExtra } from './onboarding-steps';

// The drawn imaging demo of the old tour, kept as the fallback when the real slices are missing.
const ImagingFallback = lazy(() =>
  import('@/features/setup/FeatureTourDemos').then(({ ImagingDemo }) => ({ default: ImagingDemo })),
);

/** The extra content a tour step brings into its card. */
export function OnboardingExtraContent(props: {
  readonly kind: OnboardingExtra;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  switch (props.kind) {
    case 'drugs-download':
      return <DrugDownloadAction onContentChanged={props.onContentChanged} />;
    case 'speech-download':
      return <SpeechModelAction />;
    case 'mri-viewer':
      return <MriSliceViewer />;
  }
}

/**
 * Queues the «Препараты» packages in the background through the same module runtime the section
 * picker uses. The full catalog (~10 MB) loads here, after the intro, never at start-up.
 */
function DrugDownloadAction(props: {
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const { state, failed, problem, active, start } = useDrugDownload(props.onContentChanged);

  const label = (): string => {
    const current = state();
    if (failed()) return 'Список пакетов не загрузился';
    if (!current) return 'Считаем размер…';
    if (current.modules.length === 0) return 'Пока недоступно';
    if (current.plan.complete) return 'Препараты скачаны';
    if (active()) {
      const fraction = current.progress.byteProgress;
      return fraction === null
        ? 'Скачиваем препараты…'
        : `Скачиваем препараты · ${Math.floor(fraction * 100)} %`;
    }
    const size = current.plan.bytes === null ? '' : ` · ${formatDownloadSize(current.plan.bytes)}`;
    return `${problem() ? 'Повторить' : 'Скачать препараты'}${size}`;
  };
  const disabled = () => {
    const current = state();
    return !current || current.modules.length === 0 || current.plan.complete || active();
  };
  const done = () => state()?.plan.complete === true;

  return (
    <div class="onboarding-extra">
      <Button
        class="onboarding-extra__action"
        classList={{ 'onboarding-extra__action--done': done() }}
        variant="secondary"
        disabled={disabled()}
        icon={<AppGlyph name={done() ? 'check' : 'download'} />}
        onClick={() => void start()}
      >
        {label()}
      </Button>
      <Show when={!failed() && (state()?.plan.bytes ?? 0) >= LARGE_DOWNLOAD_BYTES && !active()}>
        <p class="onboarding-extra__hint">Файл большой — лучше по Wi‑Fi. Загрузка идёт в фоне.</p>
      </Show>
      <Show when={active()}>
        <p class="onboarding-extra__hint" role="status" aria-live="polite">
          Загрузка идёт в фоне: можно продолжать обучение.
        </p>
      </Show>
    </div>
  );
}

const SPEECH_MODEL = ASR_MODELS.find((model) => model.runtimeReady);

/** Downloads and enables the local speech model through the same ASR feature Settings uses. */
function SpeechModelAction(): JSX.Element {
  const [ready, setReady] = createSignal(SPEECH_MODEL ? isModelReady(SPEECH_MODEL.id) : false);
  const [percent, setPercent] = createSignal<number>();
  const [busy, setBusy] = createSignal(false);
  const [cached, setCached] = createSignal(false);
  const refreshCached = async (): Promise<void> => {
    if (SPEECH_MODEL) setCached(await isAsrModelCached(SPEECH_MODEL.id));
  };

  onMount(() => {
    const model = SPEECH_MODEL;
    if (!model) return;
    void refreshCached();
    const queue = getDownloadQueue();
    const update = (): void => {
      setReady(isModelReady(model.id));
      const task = queue.get(asrDownloadId(model.id));
      setBusy(task !== undefined && isDownloadActive(task));
      setPercent(task ? downloadPercent(task.downloadedBytes, task.totalBytes) : undefined);
    };
    update();
    onCleanup(queue.subscribe(update));
    onCleanup(
      subscribeAsr(() => {
        update();
        void refreshCached();
      }),
    );
  });

  const start = async (): Promise<void> => {
    const model = SPEECH_MODEL;
    if (!model || busy() || ready()) return;
    setBusy(true);
    pauseAsrDownloads();
    try {
      await activateAsrModel(model.id);
    } catch (cause) {
      if (!(cause instanceof AsrCancelledError)) {
        toast.error(cause instanceof Error ? cause.message : 'Не удалось скачать модель.');
      }
    } finally {
      setBusy(false);
      void refreshCached();
    }
  };

  const label = (): string => {
    if (!SPEECH_MODEL) return 'Модель недоступна';
    if (ready()) return 'Модель готова';
    if (busy()) {
      const value = percent();
      return value === undefined
        ? 'Скачиваем модель…'
        : `Скачиваем модель · ${Math.floor(value)} %`;
    }
    return cached() ? 'Включить модель' : 'Скачать модель (в фоне)';
  };

  return (
    <div class="onboarding-extra">
      <Button
        class="onboarding-extra__action"
        classList={{ 'onboarding-extra__action--done': ready() }}
        variant="secondary"
        disabled={!SPEECH_MODEL || busy() || ready()}
        icon={<AppGlyph name={ready() ? 'check' : 'microphone'} />}
        onClick={() => void start()}
      >
        {label()}
      </Button>
      <Show when={busy()}>
        <p class="onboarding-extra__hint" role="status" aria-live="polite">
          Загрузка идёт в фоне: можно продолжать обучение.
        </p>
      </Show>
    </div>
  );
}

const MRI_FOLDER = 'onboarding/mri/';
const SLICE_INTERVAL_MS = 1_100;

function mriUrl(file: string): string {
  return new URL(`${MRI_FOLDER}${file}`, new URL(import.meta.env.BASE_URL, window.location.href))
    .href;
}

async function loadMriManifest(): Promise<ReturnType<typeof parseMriManifest>> {
  try {
    const response = await fetch(mriUrl('manifest.json'));
    if (!response.ok) return undefined;
    return parseMriManifest(await response.json());
  } catch (cause) {
    console.warn('Учебные срезы МРТ недоступны, показываем рисованный пример.', cause);
    return undefined;
  }
}

/** The real sample slices, cycling; the drawn demo of the old tour when they are not shipped. */
function MriSliceViewer(): JSX.Element {
  const [manifest] = createResource(loadMriManifest);
  return (
    <Suspense>
      <Show
        when={manifest()}
        fallback={
          <Show when={!manifest.loading}>
            <div class="onboarding-extra onboarding-extra--demo">
              <ImagingFallback active />
            </div>
          </Show>
        }
      >
        {(loaded) => <MriSlices manifest={loaded()} />}
      </Show>
    </Suspense>
  );
}

function MriSlices(props: {
  readonly manifest: NonNullable<ReturnType<typeof parseMriManifest>>;
}): JSX.Element {
  const [index, setIndex] = createSignal(0);
  const slices = () => props.manifest.slices;
  createEffect(() => {
    if (motionMs(1) === 0 || slices().length < 2) return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % slices().length),
      Math.max(SLICE_INTERVAL_MS, motionMs(SLICE_INTERVAL_MS)),
    );
    onCleanup(() => clearInterval(timer));
  });
  return (
    <figure class="onboarding-mri">
      <div class="onboarding-mri__screen">
        <For each={slices()}>
          {(file, position) => (
            <img
              class="onboarding-mri__slice"
              classList={{ 'onboarding-mri__slice--active': position() === index() }}
              src={mriUrl(file)}
              alt={
                position() === index()
                  ? `Срез МРТ головы, ${position() + 1} из ${slices().length}`
                  : ''
              }
              aria-hidden={position() === index() ? undefined : 'true'}
              width="512"
              height="512"
              decoding="async"
            />
          )}
        </For>
        <span class="onboarding-mri__label" aria-hidden="true">
          Срез {index() + 1} / {slices().length}
        </span>
      </div>
      <figcaption class="onboarding-mri__caption">
        <span>Учебные срезы: МРТ головы, T1, аксиальная плоскость.</span>
        <a
          class="onboarding-mri__source"
          href={props.manifest.source.url}
          target="_blank"
          rel="noreferrer noopener"
          title={`${props.manifest.source.author}. Лицензия: ${props.manifest.source.license}`}
        >
          {mriAttribution(props.manifest)}
        </a>
      </figcaption>
    </figure>
  );
}
