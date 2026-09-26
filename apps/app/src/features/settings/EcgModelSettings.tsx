import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Button } from '@/components/Button';
import { FeatureCard } from '@/components/FeatureCard';
import { openCalculator } from '@/features/calculators/calculator-links';
import { ECG_PHOTO_CALIPER_ID } from '@/features/calculators/calculator-registry';
import { readEcgModelDescriptor, subscribeEcgModel } from '@/features/calculators/ecg-model';
import {
  readEcgDiagnosticModelDescriptor,
  subscribeEcgDiagnosticModel,
} from '@/features/calculators/ecg-numeric-diagnostic';
import {
  ECG_DOWNLOAD_ID,
  ECG_PACKAGE_COMPONENTS,
  installEcgPackage,
  isEcgPackageInstalled,
  removeEcgPackage,
} from '@/features/calculators/ecg-package';
import { downloadTaskFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';

export function EcgModelSettings(): JSX.Element {
  const [installed, setInstalled] = createSignal(false);
  const [hasFiles, setHasFiles] = createSignal(false);
  const queue = getDownloadQueue();
  const [task, setTask] = createSignal(queue.get(ECG_DOWNLOAD_ID));
  const [removing, setRemoving] = createSignal(false);
  const busy = () => {
    const current = task();
    return removing() ? 'remove' : current && isDownloadActive(current) ? 'download' : null;
  };
  const progress = () => {
    const current = task();
    return current ? (downloadTaskFraction(current) ?? 0) : 0;
  };
  const [error, setError] = createSignal('');
  let disposed = false;
  const sync = (): void => {
    setInstalled(isEcgPackageInstalled());
    setHasFiles(Boolean(readEcgModelDescriptor() || readEcgDiagnosticModelDescriptor()));
  };
  onMount(() => {
    sync();
    const updateTask = () => {
      setTask(queue.get(ECG_DOWNLOAD_ID));
      sync();
    };
    updateTask();
    const subscriptions = [
      subscribeEcgModel(sync),
      subscribeEcgDiagnosticModel(sync),
      queue.subscribe(updateTask),
    ];
    onCleanup(() => {
      for (const unsubscribe of subscriptions) unsubscribe();
      disposed = true;
    });
  });
  const install = async (): Promise<void> => {
    if (busy()) return;
    setError('');
    try {
      await installEcgPackage(new AbortController().signal, () => undefined);
    } catch (cause) {
      if (!disposed && !(cause instanceof Error && cause.name === 'AbortError'))
        setError('Не удалось скачать или проверить распознавание ЭКГ.');
    } finally {
      if (!disposed) sync();
    }
  };
  const cancel = (): void => {
    void queue.cancel(ECG_DOWNLOAD_ID).catch(() => {
      if (!disposed) setError('Не удалось подтвердить отмену загрузки.');
    });
  };
  const remove = async (): Promise<void> => {
    if (busy()) return;
    setRemoving(true);
    setError('');
    try {
      await removeEcgPackage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить распознавание ЭКГ.');
    } finally {
      sync();
      setRemoving(false);
    }
  };
  const sizeLabel = (): string =>
    `${(ECG_PACKAGE_COMPONENTS.reduce((sum, item) => sum + item.downloadBytes, 0) / 1024 / 1024)
      .toFixed(1)
      .replace('.', ',')} МБ`;
  const status = (): string => {
    const current = task();
    if (busy() === 'remove') return 'Удаляем…';
    if (busy() === 'download') {
      if (current?.state === 'verifying') return 'Проверяем файлы…';
      if (current?.state === 'installing') return 'Устанавливаем…';
      if (current?.state === 'queued') return 'В очереди';
      return `Скачивается · ${Math.floor(progress() * 100)}%`;
    }
    if (installed()) return 'Готово к работе';
    if (hasFiles()) return 'Скачано не полностью';
    return `Не скачано · ${sizeLabel()}`;
  };
  return (
    <FeatureCard
      class="ecg-model-settings"
      headingId="settings-ecg-model-heading"
      icon="microscope"
      title="Распознавание ЭКГ по фото"
      summary="Сфотографируйте ленту ЭКГ: MiniMed оцифрует кривые и поможет измерить интервалы. Фото и результаты не покидают устройство."
      status={status()}
      tone={error() ? 'error' : busy() ? 'working' : installed() ? 'ready' : 'idle'}
      {...(busy() === 'download' ? { progress: progress() || null } : {})}
      {...(error() ? { error: error() } : {})}
      actions={
        <>
          <Show
            when={installed()}
            fallback={
              <Button
                type="button"
                variant="primary"
                disabled={busy() !== null}
                onClick={() => void install()}
              >
                {hasFiles() ? 'Докачать' : 'Скачать'}
              </Button>
            }
          >
            <Button
              type="button"
              variant="primary"
              onClick={() => openCalculator(ECG_PHOTO_CALIPER_ID)}
            >
              Открыть
            </Button>
          </Show>
          <Show when={busy() === 'download'}>
            <Button type="button" variant="quiet" disabled={!task()?.canCancel} onClick={cancel}>
              Отменить
            </Button>
          </Show>
          <Show when={hasFiles() && busy() !== 'download'}>
            <Button
              type="button"
              variant="quiet"
              disabled={busy() !== null}
              onClick={() => void remove()}
            >
              Удалить
            </Button>
          </Show>
        </>
      }
      detailsTitle="Что внутри и ограничения"
      details={
        <>
          <p class="ecg-model-settings__notice">
            Для взрослых 18+. Модель предлагает исследовательские гипотезы по 30 подтверждённым
            измерениям. Заключение всегда делает врач по исходной ЭКГ; острый инфаркт так не
            подтверждается и не исключается.
          </p>
          <For each={ECG_PACKAGE_COMPONENTS}>
            {(candidate) => (
              <div class="ecg-model-settings__option">
                <span class="ecg-model-settings__option-name">{candidate.name}</span>
                <span class="ecg-model-settings__option-description">{candidate.description}</span>
                <a
                  class="ecg-model-settings__license-link"
                  href={candidate.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {candidate.license} · {candidate.version}
                </a>
              </div>
            )}
          </For>
        </>
      }
    />
  );
}
