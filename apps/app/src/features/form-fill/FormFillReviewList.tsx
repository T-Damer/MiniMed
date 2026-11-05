import type {
  FormFillDecision,
  FormFillForm,
  FormFillResult,
  FormFillReview,
  FormFillSpeakerRole,
  VisitNoteQuote,
} from '@localmed/contracts';
import { formFillReviewItems, formFillValueLabel } from '@localmed/core/form-fill';
import { createMemo, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { pluralRu } from '@/features/news/news-state';

import './form-fill-review.css';

const ROLE_LABELS: Readonly<Record<FormFillSpeakerRole, string | null>> = {
  clinician: 'врач',
  patient: 'пациент',
  companion: 'сопровождающий',
  unknown: null,
};

/**
 * The values a conversation proposed for a form (FORMFILL1), one row each: the field, the value,
 * the transcript words it rests on and who said them, and «принять» / «отклонить». Nothing reaches
 * the form until accepted; a second tap on the same answer takes it back.
 */
export function FormFillReviewList(props: {
  readonly form: FormFillForm;
  readonly result: FormFillResult;
  readonly review: FormFillReview;
  readonly onDecide: (fieldId: string, decision: FormFillDecision | null) => void;
  readonly onQuote?: (quote: VisitNoteQuote) => void;
}): JSX.Element {
  const fields = createMemo(() => new Map(props.form.fields.map((field) => [field.id, field])));
  const items = createMemo(() => formFillReviewItems(props.result, props.review));
  const pending = () => items().filter((item) => item.decision === null).length;
  const toggle = (fieldId: string, current: FormFillDecision | null, next: FormFillDecision) =>
    props.onDecide(fieldId, current === next ? null : next);
  return (
    <section class="form-fill-review" aria-label="Значения из беседы">
      <Show when={pending() > 0}>
        <p class="form-fill-review__count">
          {pending()} {pluralRu(pending(), 'значение ждёт', 'значения ждут', 'значений ждут')}{' '}
          решения
        </p>
      </Show>
      <ul class="form-fill-review__list">
        <For each={items()}>
          {(item) => {
            const field = () => fields().get(item.fieldId);
            return (
              <li
                class="form-fill-review__item"
                classList={{
                  'form-fill-review__item--accepted': item.decision === 'accepted',
                  'form-fill-review__item--rejected': item.decision === 'rejected',
                }}
              >
                <span class="form-fill-review__label">{field()?.label}</span>
                <span class="form-fill-review__value">
                  {(() => {
                    const own = field();
                    return own ? formFillValueLabel(own, item.proposal.value) : '';
                  })()}
                </span>
                <span class="form-fill-review__quotes">
                  <For each={item.proposal.evidence}>
                    {(evidence) => (
                      <button
                        type="button"
                        class="form-fill-review__quote"
                        aria-label={`Показать в тексте беседы, строка ${evidence.quote.startLine + 1}`}
                        onClick={() => props.onQuote?.(evidence.quote)}
                      >
                        <Show when={ROLE_LABELS[evidence.speaker.role]}>
                          {(role) => <span class="form-fill-review__speaker">{role()}</span>}
                        </Show>
                        «{evidence.quote.text}»
                      </button>
                    )}
                  </For>
                </span>
                <span class="form-fill-review__actions">
                  <Button
                    variant="icon"
                    class="form-fill-review__reject"
                    aria-label="Отклонить"
                    aria-pressed={item.decision === 'rejected'}
                    icon={<AppGlyph name="close" />}
                    onClick={() => toggle(item.fieldId, item.decision, 'rejected')}
                  />
                  <Button
                    variant={item.decision === 'accepted' ? 'primary' : 'icon'}
                    class="form-fill-review__accept"
                    aria-label="Принять"
                    aria-pressed={item.decision === 'accepted'}
                    icon={<AppGlyph name="check" />}
                    onClick={() => toggle(item.fieldId, item.decision, 'accepted')}
                  />
                </span>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
}
