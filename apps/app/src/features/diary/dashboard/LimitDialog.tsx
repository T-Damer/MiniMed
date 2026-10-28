import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { TextField } from '@/components/TextField';
import {
  type AssessmentLimit,
  assessmentBounds,
  isOwnLimit,
  type LimitSide,
  presetBounds,
  resetAssessmentLimit,
  setAssessmentBound,
} from '@/state/assessment-limits';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

/** One value whose red lines the dialog edits: a measurement or a questionnaire total. */
export interface LimitTarget {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  /** The questionnaire's schema line; measurements have theirs built in. */
  readonly preset?: AssessmentLimit | undefined;
}

const SIDES: readonly { readonly side: LimitSide; readonly label: string }[] = [
  { side: 'above', label: 'Тревожно выше' },
  { side: 'below', label: 'Тревожно ниже' },
];

function number(value: number): string {
  return value.toLocaleString('ru-RU');
}

/** Typed text as a level: a number, `null` for an empty field (no line), NaN for anything else. */
function parseLevel(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text.replace(',', '.').trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * «Порог тревоги»: for any value, a line above which and a line below which it is a reason to
 * worry. Each starts from its preset (the questionnaire's schema, a clinical cut-off), an empty
 * field draws no line, and «Как по умолчанию» returns both to the presets.
 */
export function LimitDialog(props: {
  readonly targets: readonly LimitTarget[];
  readonly onClose: () => void;
}): JSX.Element {
  const rows = props.targets.map((target) => {
    const current = assessmentBounds(target.id, target.preset);
    const preset = presetBounds(target.id, target.preset);
    const fields = SIDES.map(({ side, label }) => {
      const value = current[side];
      const [text, setText] = createSignal(value === undefined ? '' : String(value));
      return { side, label, preset: preset[side], text, setText };
    });
    return { target, fields };
  });
  const [error, setError] = createSignal('');

  const save = (): void => {
    const levels = rows.map((row) => row.fields.map((field) => parseLevel(field.text())));
    if (levels.flat().some((level) => Number.isNaN(level))) {
      setError('Введите число или оставьте поле пустым.');
      return;
    }
    const crossed = rows.find((_, index) => {
      const [above, below] = levels[index] ?? [];
      return typeof above === 'number' && typeof below === 'number' && below >= above;
    });
    if (crossed) {
      setError(`${crossed.target.label}: нижняя линия должна быть ниже верхней.`);
      return;
    }
    rows.forEach((row, index) => {
      row.fields.forEach((field, position) => {
        const level = levels[index]?.[position] ?? null;
        // The preset itself is not an own level: it follows the schema if that changes.
        if (level === (field.preset ?? null))
          setAssessmentBound(row.target.id, field.side, undefined);
        else setAssessmentBound(row.target.id, field.side, level);
      });
    });
    playFeedback(...FEEDBACK_MOMENTS.saved);
    props.onClose();
  };

  const reset = (): void => {
    for (const target of props.targets) resetAssessmentLimit(target.id);
    playFeedback(...FEEDBACK_MOMENTS.saved);
    props.onClose();
  };

  return (
    <OverlayDialog open title="Порог тревоги" class="diary-dash-dialog" onClose={props.onClose}>
      <div class="diary-limit">
        <For each={rows}>
          {(row) => (
            <fieldset class="diary-limit__row">
              <legend class="diary-limit__label">
                {row.target.label}
                <Show when={row.target.unit}>
                  {(unit) => <span class="diary-limit__unit">, {unit()}</span>}
                </Show>
              </legend>
              <div class="diary-limit__pair">
                <For each={row.fields}>
                  {(field) => (
                    <TextField
                      label={field.label}
                      class="diary-limit__field"
                      inputMode="decimal"
                      placeholder="нет линии"
                      value={field.text()}
                      onInput={(event) => {
                        setError('');
                        field.setText(event.currentTarget.value);
                      }}
                      hint={
                        field.preset === undefined
                          ? undefined
                          : `${row.target.preset ? 'По шкале' : 'Обычно'}: ${number(field.preset)}`
                      }
                    />
                  )}
                </For>
              </div>
            </fieldset>
          )}
        </For>
        <Show when={error()}>
          <p class="diary-limit__error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="diary-limit__actions">
          <Show when={props.targets.some((target) => isOwnLimit(target.id))}>
            <Button variant="quiet" onClick={reset}>
              Как по умолчанию
            </Button>
          </Show>
          <Button variant="primary" onClick={save}>
            Сохранить
          </Button>
        </div>
      </div>
    </OverlayDialog>
  );
}
