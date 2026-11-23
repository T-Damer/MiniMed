import { err, ok, type Result } from '@localmed/contracts';

import { type AskAiConfig, isAskAiAvailable } from '@/features/ask-ai/ask-ai-config';
import type { AskAiContextBlock } from '@/features/ask-ai/ask-ai-context';

export interface AskAiExcerptRequest {
  /** Verbatim text selected by the user; never the whole document or patient records. */
  readonly excerpt: string;
  readonly documentTitle?: string | undefined;
  readonly sectionTitle?: string | undefined;
  /** Bounded file/section/retrieved context blocks attached explicitly by the user. */
  readonly contextBlocks?: readonly AskAiContextBlock[] | undefined;
  readonly question: string;
}

export interface AskAiAnswer {
  readonly text: string;
  readonly provider: 'openai' | 'yandex';
  readonly model: string;
}

export type AskAiFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'network'; readonly detail?: string }
  | { readonly kind: 'bad-response' };

const SYSTEM_PROMPT =
  'Ты медицинский справочный ассистент для врача (система поддержки решений на основе локальных источников MiniMed). Отвечай кратко, по делу и на русском языке, строго опираясь на переданный фрагмент и приложенный контекст документа/файлов. Ссылайся на документ и раздел при ответе. Не выдумывай отсутствующие в источнике цифры дозировок; если данных в приложенном контексте не хватает, прямо укажи это.';

export function buildAskAiUserPrompt(request: AskAiExcerptRequest): string {
  const contextParts: string[] = [];
  if (request.documentTitle) contextParts.push(`Документ: ${request.documentTitle}`);
  if (request.sectionTitle) contextParts.push(`Раздел: ${request.sectionTitle}`);
  const header = contextParts.length > 0 ? `${contextParts.join('\n')}\n\n` : '';
  const blocks = request.contextBlocks ?? [];
  const contextText =
    blocks.length > 0
      ? `\n\nКонтекст из открытых файлов MiniMed:\n${blocks
          .map((block, index) => {
            const label = [block.title, block.section].filter(Boolean).join(' — ');
            return `[${index + 1}${label ? ` · ${label}` : ''}]\n${block.text}`;
          })
          .join('\n\n')}`
      : '';
  return `${header}Выделенный фрагмент:\n«${request.excerpt.trim()}»${contextText}\n\nВопрос врача: ${request.question.trim()}`;
}

function mapHttpStatus(status: number): AskAiFailure {
  if (status === 401 || status === 403) return { kind: 'unauthorized' };
  if (status === 429) return { kind: 'rate-limited' };
  return { kind: 'network', detail: `HTTP ${status}` };
}

/**
 * Sends ONLY the explicitly selected snippet + document/section title to the clinician's configured
 * OpenAI-compatible or Yandex Foundation Models endpoint. No provider SDKs, no background calls.
 */
export async function askAiAboutExcerpt(
  request: AskAiExcerptRequest,
  config: AskAiConfig,
  fetchFn: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<Result<AskAiAnswer, AskAiFailure>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return err({ kind: 'offline' });
  }
  if (!isAskAiAvailable(config, true)) {
    return err({ kind: 'not-configured' });
  }

  const userPrompt = buildAskAiUserPrompt(request);

  try {
    if (config.provider === 'openai') {
      const response = await fetchFn(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) return err(mapHttpStatus(response.status));
      const payload = (await response.json()) as {
        readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) return err({ kind: 'bad-response' });
      return ok({ text: content.trim(), provider: 'openai', model: config.model });
    }

    if (config.provider === 'yandex') {
      const modelUri = config.model.startsWith('gpt://')
        ? config.model
        : `gpt://${config.yandexFolderId}/${config.model}`;
      const authHeader = config.apiKey.startsWith('t1.')
        ? `Bearer ${config.apiKey}`
        : `Api-Key ${config.apiKey}`;
      const response = await fetchFn(
        'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
            'x-folder-id': config.yandexFolderId,
          },
          body: JSON.stringify({
            modelUri,
            completionOptions: { stream: false, temperature: 0.2, maxTokens: 900 },
            messages: [
              { role: 'system', text: SYSTEM_PROMPT },
              { role: 'user', text: userPrompt },
            ],
          }),
          ...(signal ? { signal } : {}),
        },
      );
      if (!response.ok) return err(mapHttpStatus(response.status));
      const payload = (await response.json()) as {
        readonly result?: {
          readonly alternatives?: readonly { readonly message?: { readonly text?: unknown } }[];
        };
      };
      const text = payload.result?.alternatives?.[0]?.message?.text;
      if (typeof text !== 'string' || !text.trim()) return err({ kind: 'bad-response' });
      return ok({ text: text.trim(), provider: 'yandex', model: config.model });
    }

    return err({ kind: 'not-configured' });
  } catch (cause) {
    return err({
      kind: 'network',
      ...(cause instanceof Error ? { detail: cause.message } : {}),
    });
  }
}

/** Verifies credentials with a minimal 1-word round-trip so the user gets immediate feedback. */
export async function testAskAiConnection(
  config: AskAiConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Result<AskAiAnswer, AskAiFailure>> {
  return askAiAboutExcerpt(
    {
      excerpt: 'Проверка подключения MiniMed.',
      question: 'Ответь одним словом: ОК.',
    },
    config,
    fetchFn,
  );
}

export function askAiFailureMessage(failure: AskAiFailure): string {
  switch (failure.kind) {
    case 'offline':
      return 'Нет подключения к сети. Локальный поиск и тексты работают как обычно.';
    case 'not-configured':
      return 'Подключите OpenAI или Яндекс в Настройках → «Функции ИИ».';
    case 'unauthorized':
      return 'Ключ доступа отклонён провайдером. Проверьте ключ в Настройках → «Функции ИИ».';
    case 'rate-limited':
      return 'Превышен лимит запросов у провайдера. Повторите чуть позже.';
    case 'bad-response':
      return 'Провайдер вернул пустой ответ.';
    case 'network':
      return failure.detail
        ? `Не удалось выполнить запрос (${failure.detail}).`
        : 'Не удалось связаться с сервером провайдера.';
  }
}
