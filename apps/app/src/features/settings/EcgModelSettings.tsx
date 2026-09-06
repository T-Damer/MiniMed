import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { openCalculator } from '@/features/calculators/calculator-links';
import { ECG_PHOTO_CALIPER_ID } from '@/features/calculators/calculator-registry';
import { readEcgModelDescriptor, subscribeEcgModel } from '@/features/calculators/ecg-model';
import {
  readEcgDiagnosticModelDescriptor,
  subscribeEcgDiagnosticModel,
} from '@/features/calculators/ecg-numeric-diagnostic';
import {
  ECG_PACKAGE_COMPONENTS,
  installEcgPackage,
  isEcgPackageInstalled,
  removeEcgPackage,
} from '@/features/calculators/ecg-package';

export function EcgModelSettings(): JSX.Element {
  const [installed, setInstalled] = createSignal(false);
  const [hasFiles, setHasFiles] = createSignal(false);
  const [busy, setBusy] = createSignal<'download' | 'remove' | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal('');
  let activeDownload: AbortController | undefined;
  const sync = (): void => {
    setInstalled(isEcgPackageInstalled());
    setHasFiles(Boolean(readEcgModelDescriptor() || readEcgDiagnosticModelDescriptor()));
  };
  onMount(() => {
    sync();
    const subscriptions = [subscribeEcgModel(sync), subscribeEcgDiagnosticModel(sync)];
    onCleanup(() => {
      for (const unsubscribe of subscriptions) unsubscribe();
      activeDownload?.abort();
    });
  });
  const install = async (): Promise<void> => {
    if (busy()) return;
    const controller = new AbortController();
    activeDownload = controller;
    setBusy('download');
    setProgress(0);
    setError('');
    try {
      await installEcgPackage(controller.signal, setProgress);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось скачать распознавание ЭКГ.');
    } finally {
      sync();
      activeDownload = undefined;
      setBusy(null);
    }
  };
  const remove = async (): Promise<void> => {
    if (busy()) return;
    setBusy('remove');
    setError('');
    try {
      await removeEcgPackage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить распознавание ЭКГ.');
    } finally {
      sync();
      setBusy(null);
    }
  };
  return (
    <section
      class="settings-section settings-section--ecg-model paper-sheet ecg-model-settings"
      aria-labelledby="settings-ecg-model-heading"
    >
      <header class="settings-section__heading">
        <div class="settings-section__heading-main">
          <AppGlyph name="brain" class="settings-section__icon" />
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
          : hasFiles()
            ? 'Скачано частично — продолжите установку'
            : `${(ECG_PACKAGE_COMPONENTS.reduce((sum, item) => sum + item.downloadBytes, 0) / 1024 / 1024).toFixed(1)} МБ`}
      </p>
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
              {busy() === 'download' ? `Скачиваем ${Math.round(progress() * 100)}%` : 'Скачать'}
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
        <Show when={busy() === 'download'}>
          <Button
            type="button"
            variant="danger"
            class="ecg-model-settings__action"
            onClick={() => activeDownload?.abort()}
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
