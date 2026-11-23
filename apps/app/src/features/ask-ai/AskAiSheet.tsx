import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  type AskAiAnswer,
  askAiAboutExcerpt,
  askAiFailureMessage,
  buildAskAiUserPrompt,
} from '@/features/ask-ai/ask-ai-client';
import { isAskAiAvailable, loadAskAiConfig } from '@/features/ask-ai/ask-ai-config';
import {
  buildExternalChatHandoff,
  type ExternalAiChatTarget,
} from '@/features/ask-ai/ask-ai-oauth';
import { askAiSelection, closeAskAiSheet } from '@/features/ask-ai/ask-ai-state';
import { visitRoute } from '@/state/app-back';

import '@/features/ask-ai/ask-ai.css';

const QUICK_QUESTIONS = [
  'Кратко объяснить клинический смысл',
  'Риски и взаимодействия',
  'На что обратить внимание при назначении',
] as const;

const EXTERNAL_TARGETS: readonly {
  readonly target: ExternalAiChatTarget;
  readonly label: string;
}[] = [
  { target: 'chatgpt', label: 'ChatGPT' },
  { target: 'perplexity', label: 'Perplexity' },
  { target: 'deepseek', label: 'DeepSeek' },
  { target: 'yandex', label: 'Алиса' },
];

export function AskAiSheetHost(): JSX.Element {
  const [question, setQuestion] = createSignal<string>(QUICK_QUESTIONS[0]);
  const [includeFileContext, setIncludeFileContext] = createSignal(true);
  const [pending, setPending] = createSignal(false);
  const [answer, setAnswer] = createSignal<AskAiAnswer | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let controller: AbortController | undefined;

  createEffect(() => {
    const selection = askAiSelection();
    controller?.abort();
    controller = undefined;
    setPending(false);
    setAnswer(null);
    setError(null);
    if (selection) {
      setQuestion(QUICK_QUESTIONS[0]);
      setIncludeFileContext(Boolean(selection.contextBlocks?.length));
    }
  });

  onCleanup(() => controller?.abort());

  const hasInlineApi = (): boolean => isAskAiAvailable(loadAskAiConfig(), true);

  const attachedContextBlocks = () => {
    const selection = askAiSelection();
    if (!selection || !includeFileContext()) return undefined;
    return selection.contextBlocks;
  };

  const submit = async (customQuestion?: string): Promise<void> => {
    const selection = askAiSelection();
    if (!selection) return;
    const text = (customQuestion ?? question()).trim();
    if (!text) return;
    controller?.abort();
    controller = new AbortController();
    setPending(true);
    setError(null);
    setAnswer(null);
    const result = await askAiAboutExcerpt(
      {
        excerpt: selection.excerpt,
        documentTitle: selection.documentTitle,
        sectionTitle: selection.sectionTitle,
        contextBlocks: attachedContextBlocks(),
        question: text,
      },
      loadAskAiConfig(),
      globalThis.fetch,
      controller.signal,
    );
    setPending(false);
    if (!result.ok) {
      setError(askAiFailureMessage(result.error));
      return;
    }
    setAnswer(result.value);
  };

  const openExternal = (target: ExternalAiChatTarget): void => {
    const selection = askAiSelection();
    if (!selection) return;
    const prompt = buildAskAiUserPrompt({
      excerpt: selection.excerpt,
      documentTitle: selection.documentTitle,
      sectionTitle: selection.sectionTitle,
      contextBlocks: attachedContextBlocks(),
      question: question().trim() || QUICK_QUESTIONS[0],
    });
    const handoff = buildExternalChatHandoff(target, prompt);
    if (!handoff.prefillsPrompt) {
      void navigator.clipboard
        ?.writeText(prompt)
        .then(() => toast.success(`Запрос скопирован — вставьте его в ${handoff.label}.`))
        .catch(() => undefined);
    }
    window.open(handoff.url, '_blank', 'noopener,noreferrer');
  };

  const copyAnswer = (): void => {
    const value = answer()?.text;
    if (!value) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success('Ответ скопирован.'))
      .catch(() => toast.error('Не удалось скопировать ответ.'));
  };

  return (
    <OverlayDialog
      open={askAiSelection() !== null}
      title="Спросить ИИ по фрагменту"
      onClose={() => {
        controller?.abort();
        closeAskAiSheet();
      }}
    >
      <Show when={askAiSelection()}>
        {(selection) => (
          <div class="ask-ai-sheet">
            <blockquote class="ask-ai-sheet__excerpt">
              <Show when={selection().documentTitle || selection().sectionTitle}>
                <span class="ask-ai-sheet__source">
                  {[selection().documentTitle, selection().sectionTitle]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Show>
              <span class="ask-ai-sheet__quote">{selection().excerpt}</span>
            </blockquote>

            <Show when={selection().contextBlocks?.length}>
              <label class="ask-ai-sheet__context-toggle">
                <input
                  type="checkbox"
                  class="ask-ai-sheet__context-checkbox"
                  checked={includeFileContext()}
                  onChange={(event) => setIncludeFileContext(event.currentTarget.checked)}
                />
                <span class="ask-ai-sheet__context-label">
                  Передать контекст открытого раздела (
                  {selection().contextBlocks?.[0]?.text.length ?? 0} симв.)
                </span>
              </label>
            </Show>

            <fieldset class="ask-ai-sheet__chips" aria-label="Быстрые вопросы">
              <For each={QUICK_QUESTIONS}>
                {(prompt) => (
                  <button
                    type="button"
                    class="ask-ai-sheet__chip"
                    classList={{ 'ask-ai-sheet__chip--active': question() === prompt }}
                    disabled={pending()}
                    onClick={() => {
                      setQuestion(prompt);
                      if (hasInlineApi()) void submit(prompt);
                    }}
                  >
                    {prompt}
                  </button>
                )}
              </For>
            </fieldset>

            <form
              class="ask-ai-sheet__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (hasInlineApi()) void submit();
                else openExternal('chatgpt');
              }}
            >
              <input
                type="text"
                class="ask-ai-sheet__input"
                placeholder="Задайте вопрос по выделенному фрагменту"
                value={question()}
                onInput={(event) => setQuestion(event.currentTarget.value)}
              />
              <Show when={hasInlineApi()}>
                <button
                  type="submit"
                  class="ask-ai-sheet__submit"
                  disabled={pending() || !question().trim()}
                >
                  <Show when={pending()} fallback="Отправить">
                    Думает…
                  </Show>
                </button>
              </Show>
            </form>

            <Show when={error()}>
              {(message) => (
                <p class="ask-ai-sheet__error" role="alert">
                  {message()}
                </p>
              )}
            </Show>

            <Show when={answer()}>
              {(result) => (
                <section class="ask-ai-sheet__answer" aria-label="Ответ ИИ">
                  <div class="ask-ai-sheet__answer-header">
                    <span class="ask-ai-sheet__answer-meta">
                      {result().provider === 'yandex' ? 'Яндекс' : 'OpenAI'} · {result().model}
                    </span>
                    <button
                      type="button"
                      class="ask-ai-sheet__copy"
                      aria-label="Скопировать ответ"
                      onClick={copyAnswer}
                    >
                      <AppGlyph name="copy" class="ask-ai-sheet__copy-icon" />
                    </button>
                  </div>
                  <p class="ask-ai-sheet__answer-body">{result().text}</p>
                </section>
              )}
            </Show>

            <div class="ask-ai-sheet__handoff">
              <span class="ask-ai-sheet__handoff-label">
                {hasInlineApi() ? 'Или открыть в приложении / браузере' : 'Открыть в вашем ИИ'}
              </span>
              <div class="ask-ai-sheet__handoff-row">
                <For each={EXTERNAL_TARGETS}>
                  {(item) => (
                    <button
                      type="button"
                      class="ask-ai-sheet__handoff-btn"
                      onClick={() => openExternal(item.target)}
                    >
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
              <Show when={!hasInlineApi()}>
                <button
                  type="button"
                  class="ask-ai-sheet__setup-link"
                  onClick={() => {
                    closeAskAiSheet();
                    visitRoute('#/settings/ai');
                  }}
                >
                  Подключить бесплатные ответы прямо в MiniMed (вход в 1 клик) →
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
