import { createSignal, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  type AskAiProvider,
  clearAskAiConfig,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_YANDEX_MODEL,
  loadAskAiConfig,
  saveAskAiConfig,
} from '@/features/ask-ai/ask-ai-config';

import '@/features/ask-ai/ask-ai.css';

const PROVIDER_OPTIONS: readonly { readonly value: AskAiProvider; readonly label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'yandex', label: 'Яндекс' },
];

/** Settings → Функции ИИ: opt-in OpenAI / Yandex excerpt assistant (hidden offline). */
export function AskAiSettings(): JSX.Element {
  const initial = loadAskAiConfig();
  const [provider, setProvider] = createSignal<AskAiProvider>(initial.provider);
  const [apiKey, setApiKey] = createSignal(initial.apiKey);
  const [model, setModel] = createSignal(initial.model);
  const [baseUrl, setBaseUrl] = createSignal(initial.baseUrl);
  const [yandexFolderId, setYandexFolderId] = createSignal(initial.yandexFolderId);

  const persist = (nextProvider = provider()): void => {
    saveAskAiConfig({
      provider: nextProvider,
      apiKey: apiKey(),
      model: model(),
      baseUrl: baseUrl(),
      yandexFolderId: yandexFolderId(),
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

  return (
    <section
      class="settings-section paper-sheet ask-ai-settings"
      aria-label="Спросить ИИ по выделению"
    >
      <div class="ask-ai-settings__head">
        <span class="settings-row__label settings-row__label--with-icon">
          <AppGlyph name="chat" class="settings-row__label-icon" aria-hidden="true" />
          Спросить ИИ по выделенному тексту
        </span>
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

      <Show when={provider() !== 'off'}>
        <div class="ask-ai-settings__fields">
          <label class="ask-ai-settings__field">
            <span class="ask-ai-settings__label">
              {provider() === 'yandex' ? 'API-ключ или IAM-токен Яндекса' : 'API-ключ OpenAI'}
            </span>
            <input
              type="password"
              autocomplete="off"
              class="ask-ai-settings__input"
              placeholder={provider() === 'yandex' ? 'AQVN…' : 'sk-…'}
              value={apiKey()}
              onInput={(event) => setApiKey(event.currentTarget.value)}
              onBlur={() => persist()}
            />
          </label>

          <Show when={provider() === 'yandex'}>
            <label class="ask-ai-settings__field">
              <span class="ask-ai-settings__label">Идентификатор каталога (Folder ID)</span>
              <input
                type="text"
                autocomplete="off"
                class="ask-ai-settings__input"
                placeholder="b1g…"
                value={yandexFolderId()}
                onInput={(event) => setYandexFolderId(event.currentTarget.value)}
                onBlur={() => persist()}
              />
            </label>
          </Show>

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

          <div class="ask-ai-settings__actions">
            <button
              type="button"
              class="ask-ai-settings__btn ask-ai-settings__btn--primary"
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
