import { describe, expect, it, vi } from 'vitest';

import { askAiAboutExcerpt } from '@/features/ask-ai/ask-ai-client';
import {
  type AskAiConfig,
  DEFAULT_ASK_AI_CONFIG,
  isAskAiAvailable,
} from '@/features/ask-ai/ask-ai-config';

describe('ask-ai client', () => {
  it('is unavailable when offline or unconfigured', () => {
    expect(isAskAiAvailable(DEFAULT_ASK_AI_CONFIG, true)).toBe(false);
    const openAi: AskAiConfig = {
      ...DEFAULT_ASK_AI_CONFIG,
      provider: 'openai',
      apiKey: 'sk-test-key',
    };
    expect(isAskAiAvailable(openAi, false)).toBe(false);
    expect(isAskAiAvailable(openAi, true)).toBe(true);
  });

  it('sends only the selected excerpt and titles to an OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Краткий разбор фрагмента.' } }] }),
    })) as unknown as typeof fetch;

    const config: AskAiConfig = {
      ...DEFAULT_ASK_AI_CONFIG,
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    };
    const result = await askAiAboutExcerpt(
      {
        excerpt: 'Начальная доза 2 мг/сут.',
        documentTitle: 'Рисперидон',
        sectionTitle: 'Способ применения',
        question: 'Кратко объяснить',
      },
      config,
      fetchMock,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('Краткий разбор фрагмента.');
      expect(result.value.provider).toBe('openai');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 401 responses to typed unauthorized failures', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
    })) as unknown as typeof fetch;
    const config: AskAiConfig = {
      ...DEFAULT_ASK_AI_CONFIG,
      provider: 'yandex',
      apiKey: 'ya-key',
      yandexFolderId: 'b1g-folder',
      model: 'yandexgpt-lite/latest',
    };
    const result = await askAiAboutExcerpt(
      { excerpt: 'Фрагмент', question: 'Поясни' },
      config,
      fetchMock,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unauthorized');
    }
  });
});
