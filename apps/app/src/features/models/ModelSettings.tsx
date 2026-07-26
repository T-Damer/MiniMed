import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { LocalModelController } from '@/features/models/controller';
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

const DOWNLOAD_PHASES = new Set<LocalModelState['phase']>(['downloading', 'loading']);

function isActiveLoadPhase(phase: LocalModelState['phase']): boolean {
  return ACTIVE_LOAD_PHASES.has(phase);
}

function isDownloadPhase(phase: LocalModelState['phase']): boolean {
  return DOWNLOAD_PHASES.has(phase);
}

function deviceFitsModel(
  model: LocalModelDescriptor,
  deviceMemoryGb: number | null | undefined,
): boolean | null {
  if (deviceMemoryGb === null || deviceMemoryGb === undefined) return null;
  return deviceMemoryGb >= model.minimumMemoryGb;
}

function modelDeviceLabel(
  model: LocalModelDescriptor,
  deviceMemoryGb: number | null | undefined,
  available: boolean,
): string {
  if (!available) return 'Нет в браузере';
  const fits = deviceFitsModel(model, deviceMemoryGb);
  if (fits === true) return 'Подходит';
  if (fits === false) return 'Мало памяти';
  return 'Не проверено';
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
    if (!props.controller.getPreference().autoLoad) void props.controller.setAutoLoad(true);
  });
  onCleanup(() => unsubscribe?.());

  const preference = (): ReturnType<LocalModelController['getPreference']> =>
    props.controller.getPreference();
  const catalog = () => props.controller.getCatalog();
  const models = createMemo(() => catalog()?.models ?? []);
  const acceptedLicenses = (): ReadonlySet<string> => new Set(preference().acceptedLicenseIds);

  const runtimeAvailable = (model: LocalModelDescriptor): boolean => {
    const platform = state().device?.platform;
    if (!platform) return false;
    return model.artifacts.some(
      (artifact) =>
        artifact.published &&
        artifact.runtime === 'wllama-web' &&
        artifact.platforms.includes(platform),
    );
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
    <section class="model-settings paper-sheet" aria-labelledby="local-model-heading">
      <header class="model-settings-heading">
        <div>
          <p class="archive-kicker">Помощник на устройстве</p>
          <h2 id="local-model-heading">
            <AppGlyph name="brain" /> Локальная модель
          </h2>
          <p>
            Модель работает на устройстве без отправки запроса на сервер. Поиск доступен и без неё.
          </p>
        </div>
        <span class={`model-state-badge ${state().phase}`}>{PHASE_LABELS[state().phase]}</span>
      </header>

      <div class="model-doctor-summary">
        <div>
          <span>Сейчас используется</span>
          <strong>
            {props.controller.modelById(state().activeModelId)?.name ?? 'Только обычный поиск'}
          </strong>
        </div>
        <Show when={state().recommendedModelId}>
          <div>
            <span>Подходит устройству</span>
            <strong>{props.controller.modelById(state().recommendedModelId)?.name}</strong>
          </div>
        </Show>
      </div>

      <Show when={isActiveLoadPhase(state().phase)}>
        <div class="model-download-status paper-card" aria-live="polite">
          <div class="model-download-status-header">
            <strong>{PHASE_LABELS[state().phase]}</strong>
            <button type="button" class="model-download-cancel" onClick={cancelLoad}>
              Отменить
            </button>
          </div>
          <span>{state().message}</span>
          <Show when={state().progress !== null}>
            <div
              class="model-download-status-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((state().progress ?? 0) * 100)}
            >
              <i style={{ width: `${Math.round((state().progress ?? 0) * 100)}%` }} />
            </div>
          </Show>
        </div>
      </Show>

      <div class="model-settings-controls doctor-controls">
        <button
          type="button"
          classList={{ active: preference().automatic }}
          disabled={isDownloadPhase(state().phase)}
          onClick={() => void props.controller.useAutomaticSelection()}
        >
          Подобрать автоматически
        </button>
        <Show when={state().activeModelId}>
          <button type="button" onClick={() => void props.controller.unload()}>
            Остановить модель
          </button>
        </Show>
      </div>

      <Show
        when={models().length > 0}
        fallback={<p class="model-settings-empty">Получаем список доступных моделей…</p>}
      >
        <div class="model-card-grid">
          <For each={models()}>
            {(model) => {
              const size = () => modelDownloadSize(model, state().device?.platform ?? null);
              const accepted = () =>
                !model.license.requiresAcceptance || acceptedLicenses().has(model.license.id);
              const available = () => runtimeAvailable(model);
              const active = () => state().activeModelId === model.id;
              const recommended = () => state().recommendedModelId === model.id;
              const loading = () => busyModelId() === model.id && isActiveLoadPhase(state().phase);
              const deviceMemoryGb = () => state().device?.deviceMemoryGb;
              const statusLabel = () =>
                modelStatusLabel(model, {
                  active: active(),
                  recommended: recommended(),
                  available: available(),
                  loading: loading(),
                  deviceMemoryGb: deviceMemoryGb(),
                });
              const deviceLabel = () => modelDeviceLabel(model, deviceMemoryGb(), available());
              return (
                <article
                  class="model-option-card"
                  classList={{
                    recommended: recommended(),
                    active: active(),
                    selected: !preference().automatic && preference().selectedModelId === model.id,
                    loading: loading(),
                    unavailable: !available(),
                  }}
                  title={model.description}
                >
                  <div class="model-option-header">
                    <div class="model-option-title">
                      <h3>{model.name}</h3>
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
                    <dl class="model-option-specs">
                      <div>
                        <dt>Размер</dt>
                        <dd>{size() === null ? '—' : formatBytes(size() ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>ОЗУ</dt>
                        <dd>от {model.minimumMemoryGb} ГБ</dd>
                      </div>
                      <div>
                        <dt>Устройство</dt>
                        <dd>{deviceLabel()}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      class="model-option-action"
                      disabled={
                        !available() || (busyModelId() !== null && busyModelId() !== model.id)
                      }
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
                        : busyModelId() === model.id
                          ? 'Проверяем…'
                          : active()
                            ? 'Перепроверить'
                            : available()
                              ? 'Скачать'
                              : 'Недоступно'}
                    </button>
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
      </Show>

      <Show when={state().error}>
        <button class="model-error-button" type="button" onClick={() => setShowError(true)}>
          Модель не запустилась. Нажмите, чтобы посмотреть причину и повторить проверку.
        </button>
      </Show>

      <details class="doctor-technical-details model-technical-details">
        <summary>Технические сведения</summary>
        <div class="model-settings-summary">
          <div>
            <span>Режим</span>
            <strong>{preference().automatic ? 'автоматический' : 'ручной'}</strong>
          </div>
          <div>
            <span>Каталог</span>
            <strong>{state().catalogSource ?? 'не загружен'}</strong>
          </div>
          <div>
            <span>Устройство</span>
            <strong>
              {state().device
                ? `${state().device?.platform} · ${state().device?.deviceMemoryGb ?? '?'} ГБ`
                : 'не проверено'}
            </strong>
          </div>
          <Show when={state().benchmark}>
            {(benchmark) => (
              <div>
                <span>Последний тест</span>
                <strong>
                  {Math.round(benchmark().loadMs)} мс / {Math.round(benchmark().generationMs)} мс
                </strong>
              </div>
            )}
          </Show>
        </div>
      </details>

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
                <button
                  type="button"
                  onClick={() => {
                    const model = props.controller.modelById(modelId());
                    if (model) void testModel(model);
                  }}
                >
                  Повторить проверку
                </button>
              )}
            </Show>
            <button type="button" onClick={() => setShowError(false)}>
              Выбрать другую модель
            </button>
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
