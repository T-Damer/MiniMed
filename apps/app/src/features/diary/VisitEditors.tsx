import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { DateField } from '@/components/DateField';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { TimeField } from '@/components/TimeField';
import { dayKey } from '@/features/diary/diary-care';
import type { CareAppointmentDraft, CareLabDraft } from '@/features/diary/diary-care-draft';
import { labSuggestions } from '@/features/diary/diary-labs';

/**
 * The sheets of a visit and a lab test in the doctor's screen editor (DIARY27): what the patient
 * then sees above the day («Завтра у вас приём в 14:30») and as «Сдать анализ».
 */

function SheetActions(props: {
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  return (
    <div class="screen-editor__sheet-actions">
      <Button
        type="button"
        variant="icon"
        class="screen-editor__remove"
        aria-label={props.removeLabel}
        icon={<AppGlyph name="trash" class="screen-editor__glyph" />}
        onClick={() => props.onRemove()}
      />
      <Button type="button" variant="primary" onClick={() => props.onDone()}>
        Готово
      </Button>
    </div>
  );
}

export function AppointmentEditor(props: {
  readonly appointment: CareAppointmentDraft;
  readonly onChange: (next: CareAppointmentDraft) => void;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  const patch = (next: Partial<CareAppointmentDraft>): void =>
    props.onChange({ ...props.appointment, ...next });
  return (
    <div class="screen-editor__sheet">
      <div class="screen-editor__pair">
        <DateField
          label="День"
          value={props.appointment.day}
          min={dayKey(new Date())}
          onChange={(day) => patch({ day })}
        />
        <TimeField
          label="Время"
          value={props.appointment.time}
          onChange={(time) => patch({ time })}
        />
      </div>
      <TextField
        inputClass="screen-editor__input"
        label="Где"
        placeholder="Кабинет 214 или «по видеосвязи»"
        value={props.appointment.place}
        onInput={(event) => patch({ place: event.currentTarget.value })}
      />
      <TextField
        inputClass="screen-editor__input"
        label="Что взять с собой"
        placeholder="Результаты анализов, паспорт"
        value={props.appointment.note}
        onInput={(event) => patch({ note: event.currentTarget.value })}
      />
      <SheetActions removeLabel="Отменить приём" onRemove={props.onRemove} onDone={props.onDone} />
    </div>
  );
}

export function LabEditor(props: {
  readonly lab: CareLabDraft;
  /** The plan's medicines: the tests they call for come first. */
  readonly medicines: readonly string[];
  /** Tests already asked for in other rows. */
  readonly asked: readonly string[];
  readonly onChange: (next: CareLabDraft) => void;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  const patch = (next: Partial<CareLabDraft>): void => props.onChange({ ...props.lab, ...next });
  const suggestions = () => labSuggestions(props.medicines, props.asked);
  return (
    <div class="screen-editor__sheet">
      <Show when={!props.lab.name.trim() && suggestions().length}>
        <fieldset class="screen-editor__chips screen-editor__chips--set">
          <legend class="screen-editor__muted">Часто нужны</legend>
          <For each={suggestions()}>
            {(one) => (
              <ChoiceChip
                detail={one.why}
                accent={Boolean(one.why)}
                onClick={() =>
                  patch({ name: one.preset.name, unit: one.preset.unit, why: one.why ?? '' })
                }
              >
                {one.preset.name}
              </ChoiceChip>
            )}
          </For>
        </fieldset>
      </Show>
      <div class="screen-editor__pair">
        <TextField
          inputClass="screen-editor__input"
          label="Анализ"
          placeholder="Пролактин"
          value={props.lab.name}
          onInput={(event) => patch({ name: event.currentTarget.value })}
        />
        <TextField
          inputClass="screen-editor__input"
          label="Единицы"
          placeholder="мМЕ/л"
          value={props.lab.unit}
          onInput={(event) => patch({ unit: event.currentTarget.value })}
        />
      </div>
      <DateField
        label="Сдать до"
        value={props.lab.by}
        min={dayKey(new Date())}
        onChange={(by) => patch({ by })}
      />
      <TextArea
        textareaClass="screen-editor__input"
        label="Зачем — пациент увидит"
        maxLength={200}
        placeholder="Рисперидон может повышать пролактин"
        value={props.lab.why}
        onInput={(event) => patch({ why: event.currentTarget.value })}
      />
      <SheetActions removeLabel="Не нужен анализ" onRemove={props.onRemove} onDone={props.onDone} />
    </div>
  );
}
