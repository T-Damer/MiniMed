import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Switch } from '@/components/Switch';
import { TextField } from '@/components/TextField';
import {
  type AssessmentLimit,
  assessmentLimit,
  isOwnLimit,
  presetLimit,
  setAssessmentLimit,
} from '@/state/assessment-limits';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

/** One red line the dialog edits: a measurement or a questionnaire total. */
export interface LimitTarget {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  /** The questionnaire's schema line; measurements have theirs built in. */
  readonly preset?: AssessmentLimit | undefined;
}

function number(value: number): string {
  return value.toLocaleString('ru-RU');
}

/**
 * «Порог тревоги»: the doctor's own red line for a chart, or none. Each line starts from its
 * preset (the questionnaire's schema, a clinical cut-off for measurements) and can go back to it.
 */
export function LimitDialog(props: {
  readonly targets: readonly LimitTarget[];
  readonly onClose: () => void;
}): JSX.Element {
  const rows = props.targets.map((target) => {
    const current = assessmentLimit(target.id, target.preset);
    const preset = presetLimit(target.id, target.preset);
    const [on, setOn] = createSignal(current !== undefined);
    const [text, setText] = createSignal(current ? String(current.value) : '');
    return { target, preset, on, setOn, text, setText };
  });
  const [error, setError] = createSignal('');

  const save = (): void => {
    const values = rows.map((row) => {
      if (!row.on()) return null;
      const parsed = Number(row.text().replace(',', '.'));
      return Number.isFinite(parsed) && row.text().trim() ? parsed : Number.NaN;
    });
    if (values.some((value) => Number.isNaN(value))) {
      setError('Введите число.');
      return;
    }
    rows.forEach((row, index) => {
      const value = values[index] ?? null;
      setAssessmentLimit(row.target.id, value === row.preset?.value ? undefined : value);
    });
    playFeedback(...FEEDBACK_MOMENTS.saved);
    props.onClose();
  };

  const reset = (): void => {
    for (const row of rows) setAssessmentLimit(row.target.id, undefined);
    playFeedback(...FEEDBACK_MOMENTS.saved);
    props.onClose();
  };

  return (
    <OverlayDialog open title="Порог тревоги" class="diary-dash-dialog" onClose={props.onClose}>
      <div class="diary-limit">
        <For each={rows}>
          {(row) => (
            <div class="diary-limit__row">
              <div class="diary-limit__head">
                <span class="diary-limit__label">{row.target.label}</span>
                <Switch
                  checked={row.on()}
                  onChange={(checked) => {
                    row.setOn(checked);
                    if (checked && !row.text() && row.preset) row.setText(String(row.preset.value));
                  }}
                  aria-label={`Красная линия: ${row.target.label}`}
                />
              </div>
              <Show when={row.on()}>
                <TextField
                  label={
                    (row.preset?.direction ?? 'above') === 'below' ? 'Тревожно ниже' : 'Тревожно от'
                  }
                  class="diary-limit__field"
                  inputMode="decimal"
                  value={row.text()}
                  onInput={(event) => {
                    setError('');
                    row.setText(event.currentTarget.value);
                  }}
                  hint={
                    row.preset
                      ? `${row.target.preset ? 'По шкале' : 'Обычно'}: ${number(row.preset.value)}${row.target.unit ? ` ${row.target.unit}` : ''}`
                      : undefined
                  }
                />
              </Show>
            </div>
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
