import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { openCalculator } from '@/features/calculators/calculator-links';
import { ECG_PHOTO_CALIPER_ID } from '@/features/calculators/calculator-registry';
import { subscribeEcgModel } from '@/features/calculators/ecg-model';
import { subscribeEcgDiagnosticModel } from '@/features/calculators/ecg-numeric-diagnostic';
import {
  describeEcgComponentUpdate,
  ECG_DOWNLOAD_ID,
  ECG_PACKAGE_COMPONENTS,
  type EcgPackageStatus,
  ecgPackageStatus,
  installEcgPackage,
  removeEcgPackage,
} from '@/features/calculators/ecg-package';
import { downloadTaskFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import '@/styles/ecg-editor-flow.css';

export function EcgModelSettings(): JSX.Element {
  const [status, setStatus] = createSignal<EcgPackageStatus>({ state: 'missing', updates: [] });
  const installed = () => status().state === 'installed';
  const outdated = () => status().state === 'outdated';
  const hasFiles = () => status().state !== 'missing';
  const updateMegabytes = () =>
    (status().updates.reduce((sum, item) => sum + item.downloadBytes, 0) / 1024 / 1024).toFixed(1);
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
    setStatus(ecgPackageStatus());
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
  return (
    <section
      class="settings-section settings-section--ecg-model paper-sheet ecg-model-settings"
      aria-labelledby="settings-ecg-model-heading"
    >
      <header class="settings-section__heading">
        <div class="settings-section__heading-main">
          <AppGlyph name="brain-fill" class="settings-section__icon" />
          <div class="settings-section__heading-copy">
            <h2 id="settings-ecg-model-heading" class="settings-section__title">
              Распознавание ЭКГ
            </h2>
            <p class="settings-section__description">
              Фото, измерения и результаты остаются на устройстве. После скачивания работает офлайн.
            </p>
          </div>
        </div>
      </header>
      <p class="ecg-model-settings__status">
        {installed()
          ? 'Установлено'
          : outdated()
            ? `Доступно обновление · ${updateMegabytes()} МБ. Установленная версия работает, пока новая не скачана и не проверена.`
            : hasFiles()
              ? 'Скачано частично — продолжите установку'
              : `${(ECG_PACKAGE_COMPONENTS.reduce((sum, item) => sum + item.downloadBytes, 0) / 1024 / 1024).toFixed(1)} МБ`}
      </p>
      <Show when={outdated()}>
        <ul class="ecg-model-settings__updates">
          <For each={status().updates}>
            {(update) => (
              <li class="ecg-model-settings__update">{describeEcgComponentUpdate(update)}</li>
            )}
          </For>
        </ul>
      </Show>
      <div class="ecg-model-settings__option-footer">
        <Show
          when={installed()}
          fallback={
            <Button
              type="button"
              variant="primary"
              class="ecg-model-settings__action"
              disabled={busy() !== null}
              onClick={() => void install()}
            >
              {busy() === 'download'
                ? task()?.state === 'verifying'
                  ? 'Проверяем данные'
                  : task()?.state === 'installing'
                    ? 'Сохраняем данные'
                    : task()?.state === 'queued'
                      ? 'В очереди'
                      : `Скачиваем ${Math.floor(progress() * 100)}%`
                : outdated()
                  ? 'Обновить'
                  : 'Скачать'}
            </Button>
          }
        >
          <Button
            type="button"
            variant="primary"
            class="ecg-model-settings__action"
            onClick={() => openCalculator(ECG_PHOTO_CALIPER_ID)}
          >
            Открыть
          </Button>
        </Show>
        <Show when={outdated() && busy() === null}>
          <Button
            type="button"
            class="ecg-model-settings__action"
            onClick={() => openCalculator(ECG_PHOTO_CALIPER_ID)}
          >
            Открыть
          </Button>
        </Show>
        <Show when={busy() === 'download'}>
          <Button
            type="button"
            variant="danger"
            class="ecg-model-settings__action"
            disabled={!task()?.canCancel}
            onClick={cancel}
          >
            Отменить
          </Button>
        </Show>
        <Show when={hasFiles() && busy() !== 'download'}>
          <Button
            type="button"
            variant="danger"
            class="ecg-model-settings__action"
            disabled={busy() !== null}
            onClick={() => void remove()}
          >
            Удалить
          </Button>
        </Show>
      </div>
      <details class="ecg-model-settings__details">
        <summary class="ecg-model-settings__details-summary">Подробнее о пакете</summary>
        <For each={ECG_PACKAGE_COMPONENTS}>
          {(candidate) => (
            <div class="ecg-model-settings__option">
              <h3 class="ecg-model-settings__option-name">{candidate.name}</h3>
              <p class="ecg-model-settings__option-description">{candidate.description}</p>
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
        <p class="ecg-model-settings__notice">
          Только для взрослых 18+. Оцифровщик извлекает кривые; числовая модель принимает 30
          подтверждённых измерений и выдаёт пять исследовательских гипотез. Результат требует
          проверки по исходной ЭКГ врачом и не подтверждает острый инфаркт.
        </p>
      </details>
      <Show when={error()}>
        <p class="ecg-model-settings__error" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}
