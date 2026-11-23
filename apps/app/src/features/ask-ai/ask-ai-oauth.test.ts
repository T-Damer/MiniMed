import { describe, expect, it } from 'vitest';

import {
  buildExternalChatHandoff,
  buildOpenRouterAuthUrl,
  createPkcePair,
  extractOAuthCode,
  OPENROUTER_DEFAULT_MODEL,
} from '@/features/ask-ai/ask-ai-oauth';

describe('ask-ai OAuth PKCE & external handoff helpers', () => {
  it('defaults OpenRouter OAuth to the free auto-router model', () => {
    expect(OPENROUTER_DEFAULT_MODEL).toBe('openrouter/free');
  });

  it('generates a valid PKCE verifier and SHA-256 base64url challenge', async () => {
    const pair = await createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge.length).toBeGreaterThanOrEqual(43);
    expect(pair.verifier).not.toBe(pair.challenge);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('builds the OpenRouter PKCE authorize URL with S256 challenge', () => {
    const url = new URL(
      buildOpenRouterAuthUrl('https://minimed.example/#/settings/ai', 'abc_challenge-123'),
    );
    expect(url.origin).toBe('https://openrouter.ai');
    expect(url.pathname).toBe('/auth');
    expect(url.searchParams.get('callback_url')).toBe('https://minimed.example/#/settings/ai');
    expect(url.searchParams.get('code_challenge')).toBe('abc_challenge-123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('extracts OAuth authorization code from search or hash query string', () => {
    expect(extractOAuthCode('?code=xyz123', '#/settings/ai')).toBe('xyz123');
    expect(extractOAuthCode('', '#/settings/ai?code=hash456')).toBe('hash456');
    expect(extractOAuthCode('', '#/settings/ai')).toBeNull();
  });

  it('builds prefilled ChatGPT/Perplexity URLs and clipboard handoff URLs for DeepSeek/Yandex', () => {
    const chatgpt = buildExternalChatHandoff('chatgpt', 'Рисперидон: период полувыведения?');
    expect(chatgpt.prefillsPrompt).toBe(true);
    expect(chatgpt.url).toContain('https://chatgpt.com/?q=');
    expect(decodeURIComponent(chatgpt.url)).toContain('Рисперидон');

    const perplexity = buildExternalChatHandoff('perplexity', 'Амоксициллин');
    expect(perplexity.prefillsPrompt).toBe(true);
    expect(perplexity.url).toContain('https://www.perplexity.ai/search?q=');

    const deepseek = buildExternalChatHandoff('deepseek', 'Текст');
    expect(deepseek.prefillsPrompt).toBe(false);
    expect(deepseek.url).toBe('https://chat.deepseek.com/');

    const alice = buildExternalChatHandoff('yandex', 'Текст');
    expect(alice.prefillsPrompt).toBe(false);
    expect(alice.url).toBe('https://alice.yandex.ru/');
  });
});
