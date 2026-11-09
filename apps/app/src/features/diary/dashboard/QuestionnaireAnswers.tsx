import { createSignal, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { QuestionnaireAnswer } from '@/features/diary/dashboard/diary-insights';
import { diaryQuestionnairePrintHtml } from '@/features/diary/diary-questionnaire-print';
import { PrintManager } from '@/features/printing/print-manager';

/**
 * The whole questionnaire as the patient filled it in: each question and the answer chosen. A
 * button under the result opens it as a sheet of its own (owner 2026-11-04: inline it was too
 * narrow to read).
 */
export function QuestionnaireAnswers(props: {
  readonly answers: readonly QuestionnaireAnswer[];
  /** The questionnaire's name: the sheet's title. */
  readonly title: string;
  /** «10 из 27 · Умеренная»: the result, so the sheet does not repeat the date beside it. */
  readonly result?: string;
  /** When the answers were given (ISO), for the printed copy. */
  readonly at?: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const answered = (): number => props.answers.filter((one) => one.answer !== undefined).length;
  return (
    <Show when={props.answers.length}>
      <Button
        variant="secondary"
        class="diary-answers__open"
        icon={<AppGlyph name="list-numbers" class="diary-dash__glyph" />}
        onClick={() => setOpen(true)}
      >
        Все ответы ({answered()} из {props.answers.length})
      </Button>
      <Show when={open()}>
        <OverlayDialog
          open
          title={props.title}
          {...(props.result ? { subtitle: props.result } : {})}
          class="diary-dash-dialog diary-answers"
          onClose={() => setOpen(false)}
        >
          <ol class="diary-answers__list">
            <For each={props.answers}>
              {(line) => (
                <li class="diary-answers__item">
                  <span class="diary-answers__prompt">{line.prompt}</span>
                  <span
                    class="diary-answers__answer"
                    classList={{ 'diary-answers__answer--none': line.answer === undefined }}
                  >
                    {line.answer ?? 'нет ответа'}
                    <Show when={line.points !== undefined}>
                      <span class="diary-answers__points">{line.points}</span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ol>
          <Button
            variant="secondary"
            class="diary-answers__print"
            icon={<AppGlyph name="printer" class="diary-dash__glyph" />}
            onClick={() => {
              const html = diaryQuestionnairePrintHtml({
                title: props.title,
                at: props.at,
                result: props.result,
                questions: props.answers.map((line) => ({
                  prompt: line.prompt,
                  options: [],
                  answer: line.answer ?? 'нет ответа',
                })),
              });
              if (!PrintManager.html(html, props.title)) {
                toast.error('Браузер не открыл окно печати. Разрешите всплывающие окна.');
              }
            }}
          >
            Печать
          </Button>
        </OverlayDialog>
      </Show>
    </Show>
  );
}
