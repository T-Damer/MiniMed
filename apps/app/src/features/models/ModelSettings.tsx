import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { LocalModelController } from '@/features/models/controller';
import { runtimeAvailableForDevice } from '@/features/models/model-runtime-availability';
import type { LocalModelDescriptor, LocalModelState } from '@/features/models/types';

interface ModelSettingsProps {
  readonly controller: LocalModelController;
}

const PHASE_LABELS: Readonly<Record<LocalModelState['phase'], string>> = {
  idle: 'Не запускалась',
  probing: 'Проверяем устройство',
  selecting: 'Выбираем модель',
  deferred: 'Ожидает запуска',
  downloading: 'Скачиваем',
  loading: 'Запускаем',
  benchmarking: 'Проверяем',
  ready: 'Готова',
  error: 'Не работает',
};

const TIER_LABELS: Readonly<Record<LocalModelDescriptor['tier'], string>> = {
  compact: 'Лёгкая',
  balanced: 'Сбалансированная',
  quality: 'Повышенное качество',
};

const ACTIVE_LOAD_PHASES = new Set<LocalModelState['phase']>([
  'probing',
  'selecting',
  'downloading',
  'loading',
  'benchmarking',
]);

function isActiveLoadPhase(phase: LocalModelState['phase']): boolean {
  return ACTIVE_LOAD_PHASES.has(phase);
}

function deviceFitsModel(
  model: LocalModelDescriptor,
  deviceMemoryGb: number | null | undefined,
): boolean | null {
  if (deviceMemoryGb === null || deviceMemoryGb === undefined) return null;
  return deviceMemoryGb >= model.minimumMemoryGb;
}

function modelStatusLabel(
  model: LocalModelDescriptor,
  options: {
    readonly active: boolean;
    readonly recommended: boolean;
    readonly available: boolean;
    readonly loading: boolean;
    readonly deviceMemoryGb: number | null | undefined;
  },
): string | null {
  if (options.loading) return 'Загрузка';
  if (options.active) return 'Запущена';
  if (options.recommended) return 'Рекомендуется';
  const fits = deviceFitsModel(model, options.deviceMemoryGb);
  if (fits === false) return 'Мало памяти';
  return null;
}

function formatBytes(value: number): string {
  if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)} МБ`;
  return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
}

function modelDownloadSize(model: LocalModelDescriptor, platform: string | null): number | null {
  const artifact = model.artifacts
    .filter(
      (item) =>
        item.published &&
        (platform === null || item.platforms.includes(platform as 'browser' | 'android' | 'ios')),
    )
    .toSorted((left, right) => left.downloadBytes - right.downloadBytes)[0];
  return artifact?.downloadBytes ?? null;
}

export function ModelSettings(props: ModelSettingsProps): JSX.Element {
  const [state, setState] = createSignal<LocalModelState>(props.controller.getState());
  const [busyModelId, setBusyModelId] = createSignal<string | null>(null);
  const [showError, setShowError] = createSignal(false);
  let unsubscribe: (() => void) | undefined;

  onMount(() => {
    unsubscribe = props.controller.subscribe((next) => {
      setState(next);
      if (next.phase === 'error') setShowError(true);
      if (!isActiveLoadPhase(next.phase)) setBusyModelId(null);
    });
  });
  onCleanup(() => unsubscribe?.());

  const preference = (): ReturnType<LocalModelController['getPreference']> =>
    props.controller.getPreference();
  const catalog = () => props.controller.getCatalog();
  const models = createMemo(() => catalog()?.models ?? []);
  const acceptedLicenses = (): ReadonlySet<string> => new Set(preference().acceptedLicenseIds);

  // A load can be started by this page or by the background autoload; both must lock the controls.
  // The controller state, not local click bookkeeping, decides what is in flight.
  const busyPhase = (): boolean => isActiveLoadPhase(state().phase);
  const inFlightModelId = (): string | null =>
    busyPhase() ? (busyModelId() ?? state().selectedModelId ?? null) : null;
  const currentStateTitle = (): string =>
    state().phase === 'ready'
      ? (props.controller.modelById(state().activeModelId)?.name ?? state().message)
      : state().message;
  const currentStateDetail = (): string | null => {
    if (state().phase === 'idle') return null;
    return PHASE_LABELS[state().phase];
  };

  const runtimeAvailable = (model: LocalModelDescriptor): boolean => {
    const device = state().device;
    return device !== null && runtimeAvailableForDevice(model, device);
  };

  const testModel = async (model: LocalModelDescriptor): Promise<void> => {
    setShowError(false);
    setBusyModelId(model.id);
    try {
      if (model.license.requiresAcceptance && !acceptedLicenses().has(model.license.id)) {
        await props.controller.setLicenseAccepted(model.license.id, true);
      }
      await props.controller.selectModel(model.id);
    } finally {
      setBusyModelId(null);
    }
  };

  const cancelLoad = (): void => {
    props.controller.cancelLoad();
    setBusyModelId(null);
  };

  return (
    <section
      class="settings-section settings-section--local-model paper-sheet model-settings"
      aria-labelledby="local-model-heading"
    >
      <header class="settings-section__heading">
        <div class="settings-section__heading-main">
          <AppGlyph name="brain" class="settings-section__icon" />
          <h2 id="local-model-heading" class="settings-section__title">
            Локальная модель
          </h2>
        </div>
      </header>

      <div class="model-current-state" aria-live="polite">
        <div class="model-current-state__copy">
          <strong>{currentStateTitle()}</strong>
          <Show when={currentStateDetail()}>{(detail) => <span>{detail()}</span>}</Show>
          <Show when={state().progress !== null}>
            <div
              class="model-current-state__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((state().progress ?? 0) * 100)}
            >
              <i style={{ width: `${Math.round((state().progress ?? 0) * 100)}%` }} />
            </div>
          </Show>
        </div>
        <Show
          when={busyPhase()}
          fallback={
            <Show
              when={state().phase === 'ready'}
              fallback={
                <Button
                  type="button"
                  variant="primary"
                  class="model-current-state__action model-device-check"
                  disabled={busyPhase()}
                  onClick={() => void props.controller.start()}
                >
                  Проверить устройство
                </Button>
              }
            >
              <Button
                type="button"
                variant="danger"
                class="model-current-state__action"
                onClick={() => void props.controller.unload()}
              >
                Остановить
              </Button>
            </Show>
          }
        >
          <Button
            type="button"
            variant="danger"
            class="model-current-state__action model-download-cancel"
            onClick={cancelLoad}
          >
            Отменить
          </Button>
        </Show>
      </div>

      <Show
        when={models().length > 0}
        fallback={<p class="model-settings-empty">Получаем список доступных моделей…</p>}
      >
        <details class="model-catalog-details">
          <summary class="model-catalog-details__summary">
            <strong class="model-catalog-details__title">Модели</strong>
            <span class="model-catalog-details__count">{models().length}</span>
            <AppGlyph name="caret-down" class="model-catalog-details__chevron" aria-hidden="true" />
          </summary>
          <div class="model-card-grid">
            <For each={models()}>
              {(model) => {
                const size = () => modelDownloadSize(model, state().device?.platform ?? null);
                const accepted = () =>
                  !model.license.requiresAcceptance || acceptedLicenses().has(model.license.id);
                const available = () => runtimeAvailable(model);
                const active = () => state().activeModelId === model.id;
                const recommended = () => state().recommendedModelId === model.id;
                const loading = () => inFlightModelId() === model.id && busyPhase();
                const deviceMemoryGb = () => state().device?.deviceMemoryGb;
                const statusLabel = () =>
                  modelStatusLabel(model, {
                    active: active(),
                    recommended: recommended(),
                    available: available(),
                    loading: loading(),
                    deviceMemoryGb: deviceMemoryGb(),
                  });
                return (
                  <article
                    class="model-option-card"
                    classList={{
                      recommended: recommended(),
                      active: active(),
                      selected:
                        !preference().automatic && preference().selectedModelId === model.id,
                      loading: loading(),
                      unavailable: !available(),
                    }}
                    title={model.description}
                  >
                    <div class="model-option-header">
                      <div class="model-option-title">
                        <h3 class="model-option-title__name">{model.name}</h3>
                        <span class="model-tier-chip">{TIER_LABELS[model.tier]}</span>
                      </div>
                      <Show when={statusLabel()}>
                        {(label) => (
                          <span
                            class="model-option-status"
                            classList={{
                              active: active(),
                              recommended: recommended(),
                              warning:
                                available() && deviceFitsModel(model, deviceMemoryGb()) === false,
                              loading: loading(),
                            }}
                          >
                            {label()}
                          </span>
                        )}
                      </Show>
                    </div>
                    <div class="model-option-row">
                      <p class="model-option-meta">
                        {size() === null ? 'Размер неизвестен' : formatBytes(size() ?? 0)} · от{' '}
                        {model.minimumMemoryGb} ГБ ОЗУ
                      </p>
                      <Button
                        type="button"
                        variant={loading() ? 'danger' : active() ? 'secondary' : 'primary'}
                        class="model-option-action"
                        disabled={!available() || (busyPhase() && inFlightModelId() !== model.id)}
                        onClick={() => {
                          if (loading()) {
                            cancelLoad();
                            return;
                          }
                          void testModel(model);
                        }}
                      >
                        {loading()
                          ? 'Отменить'
                          : active()
                            ? 'Перепроверить'
                            : available()
                              ? 'Скачать'
                              : 'Недоступно'}
                      </Button>
                    </div>
                    <Show when={model.license.requiresAcceptance && !accepted() && available()}>
                      <p class="model-license-note">
                        Лицензия{' '}
                        <a href={model.license.url} target="_blank" rel="noreferrer">
                          {model.license.name}
                        </a>{' '}
                        — при запуске.
                      </p>
                    </Show>
                  </article>
                );
              }}
            </For>
          </div>
        </details>
      </Show>

      <Show when={state().error}>
        <Button
          class="model-error-button"
          type="button"
          variant="danger"
          onClick={() => setShowError(true)}
        >
          Модель не запустилась. Нажмите, чтобы посмотреть причину и повторить проверку.
        </Button>
      </Show>

      <OverlayDialog
        open={showError() && Boolean(state().error)}
        title="Почему модель не запустилась"
        subtitle={props.controller.modelById(state().selectedModelId)?.name ?? 'Выбранная модель'}
        class="model-error-dialog"
        onClose={() => {
          setShowError(false);
        }}
      >
        <div class="model-error-details">
          <p>{state().error}</p>
          <p>
            Обычный поиск MiniMed продолжает работать. Можно повторить проверку этой модели или
            выбрать более лёгкую.
          </p>
          <div class="model-error-actions">
            <Show when={state().selectedModelId}>
              {(modelId) => (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    const model = props.controller.modelById(modelId());
                    if (model) void testModel(model);
                  }}
                >
                  Повторить проверку
                </Button>
              )}
            </Show>
            <Button type="button" onClick={() => setShowError(false)}>
              Выбрать другую модель
            </Button>
          </div>
          <details class="doctor-technical-details">
            <summary>Данные для сообщения об ошибке</summary>
            <pre>{JSON.stringify({ state: state().phase, device: state().device }, null, 2)}</pre>
          </details>
        </div>
      </OverlayDialog>
    </section>
  );
}
