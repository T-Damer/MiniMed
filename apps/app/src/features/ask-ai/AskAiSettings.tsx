import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { SegmentedControl } from '@/components/SegmentedControl';
import { askAiFailureMessage, testAskAiConnection } from '@/features/ask-ai/ask-ai-client';
import {
  type AskAiProvider,
  clearAskAiConfig,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_YANDEX_MODEL,
  isAskAiAvailable,
  loadAskAiConfig,
  saveAskAiConfig,
} from '@/features/ask-ai/ask-ai-config';
import {
  consumeOpenRouterOAuthCallback,
  OPENROUTER_API_BASE_URL,
  OPENROUTER_MODEL_PRESETS,
  startOpenRouterOAuth,
} from '@/features/ask-ai/ask-ai-oauth';

import '@/features/ask-ai/ask-ai.css';

const PROVIDER_OPTIONS: readonly { readonly value: AskAiProvider; readonly label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'openai', label: 'Бесплатно / OpenAI' },
  { value: 'yandex', label: 'Яндекс' },
];

/** Settings → Функции ИИ: guided OpenAI / OpenRouter OAuth / Yandex excerpt assistant. */
export function AskAiSettings(): JSX.Element {
  const initial = loadAskAiConfig();
  const [provider, setProvider] = createSignal<AskAiProvider>(initial.provider);
  const [apiKey, setApiKey] = createSignal(initial.apiKey);
  const [model, setModel] = createSignal(initial.model);
  const [baseUrl, setBaseUrl] = createSignal(initial.baseUrl);
  const [yandexFolderId, setYandexFolderId] = createSignal(initial.yandexFolderId);
  const [testing, setTesting] = createSignal(false);
  const [oauthBusy, setOauthBusy] = createSignal(false);
  const [showAdvanced, setShowAdvanced] = createSignal(false);

  const currentConfig = () => ({
    provider: provider(),
    apiKey: apiKey(),
    model: model(),
    baseUrl: baseUrl(),
    yandexFolderId: yandexFolderId(),
  });

  const persist = (nextProvider = provider()): void => {
    saveAskAiConfig({
      ...currentConfig(),
      provider: nextProvider,
    });
  };

  const switchProvider = (next: AskAiProvider): void => {
    setProvider(next);
    if (next === 'openai' && (!model() || model() === DEFAULT_YANDEX_MODEL)) {
      setModel(DEFAULT_OPENAI_MODEL);
    } else if (next === 'yandex' && (!model() || model() === DEFAULT_OPENAI_MODEL)) {
      setModel(DEFAULT_YANDEX_MODEL);
    }
    persist(next);
  };

  onMount(() => {
    void (async () => {
      const outcome = await consumeOpenRouterOAuthCallback();
      if (!outcome) return;
      if (outcome.ok) {
        setProvider(outcome.value.provider);
        setApiKey(outcome.value.apiKey);
        setModel(outcome.value.model);
        setBaseUrl(outcome.value.baseUrl);
        setYandexFolderId(outcome.value.yandexFolderId);
        toast.success('OpenRouter подключён — кнопка «Спросить ИИ» готова к работе.');
      } else {
        toast.error(outcome.error);
      }
    })();
  });

  const pasteInto = async (setter: (value: string) => void): Promise<void> => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast('Буфер обмена пуст.');
        return;
      }
      setter(text);
      persist();
      toast.success('Вставлено из буфера.');
    } catch {
      toast.error('Не удалось прочитать буфер обмена — вставьте значение вручную.');
    }
  };

  const runConnectionTest = async (): Promise<void> => {
    persist();
    setTesting(true);
    try {
      const result = await testAskAiConnection(currentConfig());
      if (result.ok) {
        toast.success(`Подключение работает (${result.value.model}).`);
      } else {
        toast.error(askAiFailureMessage(result.error));
      }
    } finally {
      setTesting(false);
    }
  };

  const beginOpenRouterLogin = async (): Promise<void> => {
    setOauthBusy(true);
    try {
      await startOpenRouterOAuth();
    } catch {
      setOauthBusy(false);
      toast.error('Не удалось открыть страницу входа OpenRouter.');
    }
  };

  const isConnected = () => isAskAiAvailable(currentConfig(), true);
  const isOpenRouter = () => provider() === 'openai' && baseUrl() === OPENROUTER_API_BASE_URL;

  return (
    <section
      class="settings-section paper-sheet ask-ai-settings"
      aria-label="Спросить ИИ по выделению"
    >
      <div class="ask-ai-settings__head">
        <div class="ask-ai-settings__title-row">
          <span class="settings-row__label settings-row__label--with-icon">
            <AppGlyph name="chat" class="settings-row__label-icon" aria-hidden="true" />
            Спросить ИИ по выделенному тексту
          </span>
          <Show when={isConnected()}>
            <span class="ask-ai-settings__status-badge">
              {isOpenRouter()
                ? 'OpenRouter подключён'
                : provider() === 'yandex'
                  ? 'Яндекс подключён'
                  : 'OpenAI подключён'}
            </span>
          </Show>
        </div>
        <p class="settings-row__helper">
          Отправляет только выделенный фрагмент и название документа по вашему нажатию. Без сети
          кнопка скрыта; ключ хранится только на этом устройстве.
        </p>
      </div>

      <SegmentedControl
        class="ask-ai-settings__provider"
        label="Провайдер ИИ"
        stretch
        options={PROVIDER_OPTIONS}
        value={provider()}
        onChange={switchProvider}
      />

      <Show when={provider() === 'openai'}>
        <div class="ask-ai-settings__guide">
          <button
            type="button"
            class="ask-ai-settings__oauth-btn"
            disabled={oauthBusy()}
            onClick={() => void beginOpenRouterLogin()}
          >
            <AppGlyph name="chat" class="ask-ai-settings__oauth-icon" aria-hidden="true" />
            <span>
              {oauthBusy() ? 'Переходим к входу…' : 'Войти в 1 клик (бесплатные модели OpenRouter)'}
            </span>
          </button>
          <Show when={isOpenRouter()}>
            <fieldset class="ask-ai-settings__presets">
              <legend class="visually-hidden">Выбор модели OpenRouter</legend>
              <For each={OPENROUTER_MODEL_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="ask-ai-settings__preset"
                    classList={{ 'ask-ai-settings__preset--active': model() === preset.id }}
                    onClick={() => {
                      setModel(preset.id);
                      persist();
                    }}
                  >
                    {preset.label}
                  </button>
                )}
              </For>
            </fieldset>
          </Show>
          <p class="ask-ai-settings__guide-note">
            Вход через OpenRouter OAuth без карты и копирования ключей — по умолчанию используются
            бесплатные модели (DeepSeek, Qwen, Gemini). Или подключите свой API-ключ:
          </p>
          <ol class="ask-ai-settings__steps">
            <li class="ask-ai-settings__step">
              Откройте{' '}
              <a
                class="ask-ai-settings__link"
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                страницу ключей OpenAI
              </a>{' '}
              и нажмите «Create new secret key».
            </li>
            <li class="ask-ai-settings__step">
              Скопируйте ключ (<code>sk-…</code>) и вставьте его в поле ниже.
            </li>
          </ol>
        </div>
      </Show>

      <Show when={provider() === 'yandex'}>
        <div class="ask-ai-settings__guide">
          <ol class="ask-ai-settings__steps">
            <li class="ask-ai-settings__step">
              Войдите в{' '}
              <a
                class="ask-ai-settings__link"
                href="https://console.yandex.cloud/"
                target="_blank"
                rel="noopener noreferrer"
              >
                консоль Yandex Cloud
              </a>{' '}
              и скопируйте идентификатор каталога (Folder ID, начинается с <code>b1g…</code>).
            </li>
            <li class="ask-ai-settings__step">
              Создайте{' '}
              <a
                class="ask-ai-settings__link"
                href="https://yandex.cloud/ru/docs/iam/operations/api-key/create"
                target="_blank"
                rel="noopener noreferrer"
              >
                API-ключ сервисного аккаунта
              </a>{' '}
              (<code>AQVN…</code>) с ролью <code>ai.languageModels.user</code> или вставьте
              IAM-токен (<code>t1.…</code>).
            </li>
          </ol>
        </div>
      </Show>

      <Show when={provider() !== 'off'}>
        <div class="ask-ai-settings__fields">
          <label class="ask-ai-settings__field">
            <span class="ask-ai-settings__label">
              {provider() === 'yandex' ? 'API-ключ или IAM-токен Яндекса' : 'API-ключ'}
            </span>
            <div class="ask-ai-settings__input-row">
              <input
                type="password"
                autocomplete="off"
                class="ask-ai-settings__input"
                placeholder={provider() === 'yandex' ? 'AQVN… или t1.…' : 'sk-…'}
                value={apiKey()}
                onInput={(event) => setApiKey(event.currentTarget.value)}
                onBlur={() => persist()}
              />
              <button
                type="button"
                class="ask-ai-settings__paste-btn"
                onClick={() => void pasteInto(setApiKey)}
              >
                Вставить
              </button>
            </div>
          </label>

          <Show when={provider() === 'yandex'}>
            <label class="ask-ai-settings__field">
              <span class="ask-ai-settings__label">Идентификатор каталога (Folder ID)</span>
              <div class="ask-ai-settings__input-row">
                <input
                  type="text"
                  autocomplete="off"
                  class="ask-ai-settings__input"
                  placeholder="b1g…"
                  value={yandexFolderId()}
                  onInput={(event) => setYandexFolderId(event.currentTarget.value)}
                  onBlur={() => persist()}
                />
                <button
                  type="button"
                  class="ask-ai-settings__paste-btn"
                  onClick={() => void pasteInto(setYandexFolderId)}
                >
                  Вставить
                </button>
              </div>
            </label>
          </Show>

          <button
            type="button"
            class="ask-ai-settings__advanced-toggle"
            aria-expanded={showAdvanced()}
            onClick={() => setShowAdvanced((open) => !open)}
          >
            {showAdvanced() ? 'Скрыть модель и адрес API' : 'Модель и адрес API'}
          </button>

          <Show when={showAdvanced()}>
            <label class="ask-ai-settings__field">
              <span class="ask-ai-settings__label">Модель</span>
              <input
                type="text"
                class="ask-ai-settings__input"
                placeholder={provider() === 'yandex' ? DEFAULT_YANDEX_MODEL : DEFAULT_OPENAI_MODEL}
                value={model()}
                onInput={(event) => setModel(event.currentTarget.value)}
                onBlur={() => persist()}
              />
            </label>

            <Show when={provider() === 'openai'}>
              <label class="ask-ai-settings__field">
                <span class="ask-ai-settings__label">Адрес API (OpenAI-совместимый)</span>
                <input
                  type="url"
                  class="ask-ai-settings__input"
                  placeholder={DEFAULT_OPENAI_BASE_URL}
                  value={baseUrl()}
                  onInput={(event) => setBaseUrl(event.currentTarget.value)}
                  onBlur={() => persist()}
                />
              </label>
            </Show>
          </Show>

          <div class="ask-ai-settings__actions">
            <button
              type="button"
              class="ask-ai-settings__btn ask-ai-settings__btn--primary"
              disabled={testing() || !isConnected()}
              onClick={() => void runConnectionTest()}
            >
              {testing() ? 'Проверяем…' : 'Проверить подключение'}
            </button>
            <button
              type="button"
              class="ask-ai-settings__btn"
              onClick={() => {
                persist();
                toast.success('Настройки «Спросить ИИ» сохранены.');
              }}
            >
              Сохранить
            </button>
            <button
              type="button"
              class="ask-ai-settings__btn"
              onClick={() => {
                clearAskAiConfig();
                setProvider('off');
                setApiKey('');
                setYandexFolderId('');
                setModel(DEFAULT_OPENAI_MODEL);
                setBaseUrl(DEFAULT_OPENAI_BASE_URL);
                toast('Ключ удалён с устройства.');
              }}
            >
              Сбросить
            </button>
          </div>
        </div>
      </Show>
    </section>
  );
}
