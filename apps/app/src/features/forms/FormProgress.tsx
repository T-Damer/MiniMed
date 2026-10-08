import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';

export interface FormProgressProps {
  /** Required fields of the form. */
  readonly total: number;
  /** Required fields that are filled. */
  readonly done: number;
  /** Quiet state line: «Черновик», «Сохранено · 8 окт., 14:32» or a save problem. */
  readonly stateText: string;
  readonly stateError: boolean;
  /** Mark the unfinished part: the person has already tried to save. */
  readonly attention: boolean;
  /** Typed values differ from what was filled in from the data. */
  readonly canReset: boolean;
  readonly onJump: () => void;
  readonly onReset: () => void;
}

/**
 * One compact progress line in place of the «N подставлено / не заполнено N» chips: how many
 * required fields are filled (a tap jumps to the first empty one), the draft state, and a reset.
 */
export function FormProgress(props: FormProgressProps): JSX.Element {
  const complete = (): boolean => props.done >= props.total;
  const percent = (): number => (props.total === 0 ? 100 : (props.done / props.total) * 100);
  return (
    <div class="form-progress" role="status" aria-live="polite">
      <Show when={props.total > 0}>
        <button
          type="button"
          class="form-progress__jump"
          disabled={complete()}
          aria-label={`Обязательные поля: ${props.done} из ${props.total}`}
          title="К первому незаполненному"
          onClick={props.onJump}
        >
          <span class="form-progress__track" aria-hidden="true">
            <span
              class="form-progress__fill"
              classList={{ 'form-progress__fill--attention': props.attention }}
              style={{ width: `${percent()}%` }}
            />
          </span>
          <Show
            when={!complete()}
            fallback={<AppGlyph name="check" class="form-progress__done-icon" />}
          >
            <span
              class="form-progress__count"
              classList={{ 'form-progress__count--attention': props.attention }}
            >
              {props.done}/{props.total}
            </span>
          </Show>
        </button>
      </Show>
      <span
        class="form-progress__state"
        classList={{ 'form-progress__state--error': props.stateError }}
      >
        {props.stateText}
      </span>
      <Show when={props.canReset}>
        <Button
          type="button"
          variant="icon"
          class="form-progress__reset"
          aria-label="Вернуть подставленные значения"
          title="Вернуть подставленные значения"
          icon={<AppGlyph name="arrow-counter-clockwise" />}
          onClick={props.onReset}
        />
      </Show>
    </div>
  );
}
