import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { asrDownloadId } from '@/features/asr/asr-download-protocol';
import {
  ASR_MODELS,
  AsrCancelledError,
  type AsrModelDescriptor,
  activateAsrModel,
  deactivateAsrModel,
  isAsrModelCached,
  isModelReady,
  onAsrProgress,
  pauseAsrDownloads,
  removeAsrModel,
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
  const [cached, setCached] = createSignal<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<Record<string, number | null>>({});
  const [busy, setBusy] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal<string | null>(null);
  const [removeTarget, setRemoveTarget] = createSignal<AsrModelDescriptor | null>(null);
  const [error, setError] = createSignal('');

  const sync = (): void => {
    setReady(
      new Set(ASR_MODELS.filter((model) => isModelReady(model.id)).map((model) => model.id)),
    );
    setSelected(selectedAsrModelId());
  };

  const refreshCached = async (): Promise<void> => {
    const states = await Promise.all(
      ASR_MODELS.filter((model) => model.runtimeReady).map(async (model) => ({
        id: model.id,
        cached: await isAsrModelCached(model.id),
      })),
    );
    setCached(new Set(states.filter((state) => state.cached).map((state) => state.id)));
  };

  onMount(() => {
    sync();
    void refreshCached();
    const unsubscribe = subscribeAsr(() => {
      sync();
      void refreshCached();
    });
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
      deactivateAsrModel();
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
      await refreshCached();
    }
  };

  const removeCachedModel = async (): Promise<void> => {
    const model = removeTarget();
    if (!model) return;
    setError('');
    setRemoving(model.id);
    try {
      await removeAsrModel(model.id);
      await refreshCached();
      sync();
      setRemoveTarget(null);
    } catch (cause) {
      setRemoveTarget(null);
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить модель.');
    } finally {
      setRemoving(null);
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
              Модель работает на устройстве. После успешной первой загрузки MiniMed сохраняет
              проверенный набор файлов локально и при следующем запуске поднимает его без сети. Если
              браузер очистит хранилище, модель нужно будет загрузить заново. Выбор другой модели
              приостановит текущую загрузку.
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
              cached={cached().has(model.id)}
              selected={selected() === model.id || busy() === model.id}
              progress={progress()[model.id]}
              busy={busy() === model.id}
              removing={removing() === model.id}
              onToggle={(checked) => void toggleModel(model, checked)}
              onRemove={() => setRemoveTarget(model)}
            />
          )}
        </For>
      </div>
      <Show when={error()}>
        <p class="asr-settings__error" role="alert">
          {error()}
        </p>
      </Show>

      <ConfirmationDialog
        open={removeTarget() !== null}
        title="Удалить речевую модель?"
        description={
          <>
            Модель будет удалена из локального хранилища браузера и перестанет занимать место.
            Готовые расшифровки останутся в заметках. При следующем включении модель потребуется
            скачать заново.
          </>
        }
        confirmLabel="Удалить модель"
        danger
        onConfirm={() => void removeCachedModel()}
        onOpenChange={(open) => {
          if (!open && !removing()) setRemoveTarget(null);
        }}
      />
    </section>
  );
}

function AsrModelRow(props: {
  readonly model: AsrModelDescriptor;
  readonly ready: boolean;
  readonly cached: boolean;
  readonly selected: boolean;
  readonly progress: number | null | undefined;
  readonly busy: boolean;
  readonly removing: boolean;
  readonly onToggle: (checked: boolean) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const percent = (): string =>
    typeof props.progress === 'number' ? `${Math.round(props.progress * 100)}%` : '';
  return (
    <div class="asr-model-row" classList={{ 'asr-model-row--active': props.selected }}>
      <label class="asr-model-row__toggle">
        <input
          type="checkbox"
          class="asr-model-row__check"
          checked={props.selected}
          disabled={props.removing}
          onChange={(event) => props.onToggle(event.currentTarget.checked)}
        />
        <span class="asr-model-row__info">
          <strong>{props.model.name}</strong>
          <small class="asr-model-row__description">{props.model.description}</small>
          <small class="asr-model-row__meta">
            {props.model.preferredForRussian ? 'рекомендуется для русского' : 'резервная'}
            {props.cached ? ' · скачана' : ''}
          </small>
        </span>
      </label>
      <Show
        when={props.busy}
        fallback={
          <Show when={props.selected || props.ready || props.cached}>
            <span
              class="asr-model-row__state"
              classList={{ 'asr-model-row__state--on': props.selected }}
            >
              {props.selected ? 'Активна' : props.ready ? 'Загружена' : 'Скачана'}
            </span>
          </Show>
        }
      >
        <span class="asr-model-row__progress">{percent() || 'Загрузка…'}</span>
      </Show>
      <Show when={props.cached && !props.busy}>
        <Button
          type="button"
          class="asr-model-row__remove"
          variant="quiet"
          disabled={props.removing}
          aria-label={`Удалить модель ${props.model.name} из браузера`}
          onClick={props.onRemove}
        >
          {props.removing ? 'Удаление…' : 'Удалить'}
        </Button>
      </Show>
    </div>
  );
}
