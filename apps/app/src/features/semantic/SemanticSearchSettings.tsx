import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { Button } from '@/components/Button';
import { FeatureCard } from '@/components/FeatureCard';
import { downloadTaskFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { E5_DOWNLOAD_ID, E5_MODEL_TOTAL_BYTES } from './e5-model';
import { isE5ModelInstalled } from './e5-model-cache';
import { installE5Model, removeE5Model, subscribeE5Model } from './e5-model-store';
import { resetE5QueryEmbedder } from './e5-query-embedder';

const SIZE_LABEL = `${Math.round(E5_MODEL_TOTAL_BYTES / 1024 / 1024)} МБ`;

export function SemanticSearchSettings(): JSX.Element {
  const queue = getDownloadQueue();
  const [installed, setInstalled] = createSignal(false);
  const [task, setTask] = createSignal(queue.get(E5_DOWNLOAD_ID));
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  const downloading = () => {
    const current = task();
    return Boolean(current && isDownloadActive(current));
  };
  const sync = (): void => {
    void isE5ModelInstalled().then(
      (value) => {
        if (!disposed) setInstalled(value);
      },
      () => {
        if (!disposed) setError('Не удалось прочитать состояние модели.');
      },
    );
  };
  onMount(() => {
    sync();
    const subscriptions = [
      subscribeE5Model(() => {
        resetE5QueryEmbedder();
        sync();
      }),
      queue.subscribe(() => setTask(queue.get(E5_DOWNLOAD_ID))),
    ];
    onCleanup(() => {
      for (const unsubscribe of subscriptions) unsubscribe();
      disposed = true;
    });
  });

  const install = async (): Promise<void> => {
    if (downloading() || removing()) return;
    setError('');
    try {
      await installE5Model();
      toast.success('Поиск по смыслу готов.');
    } catch (cause) {
      if (!disposed && !(cause instanceof Error && cause.name === 'AbortError'))
        setError('Не удалось скачать или проверить модель поиска по смыслу.');
    }
  };
  const cancel = (): void => {
    void queue.cancel(E5_DOWNLOAD_ID).catch(() => {
      if (!disposed) setError('Не удалось подтвердить отмену загрузки.');
    });
  };
  const remove = async (): Promise<void> => {
    if (downloading() || removing()) return;
    setRemoving(true);
    setError('');
    try {
      await removeE5Model();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить модель.');
    } finally {
      if (!disposed) setRemoving(false);
    }
  };
  const progress = () => {
    const current = task();
    return current ? (downloadTaskFraction(current) ?? 0) : 0;
  };
  const statusLabel = (): string => {
    if (removing()) return 'Удаляем…';
    if (downloading()) {
      const current = task();
      if (current?.state === 'verifying') return 'Проверяем файлы…';
      if (current?.state === 'queued') return 'В очереди';
      return `Скачивается · ${Math.floor(progress() * 100)}%`;
    }
    return installed() ? 'Готово к работе' : `Не скачано · ${SIZE_LABEL}`;
  };

  return (
    <FeatureCard
      class="semantic-search-settings"
      headingId="settings-semantic-search-heading"
      icon="brain"
      title="Поиск по смыслу"
      summary="Находит клинические рекомендации по описанию своими словами — жалобам, симптомам, диагнозу без точного названия. Запрос обрабатывается на устройстве."
      status={statusLabel()}
      tone={
        error() ? 'error' : downloading() || removing() ? 'working' : installed() ? 'ready' : 'idle'
      }
      {...(downloading() ? { progress: progress() || null } : {})}
      {...(error() ? { error: error() } : {})}
      actions={
        <>
          <Show when={!installed() && !downloading()}>
            <Button
              type="button"
              variant="primary"
              disabled={removing()}
              onClick={() => void install()}
            >
              Скачать
            </Button>
          </Show>
          <Show when={downloading()}>
            <Button type="button" variant="quiet" disabled={!task()?.canCancel} onClick={cancel}>
              Отменить
            </Button>
          </Show>
          <Show when={installed() && !downloading()}>
            <Button
              type="button"
              variant="quiet"
              disabled={removing()}
              onClick={() => void remove()}
            >
              Удалить
            </Button>
          </Show>
        </>
      }
      detailsTitle="Как это работает"
      details={
        <p class="semantic-search-settings__notice">
          Модель multilingual-e5-small (MIT, Microsoft) переводит запрос в вектор и сравнивает его с
          заранее посчитанными векторами фрагментов скачанных клинических рекомендаций. Результаты —
          это исходный текст рекомендаций, модель ничего не пишет сама. Без модели работает обычный
          поиск по словам.
        </p>
      }
    />
  );
}
