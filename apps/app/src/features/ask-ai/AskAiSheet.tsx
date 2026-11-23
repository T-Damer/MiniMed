import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  type AskAiAnswer,
  askAiAboutExcerpt,
  askAiFailureMessage,
} from '@/features/ask-ai/ask-ai-client';
import { loadAskAiConfig } from '@/features/ask-ai/ask-ai-config';
import { askAiSelection, closeAskAiSheet } from '@/features/ask-ai/ask-ai-state';

import '@/features/ask-ai/ask-ai.css';

const QUICK_QUESTIONS = [
  'Кратко объяснить клинический смысл',
  'Риски и взаимодействия',
  'На что обратить внимание при назначении',
] as const;

export function AskAiSheetHost(): JSX.Element {
  const [question, setQuestion] = createSignal<string>(QUICK_QUESTIONS[0]);
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
    if (selection) setQuestion(QUICK_QUESTIONS[0]);
  });

  onCleanup(() => controller?.abort());

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
              <Show when={selection().documentTitle}>
                {(title) => <span class="ask-ai-sheet__source">{title()}</span>}
              </Show>
              <span class="ask-ai-sheet__quote">{selection().excerpt}</span>
            </blockquote>

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
                      void submit(prompt);
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
                void submit();
              }}
            >
              <input
                type="text"
                class="ask-ai-sheet__input"
                placeholder="Задайте вопрос по выделенному фрагменту"
                value={question()}
                onInput={(event) => setQuestion(event.currentTarget.value)}
              />
              <button
                type="submit"
                class="ask-ai-sheet__submit"
                disabled={pending() || !question().trim()}
              >
                <Show when={pending()} fallback="Отправить">
                  Думает…
                </Show>
              </button>
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
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
