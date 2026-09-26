import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { SelectField } from '@/components/SelectField';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  createDiaryId,
  type DiaryEntry,
  type DiaryField,
  type DiaryInvitation,
  type DiaryPlanValue,
} from '@/features/diary/diary-model';

type Draft = Record<string, string | boolean | readonly string[] | DiaryPlanValue>;

const OTHER = '__other__';

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function draftFrom(invitation: DiaryInvitation, entry?: DiaryEntry): Draft {
  const draft: Draft = {};
  for (const field of invitation.fields) {
    const value = entry?.values[field.id];
    if (value === undefined) {
      if (field.type === 'multi') draft[field.id] = [];
      if (field.type === 'plan') draft[field.id] = field.trackDone ? { done: true } : {};
      continue;
    }
    draft[field.id] =
      typeof value === 'number' ? String(value).replace('.', ',') : (value as Draft[string]);
  }
  return draft;
}

/** Converts the draft into the raw value object that `parseDiaryEntry` validates. */
function rawValues(invitation: DiaryInvitation, draft: Draft): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of invitation.fields) {
    const value = draft[field.id];
    if (value === undefined) continue;
    if (field.type === 'number' || field.type === 'count') {
      const text = String(value).trim().replace(',', '.');
      if (text) values[field.id] = Number(text);
    } else if (field.type === 'plan') {
      const plan = value as DiaryPlanValue;
      if (plan.item !== undefined || plan.other?.trim()) values[field.id] = plan;
    } else if (field.type === 'flag') {
      // Untouched flags stay absent; «нет» is recorded only after an explicit untick.
      values[field.id] = value;
    } else if (!(Array.isArray(value) && value.length === 0) && value !== '') {
      values[field.id] = value;
    }
  }
  return values;
}

function FieldInput(props: {
  readonly invitation: DiaryInvitation;
  readonly field: DiaryField;
  readonly value: Draft[string] | undefined;
  readonly onChange: (value: Draft[string]) => void;
}): JSX.Element {
  const label = () => `${props.field.label}${props.field.unit ? `, ${props.field.unit}` : ''}`;
  switch (props.field.type) {
    case 'number':
      return (
        <TextField
          class="diary-form__field"
          inputClass="diary-form__input"
          label={label()}
          inputmode="decimal"
          required={props.field.required ?? false}
          value={String(props.value ?? '')}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      );
    case 'count': {
      const count = () => Number(props.value ?? 0) || 0;
      return (
        <div class="diary-counter">
          <span class="diary-counter__label">{label()}</span>
          <div class="diary-counter__controls">
            <Button
              class="diary-counter__button"
              type="button"
              variant="icon"
              aria-label={`Меньше: ${props.field.label}`}
              icon={<AppGlyph name="minus" class="diary-counter__icon" />}
              onClick={() => props.onChange(String(Math.max(props.field.min ?? 0, count() - 1)))}
            />
            <span class="diary-counter__value" aria-live="polite">
              {count()}
            </span>
            <Button
              class="diary-counter__button"
              type="button"
              variant="icon"
              aria-label={`Больше: ${props.field.label}`}
              icon={<AppGlyph name="plus" class="diary-counter__icon" />}
              onClick={() => props.onChange(String(Math.min(props.field.max ?? 99, count() + 1)))}
            />
          </div>
        </div>
      );
    }
    case 'choice':
      return (
        <SelectField
          class="diary-form__field"
          label={label()}
          value={String(props.value ?? '')}
          options={[
            { value: '', label: 'Не указано' },
            ...(props.field.options ?? []).map((option) => ({ value: option, label: option })),
          ]}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      );
    case 'multi': {
      const chosen = () => (Array.isArray(props.value) ? (props.value as readonly string[]) : []);
      return (
        <fieldset class="diary-chips">
          <legend class="diary-chips__legend">{label()}</legend>
          <div class="diary-chips__list">
            <For each={props.field.options ?? []}>
              {(option) => (
                <button
                  type="button"
                  class="diary-chips__chip"
                  classList={{ 'diary-chips__chip--on': chosen().includes(option) }}
                  aria-pressed={chosen().includes(option)}
                  onClick={() =>
                    props.onChange(
                      chosen().includes(option)
                        ? chosen().filter((item) => item !== option)
                        : [...chosen(), option],
                    )
                  }
                >
                  {option}
                </button>
              )}
            </For>
          </div>
        </fieldset>
      );
    }
    case 'flag':
      return (
        <Checkbox
          class="diary-form__flag"
          label={props.field.label}
          checked={props.value === true}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
      );
    case 'text':
      return (
        <TextArea
          class="diary-form__field"
          label={label()}
          maxLength={200}
          value={String(props.value ?? '')}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      );
    case 'plan': {
      const plan = () => (props.value ?? {}) as DiaryPlanValue;
      const selected = () => plan().item ?? (plan().other !== undefined ? OTHER : '');
      return (
        <div class="diary-plan">
          <SelectField
            class="diary-form__field"
            label={label()}
            value={selected()}
            options={[
              { value: '', label: 'Не выбрано' },
              ...(props.invitation.plan ?? []).map((item) => ({
                value: item.id,
                label: [item.name, item.dose, item.schedule].filter(Boolean).join(' · '),
              })),
              { value: OTHER, label: 'Другое — вписать самому' },
            ]}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const done = plan().done;
              props.onChange({
                ...(value && value !== OTHER ? { item: value } : {}),
                ...(value === OTHER ? { other: '' } : {}),
                ...(done === undefined ? {} : { done }),
              });
            }}
          />
          <Show when={selected() === OTHER}>
            <TextField
              class="diary-form__field"
              inputClass="diary-form__input"
              label="Что именно"
              value={plan().other ?? ''}
              onInput={(event) => props.onChange({ ...plan(), other: event.currentTarget.value })}
            />
          </Show>
          <Show when={props.field.trackDone && selected()}>
            <div class="diary-plan__done" role="group" aria-label="Выполнено ли">
              <button
                type="button"
                class="diary-chips__chip"
                classList={{ 'diary-chips__chip--on': plan().done !== false }}
                aria-pressed={plan().done !== false}
                onClick={() => props.onChange({ ...plan(), done: true })}
              >
                Принял(а)
              </button>
              <button
                type="button"
                class="diary-chips__chip"
                classList={{ 'diary-chips__chip--on': plan().done === false }}
                aria-pressed={plan().done === false}
                onClick={() => props.onChange({ ...plan(), done: false })}
              >
                Пропустил(а)
              </button>
            </div>
          </Show>
        </div>
      );
    }
  }
}

/**
 * One diary entry: every field of the invitation, the time (now by default, editable) and a
 * comment. The same form edits an existing entry.
 */
export function DiaryEntryForm(props: {
  readonly invitation: DiaryInvitation;
  readonly entry?: DiaryEntry;
  readonly onSave: (value: Record<string, unknown>) => void;
  readonly onCancel?: () => void;
}): JSX.Element {
  const [at, setAt] = createSignal(
    localDateTimeValue(props.entry ? new Date(props.entry.at) : new Date()),
  );
  const [draft, setDraft] = createSignal<Draft>(draftFrom(props.invitation, props.entry));
  const [note, setNote] = createSignal(props.entry?.note ?? '');

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    props.onSave({
      id: props.entry?.id ?? createDiaryId().slice(0, 10),
      at: new Date(at()).toISOString(),
      values: rawValues(props.invitation, draft()),
      ...(note().trim() ? { note: note().trim() } : {}),
    });
    if (!props.entry) {
      setDraft(draftFrom(props.invitation));
      setNote('');
      setAt(localDateTimeValue());
    }
  };

  return (
    <form class="diary-form" onSubmit={submit}>
      <For each={props.invitation.fields}>
        {(field) => (
          <FieldInput
            invitation={props.invitation}
            field={field}
            value={draft()[field.id]}
            onChange={(value) => setDraft({ ...draft(), [field.id]: value })}
          />
        )}
      </For>
      <TextField
        class="diary-form__field"
        inputClass="diary-form__input"
        label="Дата и время"
        type="datetime-local"
        required
        value={at()}
        onInput={(event) => setAt(event.currentTarget.value)}
      />
      <TextField
        class="diary-form__field"
        inputClass="diary-form__input"
        label="Комментарий"
        maxLength={200}
        value={note()}
        placeholder="Что ещё важно отметить"
        onInput={(event) => setNote(event.currentTarget.value)}
      />
      <div class="diary-form__actions">
        <Show when={props.onCancel}>
          <Button class="diary-button" type="button" onClick={() => props.onCancel?.()}>
            Отмена
          </Button>
        </Show>
        <Button class="diary-button" type="submit" variant="primary">
          {props.entry ? 'Сохранить изменения' : 'Записать'}
        </Button>
      </div>
    </form>
  );
}
