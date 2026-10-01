import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { FeatureCard } from '@/components/FeatureCard';
import { StepSlider } from '@/components/StepSlider';
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

  const available = ASR_MODELS.filter((model) => model.runtimeReady);
  const activeModel = () => available.find((model) => model.id === (busy() ?? selected()));
  const statusLabel = (): string => {
    const loading = busy();
    if (removing()) return 'Удаляем…';
    if (loading) {
      const fraction = progress()[loading];
      return typeof fraction === 'number'
        ? `Скачивается · ${Math.round(fraction * 100)}%`
        : 'Скачивается…';
    }
    const model = activeModel();
    if (!model) return 'Выключено';
    return ready().has(model.id)
      ? `Включено · ${model.choiceLabel}`
      : `Выбрано · ${model.choiceLabel}`;
  };
  const loadingProgress = (): number | null | undefined => {
    const loading = busy();
    if (!loading) return undefined;
    return progress()[loading] ?? null;
  };

  return (
    <FeatureCard
      class="asr-settings"
      headingId="settings-asr-heading"
      icon="microphone"
      title="Расшифровка голосовых заметок"
      summary="Голосовые заметки превращаются в текст прямо на устройстве, запись никуда не отправляется. Модель скачивается один раз."
      status={statusLabel()}
      tone={error() ? 'error' : busy() || removing() ? 'working' : activeModel() ? 'ready' : 'idle'}
      {...(loadingProgress() !== undefined ? { progress: loadingProgress() } : {})}
      {...(error() ? { error: error() } : {})}
      detailsTitle="Модели и место на устройстве"
      details={
        <>
          <p class="asr-settings__note">
            Используются открытые модели Whisper. Если браузер очистит хранилище сайта, модель
            придётся скачать заново; готовые расшифровки при этом сохранятся.
          </p>
          <For each={available}>
            {(model) => (
              <div class="asr-settings__model">
                <span class="asr-settings__model-copy">
                  <span class="asr-settings__model-name">
                    {model.choiceLabel} — {model.name}
                  </span>
                  <span class="asr-settings__model-state">
                    {cached().has(model.id) ? 'Скачана на устройство' : 'Не скачана'}
                  </span>
                </span>
                <Show when={cached().has(model.id) && busy() !== model.id}>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={removing() === model.id}
                    aria-label={`Удалить модель «${model.choiceLabel}» с устройства`}
                    onClick={() => setRemoveTarget(model)}
                  >
                    {removing() === model.id ? 'Удаляем…' : 'Удалить'}
                  </Button>
                </Show>
              </div>
            )}
          </For>
        </>
      }
    >
      <StepSlider
        class="asr-settings__choice"
        label="Режим расшифровки"
        ariaLabel="Режим расшифровки голосовых заметок"
        value={busy() ?? selected() ?? 'off'}
        disabled={removing() !== null}
        options={[
          { value: 'off', label: 'Выключено', hint: 'Голосовые заметки сохраняются без текста.' },
          ...available.map((model) => ({
            value: model.id,
            label: model.choiceLabel,
            hint: model.choiceHint,
          })),
        ]}
        onChange={(value) => {
          if (value === 'off') {
            const current = selected();
            const model = available.find((item) => item.id === current);
            if (model) void toggleModel(model, false);
            return;
          }
          const model = available.find((item) => item.id === value);
          if (model) void toggleModel(model, true);
        }}
      />
      <ConfirmationDialog
        open={removeTarget() !== null}
        title="Удалить модель с устройства?"
        description={
          <>
            Модель перестанет занимать место. Готовые расшифровки останутся в заметках. Чтобы снова
            расшифровывать, модель нужно будет скачать заново.
          </>
        }
        confirmLabel="Удалить модель"
        danger
        onConfirm={() => void removeCachedModel()}
        onOpenChange={(open) => {
          if (!open && !removing()) setRemoveTarget(null);
        }}
      />
    </FeatureCard>
  );
}
