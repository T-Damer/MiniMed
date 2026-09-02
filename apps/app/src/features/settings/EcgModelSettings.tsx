import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  ECG_MODEL_CATALOG,
  type EcgModelCatalogItem,
  type EcgModelDescriptor,
  installEcgModelFromCatalog,
  readEcgModelDescriptor,
  removeEcgModel,
  subscribeEcgModel,
} from '@/features/calculators/ecg-model';
import {
  ECG_DIAGNOSTIC_MODEL_CATALOG,
  type EcgDiagnosticModelDescriptor,
  installEcgDiagnosticModelFromCatalog,
  readEcgDiagnosticModelDescriptor,
  removeEcgDiagnosticModel,
  subscribeEcgDiagnosticModel,
} from '@/features/calculators/ecg-numeric-diagnostic';

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} МБ`;
}

export function EcgModelSettings(): JSX.Element {
  const [model, setModel] = createSignal<EcgModelDescriptor | null>(null);
  const [busyModelId, setBusyModelId] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<number | null>(null);
  const [error, setError] = createSignal('');
  let activeDownload: AbortController | null = null;

  const sync = (): void => {
    setModel(readEcgModelDescriptor());
  };
  onMount(() => {
    sync();
    const unsubscribe = subscribeEcgModel(sync);
    onCleanup(() => {
      unsubscribe();
      activeDownload?.abort();
    });
  });

  const install = async (candidate: EcgModelCatalogItem): Promise<void> => {
    if (busyModelId() === candidate.id) {
      activeDownload?.abort();
      return;
    }
    activeDownload?.abort();
    const controller = new AbortController();
    activeDownload = controller;
    setBusyModelId(candidate.id);
    setProgress(0);
    setError('');
    try {
      setModel(
        await installEcgModelFromCatalog(candidate, {
          signal: controller.signal,
          onProgress: (downloadedBytes, totalBytes) =>
            setProgress(totalBytes > 0 ? downloadedBytes / totalBytes : 0),
        }),
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Не удалось установить оцифровщик ЭКГ.');
      }
    } finally {
      if (activeDownload === controller) activeDownload = null;
      setBusyModelId(null);
      setProgress(null);
    }
  };

  const remove = async (): Promise<void> => {
    activeDownload?.abort();
    setBusyModelId('remove');
    setError('');
    try {
      await removeEcgModel();
      setModel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить оцифровщик ЭКГ.');
    } finally {
      setBusyModelId(null);
    }
  };

  const installed = (candidate: EcgModelCatalogItem): boolean =>
    model()?.checksum === candidate.bundleSha256;

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
              Модули ЭКГ
            </h2>
            <p class="settings-section__description">
              MiniMed скачивает и проверяет выбранные модули. Фото, числовые измерения и результаты
              не покидают устройство.
            </p>
          </div>
        </div>
      </header>

      <Show
        when={model()}
        fallback={<p class="ecg-model-settings__status">Оцифровщик ЭКГ не установлен.</p>}
      >
        {(installed) => (
          <div class="ecg-model-settings__installed">
            <div class="ecg-model-settings__copy">
              <strong class="ecg-model-settings__name">
                {installed().name} · {installed().version}
              </strong>
              <span class="ecg-model-settings__meta">
                {formatBytes(installed().fileBytes)} · {installed().license}
              </span>
              <span class="ecg-model-settings__source">Источник: {installed().source}</span>
            </div>
            <Button
              type="button"
              variant="danger"
              disabled={busyModelId() !== null}
              onClick={() => void remove()}
            >
              Удалить
            </Button>
          </div>
        )}
      </Show>

      <ul class="ecg-model-settings__catalog" aria-label="Доступные оцифровщики ЭКГ">
        <For each={ECG_MODEL_CATALOG}>
          {(candidate) => {
            const busy = () => busyModelId() === candidate.id;
            return (
              <li
                class="ecg-model-settings__option"
                classList={{ 'ecg-model-settings__option--installed': installed(candidate) }}
              >
                <div class="ecg-model-settings__option-header">
                  <div class="ecg-model-settings__option-title">
                    <h3 class="ecg-model-settings__option-name">{candidate.name}</h3>
                    <div class="ecg-model-settings__badges">
                      <Show when={installed(candidate)}>
                        <span class="ecg-model-settings__badge ecg-model-settings__badge--installed">
                          Установлена
                        </span>
                      </Show>
                    </div>
                  </div>
                  <span class="ecg-model-settings__option-version">v{candidate.version}</span>
                </div>
                <p class="ecg-model-settings__option-description">{candidate.description}</p>
                <p class="ecg-model-settings__option-meta">
                  {formatBytes(candidate.downloadBytes)} ·{' '}
                  <a
                    class="ecg-model-settings__license-link"
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {candidate.license}
                  </a>
                </p>
                <Show when={busy() && progress() !== null}>
                  <div
                    class="ecg-model-settings__progress"
                    role="progressbar"
                    aria-label={`Загрузка ${candidate.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((progress() ?? 0) * 100)}
                  >
                    <span
                      class="ecg-model-settings__progress-fill"
                      style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }}
                    />
                  </div>
                </Show>
                <div class="ecg-model-settings__option-footer">
                  <span class="ecg-model-settings__privacy">После установки работает офлайн</span>
                  <Button
                    type="button"
                    variant={busy() ? 'danger' : 'primary'}
                    class="ecg-model-settings__action"
                    disabled={
                      installed(candidate) ||
                      (busyModelId() !== null && busyModelId() !== candidate.id)
                    }
                    onClick={() => void install(candidate)}
                  >
                    {busy() ? 'Отменить' : installed(candidate) ? 'Установлена' : 'Скачать'}
                  </Button>
                </div>
              </li>
            );
          }}
        </For>
      </ul>

      <p class="ecg-model-settings__notice">
        Оцифровщик не ставит диагноз и не выдаёт вероятности заболеваний. Интерпретация строится
        отдельно по измеренным параметрам и объяснимым правилам.
      </p>
      <EcgDiagnosticModelSettings />
      <Show when={error()}>
        <p class="ecg-model-settings__error" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}

function EcgDiagnosticModelSettings(): JSX.Element {
  const [model, setModel] = createSignal<EcgDiagnosticModelDescriptor | null>(null);
  const [busyModelId, setBusyModelId] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<number | null>(null);
  const [error, setError] = createSignal('');
  let activeDownload: AbortController | null = null;

  onMount(() => {
    const sync = (): void => {
      setModel(readEcgDiagnosticModelDescriptor());
    };
    sync();
    const unsubscribe = subscribeEcgDiagnosticModel(sync);
    onCleanup(() => {
      unsubscribe();
      activeDownload?.abort();
    });
  });

  const install = async (candidate: EcgModelCatalogItem): Promise<void> => {
    if (busyModelId() === candidate.id) {
      activeDownload?.abort();
      return;
    }
    activeDownload?.abort();
    const controller = new AbortController();
    activeDownload = controller;
    setBusyModelId(candidate.id);
    setProgress(0);
    setError('');
    try {
      setModel(
        await installEcgDiagnosticModelFromCatalog(candidate, {
          signal: controller.signal,
          onProgress: (downloadedBytes, totalBytes) =>
            setProgress(totalBytes > 0 ? downloadedBytes / totalBytes : 0),
        }),
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : 'Не удалось установить числовую модель ЭКГ.',
        );
      }
    } finally {
      if (activeDownload === controller) activeDownload = null;
      setBusyModelId(null);
      setProgress(null);
    }
  };

  const remove = async (): Promise<void> => {
    activeDownload?.abort();
    setBusyModelId('remove');
    setError('');
    try {
      await removeEcgDiagnosticModel();
      setModel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить числовую модель ЭКГ.');
    } finally {
      setBusyModelId(null);
    }
  };

  const installed = (candidate: EcgModelCatalogItem): boolean =>
    model()?.checksum === candidate.bundleSha256;

  return (
    <div class="ecg-model-settings__diagnostic">
      <div class="ecg-model-settings__subheading">
        <h3 class="ecg-model-settings__subtitle">Распознавание по числовым данным</h3>
        <p class="ecg-model-settings__subdescription">
          Выберите готовую локальную модель. Загружать ZIP вручную не нужно.
        </p>
      </div>

      <Show
        when={model()}
        fallback={<p class="ecg-model-settings__status">Числовая модель ЭКГ не установлена.</p>}
      >
        {(current) => (
          <div class="ecg-model-settings__installed">
            <div class="ecg-model-settings__copy">
              <strong class="ecg-model-settings__name">
                {current().name} · {current().version}
              </strong>
              <span class="ecg-model-settings__meta">
                {formatBytes(current().fileBytes)} · {current().license}
              </span>
              <span class="ecg-model-settings__source">Источник: {current().source}</span>
            </div>
            <Button
              type="button"
              variant="danger"
              disabled={busyModelId() !== null}
              onClick={() => void remove()}
            >
              Удалить
            </Button>
          </div>
        )}
      </Show>

      <ul class="ecg-model-settings__catalog" aria-label="Доступные числовые модели ЭКГ">
        <For each={ECG_DIAGNOSTIC_MODEL_CATALOG}>
          {(candidate) => {
            const busy = () => busyModelId() === candidate.id;
            return (
              <li
                class="ecg-model-settings__option"
                classList={{ 'ecg-model-settings__option--installed': installed(candidate) }}
              >
                <div class="ecg-model-settings__option-header">
                  <div class="ecg-model-settings__option-title">
                    <h4 class="ecg-model-settings__option-name">{candidate.name}</h4>
                    <Show when={installed(candidate)}>
                      <span class="ecg-model-settings__badge ecg-model-settings__badge--installed">
                        Установлена
                      </span>
                    </Show>
                  </div>
                  <span class="ecg-model-settings__option-version">v{candidate.version}</span>
                </div>
                <p class="ecg-model-settings__option-description">{candidate.description}</p>
                <p class="ecg-model-settings__option-meta">
                  {formatBytes(candidate.downloadBytes)} ·{' '}
                  <a
                    class="ecg-model-settings__license-link"
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {candidate.license}
                  </a>
                </p>
                <Show when={busy() && progress() !== null}>
                  <div
                    class="ecg-model-settings__progress"
                    role="progressbar"
                    aria-label={`Загрузка ${candidate.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((progress() ?? 0) * 100)}
                  >
                    <span
                      class="ecg-model-settings__progress-fill"
                      style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }}
                    />
                  </div>
                </Show>
                <div class="ecg-model-settings__option-footer">
                  <span class="ecg-model-settings__privacy">После установки работает офлайн</span>
                  <Button
                    type="button"
                    variant={busy() ? 'danger' : 'primary'}
                    class="ecg-model-settings__action"
                    disabled={
                      installed(candidate) ||
                      (busyModelId() !== null && busyModelId() !== candidate.id)
                    }
                    onClick={() => void install(candidate)}
                  >
                    {busy() ? 'Отменить' : installed(candidate) ? 'Установлена' : 'Скачать'}
                  </Button>
                </div>
              </li>
            );
          }}
        </For>
      </ul>
      <p class="ecg-model-settings__notice">
        Модель принимает 30 подтверждённых значений в мс и мВ и выдаёт пять исследовательских
        гипотез. Она не анализирует фото, не заменяет врача и не подтверждает острый инфаркт.
      </p>
      <Show when={error()}>
        <p class="ecg-model-settings__error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
