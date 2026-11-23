import { err, ok, type Result } from '@localmed/contracts';

import { type AskAiConfig, saveAskAiConfig } from '@/features/ask-ai/ask-ai-config';

export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';
/** Official OpenRouter free auto-router: works with zero credit card or balance. */
export const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';

export interface OpenRouterModelPreset {
  readonly id: string;
  readonly label: string;
  readonly free: boolean;
}

export const OPENROUTER_MODEL_PRESETS: readonly OpenRouterModelPreset[] = [
  { id: 'openrouter/free', label: 'Лучшая бесплатная (авто)', free: true },
  { id: 'deepseek/deepseek-r1-0528:free', label: 'DeepSeek R1 (бесплатно)', free: true },
  { id: 'qwen/qwen3-235b-a22b:free', label: 'Qwen 3 235B (бесплатно)', free: true },
  { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek V3 (бесплатно)', free: true },
  { id: 'openai/gpt-4o', label: 'GPT-4o', free: false },
];

export type ExternalAiChatTarget = 'chatgpt' | 'perplexity' | 'deepseek' | 'yandex';

export interface ExternalAiChatHandoff {
  readonly target: ExternalAiChatTarget;
  readonly label: string;
  readonly url: string;
  /** True when the prompt is embedded in the query URL; false when clipboard copy is needed. */
  readonly prefillsPrompt: boolean;
}

export function buildExternalChatHandoff(
  target: ExternalAiChatTarget,
  prompt: string,
): ExternalAiChatHandoff {
  const trimmed = prompt.trim().slice(0, 3500);
  switch (target) {
    case 'chatgpt':
      return {
        target,
        label: 'ChatGPT',
        url: `https://chatgpt.com/?q=${encodeURIComponent(trimmed)}`,
        prefillsPrompt: true,
      };
    case 'perplexity':
      return {
        target,
        label: 'Perplexity',
        url: `https://www.perplexity.ai/search?q=${encodeURIComponent(trimmed)}`,
        prefillsPrompt: true,
      };
    case 'deepseek':
      return {
        target,
        label: 'DeepSeek',
        url: 'https://chat.deepseek.com/',
        prefillsPrompt: false,
      };
    case 'yandex':
      return {
        target,
        label: 'Алиса',
        url: 'https://alice.yandex.ru/',
        prefillsPrompt: false,
      };
  }
}
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const PKCE_VERIFIER_STORAGE_KEY = 'minimed.ask-ai.openrouter.pkce-verifier';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export async function createPkcePair(): Promise<{
  readonly verifier: string;
  readonly challenge: string;
}> {
  const random = new Uint8Array(48);
  crypto.getRandomValues(random);
  const verifier = base64UrlEncode(random);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

export function buildOpenRouterAuthUrl(callbackUrl: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${OPENROUTER_AUTH_URL}?${params.toString()}`;
}

/**
 * Starts a zero-backend OAuth PKCE sign-in with OpenRouter (gives access to OpenAI GPT-4o-mini,
 * Claude, Gemini, etc. without manually creating or pasting API keys).
 */
export async function startOpenRouterOAuth(): Promise<void> {
  const { verifier, challenge } = await createPkcePair();
  window.sessionStorage.setItem(PKCE_VERIFIER_STORAGE_KEY, verifier);
  const cleanUrl = `${window.location.origin}${window.location.pathname}#/settings/ai`;
  window.location.assign(buildOpenRouterAuthUrl(cleanUrl, challenge));
}

export function extractOAuthCode(locationSearch: string, locationHash: string): string | null {
  const searchParams = new URLSearchParams(locationSearch);
  const fromSearch = searchParams.get('code')?.trim();
  if (fromSearch) return fromSearch;
  const hashQueryIndex = locationHash.indexOf('?');
  if (hashQueryIndex >= 0) {
    const hashParams = new URLSearchParams(locationHash.slice(hashQueryIndex + 1));
    const fromHash = hashParams.get('code')?.trim();
    if (fromHash) return fromHash;
  }
  return null;
}

/**
 * Completes an OpenRouter OAuth PKCE redirect when `?code=` is present in the URL.
 * Returns `null` if no OAuth callback is pending.
 */
export async function consumeOpenRouterOAuthCallback(
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Result<AskAiConfig, string> | null> {
  if (typeof window === 'undefined') return null;
  const code = extractOAuthCode(window.location.search, window.location.hash);
  if (!code) return null;
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_STORAGE_KEY);
  if (!verifier) return null;
  window.sessionStorage.removeItem(PKCE_VERIFIER_STORAGE_KEY);

  // Strip the one-time authorization code from the address bar right away.
  const cleanUrl = `${window.location.origin}${window.location.pathname}#/settings/ai`;
  window.history.replaceState(null, '', cleanUrl);

  try {
    const response = await fetchFn(OPENROUTER_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    });
    if (!response.ok) {
      return err(`OpenRouter отклонил вход (HTTP ${response.status}). Попробуйте ещё раз.`);
    }
    const payload = (await response.json()) as { readonly key?: unknown };
    if (typeof payload.key !== 'string' || !payload.key.trim()) {
      return err('OpenRouter не вернул ключ доступа.');
    }
    const saved = saveAskAiConfig({
      provider: 'openai',
      apiKey: payload.key.trim(),
      model: OPENROUTER_DEFAULT_MODEL,
      baseUrl: OPENROUTER_API_BASE_URL,
      yandexFolderId: '',
    });
    return ok(saved);
  } catch (cause) {
    return err(
      cause instanceof Error ? `Не удалось завершить вход: ${cause.message}` : 'Ошибка сети.',
    );
  }
}
