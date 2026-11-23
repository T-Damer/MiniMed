/**
 * Local-only configuration for optional external AI Q&A over selected excerpts (Wave 3.2).
 * Stored exclusively on-device in localStorage; never synced, never logged, disabled by default.
 */

export type AskAiProvider = 'off' | 'openai' | 'yandex';

export interface AskAiConfig {
  readonly provider: AskAiProvider;
  /** User-provided API key or OAuth/IAM bearer token (OpenAI or Yandex). */
  readonly apiKey: string;
  /** Model identifier (e.g. gpt-4o-mini or yandexgpt-lite/latest). */
  readonly model: string;
  /** Optional custom OpenAI-compatible base URL (defaults to https://api.openai.com/v1). */
  readonly baseUrl: string;
  /** Yandex Cloud Folder ID required for Yandex Foundation Models. */
  readonly yandexFolderId: string;
}

export const ASK_AI_CONFIG_KEY = 'minimed.ask-ai-config.v1';
export const ASK_AI_CONFIG_EVENT = 'minimed:ask-ai-config-changed';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
export const DEFAULT_YANDEX_MODEL = 'yandexgpt/latest';

export const DEFAULT_ASK_AI_CONFIG: AskAiConfig = {
  provider: 'off',
  apiKey: '',
  model: DEFAULT_OPENAI_MODEL,
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  yandexFolderId: '',
};

export function loadAskAiConfig(): AskAiConfig {
  try {
    const raw = window.localStorage.getItem(ASK_AI_CONFIG_KEY);
    if (!raw) return DEFAULT_ASK_AI_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AskAiConfig>;
    const provider: AskAiProvider =
      parsed.provider === 'openai' || parsed.provider === 'yandex' ? parsed.provider : 'off';
    return {
      provider,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model:
        typeof parsed.model === 'string' && parsed.model.trim()
          ? parsed.model.trim()
          : provider === 'yandex'
            ? DEFAULT_YANDEX_MODEL
            : DEFAULT_OPENAI_MODEL,
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
          ? parsed.baseUrl.trim().replace(/\/+$/u, '')
          : DEFAULT_OPENAI_BASE_URL,
      yandexFolderId: typeof parsed.yandexFolderId === 'string' ? parsed.yandexFolderId.trim() : '',
    };
  } catch {
    return DEFAULT_ASK_AI_CONFIG;
  }
}

export function saveAskAiConfig(config: AskAiConfig): AskAiConfig {
  const normalized: AskAiConfig = {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    model:
      config.model.trim() ||
      (config.provider === 'yandex' ? DEFAULT_YANDEX_MODEL : DEFAULT_OPENAI_MODEL),
    baseUrl: config.baseUrl.trim().replace(/\/+$/u, '') || DEFAULT_OPENAI_BASE_URL,
    yandexFolderId: config.yandexFolderId.trim(),
  };
  try {
    window.localStorage.setItem(ASK_AI_CONFIG_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage errors.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AskAiConfig>(ASK_AI_CONFIG_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function clearAskAiConfig(): void {
  saveAskAiConfig(DEFAULT_ASK_AI_CONFIG);
}

/** True whenever the device is online: allows zero-setup external AI handoff or inline API. */
export function isAskAiActionVisible(
  online = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
): boolean {
  return online;
}

/** True only when a provider is configured with credentials AND the device is online. */
export function isAskAiAvailable(
  config: AskAiConfig = loadAskAiConfig(),
  online = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
): boolean {
  if (!online || config.provider === 'off' || !config.apiKey.trim()) return false;
  if (config.provider === 'yandex' && !config.yandexFolderId.trim()) return false;
  return true;
}

export function subscribeAskAiConfig(listener: (config: AskAiConfig) => void): () => void {
  const handle = (event: Event): void => {
    const detail = (event as CustomEvent<AskAiConfig>).detail;
    listener(detail ?? loadAskAiConfig());
  };
  window.addEventListener(ASK_AI_CONFIG_EVENT, handle);
  return () => window.removeEventListener(ASK_AI_CONFIG_EVENT, handle);
}
