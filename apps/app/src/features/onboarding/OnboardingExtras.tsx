import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

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
import { SectionDownloads } from '@/features/sections/SectionDownloads';
import { downloadPercent } from '@/features/setup/setup-state';
import { MriSliceViewer } from './MriSliceViewer';
import type { OnboardingExtra } from './onboarding-steps';

/** The extra content a tour step brings into its card. */
export function OnboardingExtraContent(props: {
  readonly kind: OnboardingExtra;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  switch (props.kind) {
    case 'sections-download':
      return <SectionDownloads variant="onboarding" onContentChanged={props.onContentChanged} />;
    case 'speech-download':
      return <SpeechModelAction />;
    case 'mri-viewer':
      return <MriSliceViewer variant="badge" />;
  }
}

const SPEECH_MODEL = ASR_MODELS.find((model) => model.runtimeReady);

/** Downloads and enables the local speech model through the same ASR feature Settings uses. */
function SpeechModelAction(): JSX.Element {
  const [ready, setReady] = createSignal(SPEECH_MODEL ? isModelReady(SPEECH_MODEL.id) : false);
  const [percent, setPercent] = createSignal<number>();
  const [busy, setBusy] = createSignal(false);
  const [cached, setCached] = createSignal(false);
  // The failure is told in the card itself: a toast would land on top of the tour.
  const [failure, setFailure] = createSignal<string>();
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
    setFailure(undefined);
    pauseAsrDownloads();
    try {
      await activateAsrModel(model.id);
    } catch (cause) {
      if (!(cause instanceof AsrCancelledError)) {
        setFailure(cause instanceof Error ? cause.message : 'Не удалось скачать модель.');
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
    if (failure()) return 'Повторить';
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
      <Show when={failure()}>
        {(message) => (
          <p class="onboarding-extra__hint onboarding-extra__hint--error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
