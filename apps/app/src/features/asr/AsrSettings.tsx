import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { asrDownloadId } from '@/features/asr/asr-download-protocol';
import {
  ASR_MODELS,
  AsrCancelledError,
  type AsrModelDescriptor,
  activateAsrModel,
  isModelReady,
  onAsrProgress,
  pauseAsrDownloads,
  selectAsrModel,
  selectedAsrModelId,
  subscribeAsr,
} from '@/features/asr/asr-models';
import { isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';

/**
 * Settings card for on-device speech recognition: checking a model downloads
 * and activates it; checking another pauses the previous download.
 */
export function AsrSettings(): JSX.Element {
  const [ready, setReady] = createSignal<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<Record<string, number | null>>({});
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal('');

  const sync = (): void => {
    setReady(
      new Set(ASR_MODELS.filter((model) => isModelReady(model.id)).map((model) => model.id)),
    );
    setSelected(selectedAsrModelId());
  };

  onMount(() => {
    sync();
    const unsubscribe = subscribeAsr(sync);
    const queue = getDownloadQueue();
    const updateQueue = (): void => {
      const active = ASR_MODELS.find((model) => {
        const task = queue.get(asrDownloadId(model.id));
        return task && isDownloadActive(task);
      });
      setBusy(active?.id ?? null);
      sync();
    };
    updateQueue();
    onCleanup(queue.subscribe(updateQueue));
    const offs = ASR_MODELS.map((model) =>
      onAsrProgress(model.id, (fraction) => {
        setProgress((current) => ({ ...current, [model.id]: fraction }));
      }),
    );
    onCleanup(() => {
      unsubscribe();
      for (const off of offs) off();
    });
  });

  const toggleModel = async (model: AsrModelDescriptor, checked: boolean): Promise<void> => {
    setError('');
    if (!checked) {
      selectAsrModel(null);
      pauseAsrDownloads();
      return;
    }
    setBusy(model.id);
    pauseAsrDownloads();
    try {
      await activateAsrModel(model.id);
    } catch (cause) {
      if (!(cause instanceof AsrCancelledError)) {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить модель.');
      }
    } finally {
      // keep the flag if another model already took over after a pause
      setBusy((current) => (current === model.id ? null : current));
    }
  };

  return (
    <section
      class="settings-section settings-section--asr paper-sheet"
      aria-labelledby="settings-asr-heading"
    >
      <header class="settings-section__heading">
        <div class="settings-section__heading-main">
          <AppGlyph name="text-aa-fill" class="settings-section__icon" />
          <div class="settings-section__heading-copy">
            <h2 id="settings-asr-heading" class="settings-section__title">
              Расшифровка голосовых заметок
            </h2>
            <p class="settings-section__description">
              Модель работает на устройстве. Первая загрузка требует сети, далее расшифровка идёт
              офлайн. Отметьте модель, чтобы начать загрузку; выбор другой модели приостановит
              текущую.
            </p>
          </div>
        </div>
      </header>
      <div class="asr-model-list">
        <For each={ASR_MODELS.filter((model) => model.runtimeReady)}>
          {(model) => (
            <AsrModelRow
              model={model}
              ready={ready().has(model.id)}
              selected={selected() === model.id || busy() === model.id}
              progress={progress()[model.id]}
              busy={busy() === model.id}
              onToggle={(checked) => void toggleModel(model, checked)}
            />
          )}
        </For>
      </div>
      <Show when={error()}>
        <p class="asr-settings__error" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}

function AsrModelRow(props: {
  readonly model: AsrModelDescriptor;
  readonly ready: boolean;
  readonly selected: boolean;
  readonly progress: number | null | undefined;
  readonly busy: boolean;
  readonly onToggle: (checked: boolean) => void;
}): JSX.Element {
  const percent = (): string =>
    typeof props.progress === 'number' ? `${Math.round(props.progress * 100)}%` : '';
  return (
    <label class="asr-model-row" classList={{ 'asr-model-row--active': props.selected }}>
      <input
        type="checkbox"
        class="asr-model-row__check"
        checked={props.selected}
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />
      <span class="asr-model-row__info">
        <strong>{props.model.name}</strong>
        <small class="asr-model-row__description">{props.model.description}</small>
        <small class="asr-model-row__meta">
          {props.model.preferredForRussian ? 'рекомендуется для русского' : 'резервная'}
          {props.ready ? ' · готова' : ''}
        </small>
      </span>
      <Show
        when={props.busy}
        fallback={
          <Show when={props.ready}>
            <span
              class="asr-model-row__state"
              classList={{ 'asr-model-row__state--on': props.selected }}
            >
              {props.selected ? 'Активна' : 'Готова'}
            </span>
          </Show>
        }
      >
        <span class="asr-model-row__progress">{percent() || 'Загрузка…'}</span>
      </Show>
    </label>
  );
}
