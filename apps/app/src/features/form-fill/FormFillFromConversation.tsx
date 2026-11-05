import type { FormFillDecision, FormFillResult, FormFillReview } from '@localmed/contracts';
import {
  acceptedFormFillValues,
  decideFormFillValue,
  emptyFormFillReview,
  type FormFillBinding,
  type FormFillToolValue,
  fillFormWithCues,
  formFillReviewItems,
} from '@localmed/core/form-fill';
import { createSignal, For, type JSX, Match, onMount, Show, Switch } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { TextArea } from '@/components/TextArea';
import {
  conversationTitle,
  loadConversationLines,
} from '@/features/conversations/conversation-session';
import { pluralRu } from '@/features/news/news-state';
import { pastedTranscriptLines } from '@/features/psy-status/psy-status-session';
import {
  type ConversationRecording,
  listConversationRecordings,
} from '@/state/conversation-recordings';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';
import { FormFillReviewList } from './FormFillReviewList';
import { takeHandedConversation } from './form-fill-handoff';

import './form-fill-review.css';

type Step = 'source' | 'paste' | 'review';

interface Source {
  readonly label: string;
  readonly lines: readonly string[];
}

/**
 * «Заполнить по беседе» on a form or calculator (FORMFILL1): the doctor picks a conversation
 * recording (or pastes its text), the values it gives are listed with the words they rest on, and
 * only the accepted ones are put into the form. The word cues declared for the form propose the
 * values; no screen loads a local model yet. Patient words stay in memory while the sheet is open.
 * A recording's dialog can hand its transcript over (`form-fill-handoff.ts`): the sheet then opens
 * on the values as soon as the form is on screen.
 */
export function FormFillFromConversation(props: {
  readonly binding: FormFillBinding;
  readonly onApply: (values: ReadonlyMap<string, FormFillToolValue>) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [step, setStep] = createSignal<Step>('source');
  const [recordings, setRecordings] = createSignal<readonly ConversationRecording[]>([]);
  const [source, setSource] = createSignal<Source>();
  const [result, setResult] = createSignal<FormFillResult>();
  const [review, setReview] = createSignal<FormFillReview>({ formId: '', decisions: {} });
  const [pasted, setPasted] = createSignal('');
  const [message, setMessage] = createSignal('');

  const start = (): void => {
    setStep('source');
    setMessage('');
    setOpen(true);
    void listConversationRecordings()
      .then((items) => setRecordings(items.filter((item) => item.status !== 'recording')))
      .catch(() => setRecordings([]));
  };
  const close = (): void => {
    setOpen(false);
    setSource(undefined);
    setResult(undefined);
    setPasted('');
  };
  const fill = (next: Source): void => {
    const filled = fillFormWithCues(props.binding.form, next.lines);
    setSource(next);
    setResult(filled);
    setReview(emptyFormFillReview(filled));
    setStep('review');
  };
  // A recording handed over from its «Запись сохранена» dialog opens straight on the values.
  onMount(() => {
    const handed = takeHandedConversation(props.binding.form.id);
    if (!handed) return;
    fill({ label: handed.label, lines: handed.lines });
    setOpen(true);
  });
  const pickRecording = (recording: ConversationRecording): void => {
    setMessage('');
    void loadConversationLines(recording)
      .then(({ lines, locked }) => {
        if (locked) setMessage('Откройте хранилище пациентов, чтобы прочитать запись.');
        else if (lines.length === 0) setMessage('В этой записи ещё нет текста.');
        else fill({ label: conversationTitle(recording), lines });
      })
      .catch((cause) =>
        setMessage(cause instanceof Error ? cause.message : 'Не удалось открыть запись.'),
      );
  };
  const decide = (fieldId: string, decision: FormFillDecision | null): void => {
    setReview((current) => decideFormFillValue(current, fieldId, decision));
  };
  const proposals = (): number => {
    const current = result();
    return current ? formFillReviewItems(current, review()).length : 0;
  };
  const accepted = (): number => {
    const current = result();
    return current ? acceptedFormFillValues(current, review()).size : 0;
  };
  const acceptAll = (): void => {
    const current = result();
    if (!current) return;
    let next = review();
    for (const item of formFillReviewItems(current, next)) {
      if (item.decision === null) next = decideFormFillValue(next, item.fieldId, 'accepted');
    }
    setReview(next);
  };
  const apply = (): void => {
    const current = result();
    if (!current) return;
    const values = new Map<string, FormFillToolValue>();
    for (const [fieldId, value] of acceptedFormFillValues(current, review())) {
      const own = props.binding.toSourceValue(fieldId, value);
      if (own !== undefined) values.set(fieldId, own);
    }
    props.onApply(values);
    playFeedback(...FEEDBACK_MOMENTS.saved);
    toast.success(
      `Подставлено ${values.size} ${pluralRu(values.size, 'значение', 'значения', 'значений')}`,
    );
    close();
  };

  return (
    <>
      <div class="form-fill-entry">
        <span class="form-fill-entry__badge">
          <AppGlyph name="microphone" class="form-fill-entry__glyph" />
        </span>
        <span class="form-fill-entry__text">
          <span class="form-fill-entry__title">Беседа</span>
          <span class="form-fill-entry__hint">Подставить значения из записи</span>
        </span>
        <Button
          variant="icon"
          class="form-fill-entry__open"
          aria-label="Заполнить по беседе"
          icon={<AppGlyph name="chat" />}
          onClick={start}
        />
      </div>

      <OverlayDialog open={open()} title="Заполнить по беседе" onClose={close}>
        <div class="form-fill-sheet">
          <Switch>
            <Match when={step() === 'source'}>
              <Show
                when={recordings().length > 0}
                fallback={
                  <p class="form-fill-sheet__muted">На этом устройстве нет записей бесед.</p>
                }
              >
                <ul class="form-fill-sheet__recordings">
                  <For each={recordings()}>
                    {(recording) => (
                      <li class="form-fill-sheet__recording-item">
                        <button
                          type="button"
                          class="form-fill-sheet__recording"
                          onClick={() => pickRecording(recording)}
                        >
                          <span class="form-fill-sheet__recording-name">
                            {conversationTitle(recording)}
                          </span>
                          <span class="form-fill-sheet__muted">
                            {new Date(recording.startedAt).toLocaleString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={message()}>
                <p class="form-fill-sheet__muted" role="status">
                  {message()}
                </p>
              </Show>
              <Button variant="quiet" onClick={() => setStep('paste')}>
                Вставить текст
              </Button>
            </Match>
            <Match when={step() === 'paste'}>
              <form
                class="form-fill-sheet__paste"
                onSubmit={(event) => {
                  event.preventDefault();
                  const lines = pastedTranscriptLines(pasted());
                  if (lines.length > 0) fill({ label: 'Вставленный текст', lines });
                }}
              >
                <TextArea
                  label="Текст беседы"
                  hideLabel
                  placeholder="Вставьте расшифровку: каждая реплика с новой строки"
                  rows={10}
                  value={pasted()}
                  onInput={(event) => setPasted(event.currentTarget.value)}
                />
                <Button type="submit" variant="primary" disabled={!pasted().trim()}>
                  Разобрать
                </Button>
              </form>
            </Match>
            <Match when={step() === 'review' && result()}>
              {(filled) => (
                <>
                  <p class="form-fill-sheet__source">
                    <AppGlyph name="microphone" class="form-fill-sheet__source-glyph" />
                    {source()?.label}
                  </p>
                  <Show
                    when={proposals() > 0}
                    fallback={
                      <p class="form-fill-sheet__muted">
                        В беседе не нашлось значений для этой формы.
                      </p>
                    }
                  >
                    <FormFillReviewList
                      form={props.binding.form}
                      result={filled()}
                      review={review()}
                      onDecide={decide}
                    />
                    <div class="form-fill-sheet__actions">
                      <Button variant="quiet" onClick={acceptAll}>
                        Принять все
                      </Button>
                      <Button variant="primary" disabled={accepted() === 0} onClick={apply}>
                        Подставить
                      </Button>
                    </div>
                  </Show>
                </>
              )}
            </Match>
          </Switch>
        </div>
      </OverlayDialog>
    </>
  );
}
