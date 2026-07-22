import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { LocalModelController } from './controller';
import type { LocalModelDescriptor, LocalModelState } from './types';

interface ModelSettingsProps {
  readonly controller: LocalModelController;
}

function formatBytes(value: number): string {
  if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)} МБ`;
  return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
}

function modelDownloadSize(model: LocalModelDescriptor, platform: string | null): number | null {
  const artifact = model.artifacts
    .filter((item) => platform === null || item.platforms.includes(platform as 'browser' | 'android' | 'ios'))
    .toSorted((left, right) => left.downloadBytes - right.downloadBytes)[0];
  return artifact?.downloadBytes ?? null;
}

export function ModelSettings(props: ModelSettingsProps): JSX.Element {
  const [state, setState] = createSignal<LocalModelState>(props.controller.getState());
  const [busyModelId, setBusyModelId] = createSignal<string | null>(null);
  let unsubscribe: (() => void) | undefined;

  onMount(() => {
    unsubscribe = props.controller.subscribe(setState);
  });
  onCleanup(() => unsubscribe?.());

  const preference = (): ReturnType<LocalModelController['getPreference']> =>
    props.controller.getPreference();
  const catalog = () => props.controller.getCatalog();
  const models = createMemo(() => catalog()?.models ?? []);
  const acceptedLicenses = (): ReadonlySet<string> =>
    new Set(preference().acceptedLicenseIds);

  const runtimeAvailable = (model: LocalModelDescriptor): boolean => {
    const platform = state().device?.platform;
    if (!platform) return false;
    return model.artifacts.some(
      (artifact) => artifact.runtime === 'wllama-web' && artifact.platforms.includes(platform),
    );
  };

  const choose = async (model: LocalModelDescriptor): Promise<void> => {
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
          <p class="archive-kicker">OPTIONAL LOCAL MODEL</p>
          <h2 id="local-model-heading">Локальная модель</h2>
          <p>
            MiniMed автоматически выбирает модель по памяти, хранилищу, runtime и русскому
            benchmark. SQLite-поиск работает независимо от модели.
          </p>
        </div>
        <span class={`model-state-badge ${state().phase}`}>{state().phase}</span>
      </header>

      <div class="model-settings-summary">
        <div>
          <span>РЕЖИМ</span>
          <strong>{preference().automatic ? 'автоматический' : 'ручной'}</strong>
        </div>
        <div>
          <span>РЕКОМЕНДОВАНА</span>
          <strong>
            {props.controller.modelById(state().recommendedModelId)?.name ?? 'не определена'}
          </strong>
        </div>
        <div>
          <span>ЗАГРУЖЕНА</span>
          <strong>{props.controller.modelById(state().activeModelId)?.name ?? 'нет'}</strong>
        </div>
        <div>
          <span>УСТРОЙСТВО</span>
          <strong>
            {state().device
              ? `${state().device?.platform} · ${state().device?.deviceMemoryGb ?? '?'} ГБ`
              : 'ещё не проверено'}
          </strong>
        </div>
      </div>

      <div class="model-settings-controls">
        <label>
          <input
            type="checkbox"
            checked={preference().autoLoad}
            onChange={(event) => void props.controller.setAutoLoad(event.currentTarget.checked)}
          />
          <span>
            <strong>Загружать автоматически</strong>
            <small>Модель запускается после готовности основного поискового ядра.</small>
          </span>
        </label>
        <button
          type="button"
          classList={{ active: preference().automatic }}
          onClick={() => void props.controller.useAutomaticSelection()}
        >
          Выбирать автоматически
        </button>
        <Show when={state().activeModelId}>
          <button type="button" onClick={() => void props.controller.unload()}>
            Выгрузить из памяти
          </button>
        </Show>
      </div>

      <Show
        when={models().length > 0}
        fallback={<p class="model-settings-empty">Каталог моделей ещё загружается.</p>}
      >
        <div class="model-card-grid">
          <For each={models()}>
            {(model) => {
              const size = () => modelDownloadSize(model, state().device?.platform ?? null);
              const accepted = () =>
                !model.license.requiresAcceptance || acceptedLicenses().has(model.license.id);
              const available = () => runtimeAvailable(model);
              return (
                <article
                  class="model-option-card"
                  classList={{
                    recommended: state().recommendedModelId === model.id,
                    active: state().activeModelId === model.id,
                    selected: !preference().automatic && preference().selectedModelId === model.id,
                  }}
                >
                  <div class="model-option-topline">
                    <span>{model.tier}</span>
                    <Show when={state().recommendedModelId === model.id}>
                      <b>Рекомендована</b>
                    </Show>
                  </div>
                  <h3>{model.name}</h3>
                  <p>{model.description}</p>
                  <dl>
                    <div>
                      <dt>Размер</dt>
                      <dd>{size() === null ? 'нет сборки' : formatBytes(size() ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Память</dt>
                      <dd>от {model.minimumMemoryGb} ГБ</dd>
                    </div>
                    <div>
                      <dt>Runtime</dt>
                      <dd>{available() ? 'доступен' : 'пока недоступен'}</dd>
                    </div>
                  </dl>
                  <Show when={model.license.requiresAcceptance && !accepted()}>
                    <p class="model-license-note">
                      Выбор означает принятие{' '}
                      <a href={model.license.url} target="_blank" rel="noreferrer">
                        {model.license.name}
                      </a>
                      .
                    </p>
                  </Show>
                  <button
                    type="button"
                    disabled={!available() || busyModelId() !== null}
                    onClick={() => void choose(model)}
                  >
                    {busyModelId() === model.id
                      ? 'Запускаем…'
                      : state().activeModelId === model.id
                        ? 'Загружена'
                        : available()
                          ? 'Использовать'
                          : 'Нужен нативный runtime'}
                  </button>
                </article>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={state().benchmark}>
        {(benchmark) => (
          <div class="model-benchmark-line">
            <span>Последняя проверка</span>
            <strong>{Math.round(benchmark().loadMs)} мс загрузка</strong>
            <strong>{Math.round(benchmark().generationMs)} мс тест</strong>
            <strong>{benchmark().validStructuredOutput ? 'JSON OK' : 'JSON FAIL'}</strong>
          </div>
        )}
      </Show>
      <Show when={state().error}>
        {(error) => <p class="model-settings-warning">{error()}</p>}
      </Show>
    </section>
  );
}
