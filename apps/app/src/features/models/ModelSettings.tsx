import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { OverlayDialog } from '../../components/OverlayDialog';
import type { LocalModelController } from './controller';
import type { LocalModelDescriptor, LocalModelState } from './types';

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

function formatBytes(value: number): string {
  if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)} МБ`;
  return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
}

function modelDownloadSize(model: LocalModelDescriptor, platform: string | null): number | null {
  const artifact = model.artifacts
    .filter(
      (item) =>
        platform === null || item.platforms.includes(platform as 'browser' | 'android' | 'ios'),
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
    });
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
      (artifact) => artifact.runtime === 'wllama-web' && artifact.platforms.includes(platform),
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

  return (
    <section class="model-settings paper-sheet" aria-labelledby="local-model-heading">
      <header class="model-settings-heading">
        <div>
          <p class="archive-kicker">Помощник на устройстве</p>
          <h2 id="local-model-heading">Локальная модель</h2>
          <p>
            Модель работает без отправки медицинского запроса на сервер. Выберите вариант и запустите
            короткую проверку. Основной поиск работает и без модели.
          </p>
        </div>
        <span class={`model-state-badge ${state().phase}`}>{PHASE_LABELS[state().phase]}</span>
      </header>

      <div class="model-doctor-summary">
        <div>
          <span>Сейчас используется</span>
          <strong>{props.controller.modelById(state().activeModelId)?.name ?? 'Только обычный поиск'}</strong>
        </div>
        <Show when={state().recommendedModelId}>
          <div>
            <span>Подходит устройству</span>
            <strong>{props.controller.modelById(state().recommendedModelId)?.name}</strong>
          </div>
        </Show>
      </div>

      <div class="model-settings-controls doctor-controls">
        <label>
          <input
            type="checkbox"
            checked={preference().autoLoad}
            onChange={(event) => void props.controller.setAutoLoad(event.currentTarget.checked)}
          />
          <span>
            <strong>Запускать при открытии MiniMed</strong>
            <small>Только после того, как обычный поиск уже готов.</small>
          </span>
        </label>
        <button
          type="button"
          classList={{ active: preference().automatic }}
          onClick={() => void props.controller.useAutomaticSelection()}
        >
          Подбирать автоматически
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
              return (
                <article
                  class="model-option-card"
                  classList={{
                    recommended: state().recommendedModelId === model.id,
                    active: active(),
                    selected: !preference().automatic && preference().selectedModelId === model.id,
                  }}
                >
                  <div class="model-option-topline">
                    <span>{TIER_LABELS[model.tier]}</span>
                    <Show when={state().recommendedModelId === model.id}>
                      <b>Рекомендуется</b>
                    </Show>
                  </div>
                  <h3>{model.name}</h3>
                  <p>{model.description}</p>
                  <div class="model-friendly-facts">
                    <span>{size() === null ? 'Нет подходящей сборки' : formatBytes(size() ?? 0)}</span>
                    <span>Нужно от {model.minimumMemoryGb} ГБ памяти</span>
                  </div>
                  <Show when={model.license.requiresAcceptance && !accepted()}>
                    <p class="model-license-note">
                      При запуске будут приняты{' '}
                      <a href={model.license.url} target="_blank" rel="noreferrer">
                        условия использования {model.license.name}
                      </a>
                      .
                    </p>
                  </Show>
                  <button
                    type="button"
                    disabled={!available() || busyModelId() !== null}
                    onClick={() => void testModel(model)}
                  >
                    {busyModelId() === model.id
                      ? 'Скачиваем и проверяем…'
                      : active()
                        ? 'Проверить ещё раз'
                        : available()
                          ? 'Скачать и проверить'
                          : 'Пока не поддерживается'}
                  </button>
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
        subtitle={props.controller.modelById(state().selectedModelId)?.name ?? undefined}
        class="model-error-dialog"
        onClose={() => setShowError(false)}
      >
        <div class="model-error-details">
          <p>{state().error}</p>
          <p>
            Обычный поиск MiniMed продолжает работать. Можно повторить проверку этой модели или выбрать
            более лёгкую.
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
