import type { FormField, FormSchema } from '@localmed/contracts';
import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Checkbox } from '@/components/Checkbox';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { NativeDateTimeField } from '@/components/NativeDateTimeField';
import { SelectField } from '@/components/SelectField';
import { SheetPopover } from '@/components/SheetPopover';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { type FormValue, listValue, textValue } from '@/features/forms/form-values';
import {
  fieldHasRule,
  fieldRuleView,
  isCodeList,
  optionLabel,
  ruleCitation,
} from '@/features/forms/form-view-model';

export interface FormFieldControlProps {
  readonly schema: FormSchema;
  readonly field: FormField;
  readonly value: FormValue | undefined;
  readonly prefilled: boolean;
  /** The field is required, empty, and the person has already tried to save. */
  readonly missing: boolean;
  readonly error: string | undefined;
  readonly onChange: (value: FormValue) => void;
}

/** The paragraph of the order that governs the field, opened from the «?» in its label. */
function FieldRule(props: { readonly schema: FormSchema; readonly field: FormField }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const view = () => fieldRuleView(props.schema, props.field);
  return (
    <SheetPopover
      open={open()}
      onOpenChange={setOpen}
      title={props.field.label}
      triggerClass="form-field__rule-button"
      triggerLabel="Правило заполнения"
      triggerTitle="Правило заполнения"
      trigger={<AppGlyph name="question" class="form-field__rule-icon" />}
      contentClass="form-field__rule"
      placement="bottom-start"
    >
      <div role="note" class="form-field__rule-body">
        <Show when={view().status === 'by-line' && view().note === undefined}>
          <p class="form-field__rule-note">
            Порядок называет строку целиком; эту часть строки он отдельно не определяет.
          </p>
        </Show>
        <For each={view().paragraphs}>
          {(paragraph) => (
            <div class="form-field__rule-paragraph">
              <p class="form-field__rule-text">{paragraph.text}</p>
              <Show when={paragraph.listItemCount}>
                {(count) => (
                  <p class="form-field__rule-note">
                    Перечень значений ({count()}) — в списке поля.
                  </p>
                )}
              </Show>
              <p class="form-field__rule-cite">{ruleCitation(props.schema, paragraph)}</p>
            </div>
          )}
        </For>
        <Show when={view().note}>{(note) => <p class="form-field__rule-note">{note()}</p>}</Show>
      </div>
    </SheetPopover>
  );
}

/** Label with a quiet «*» for a required field and a «?» when the order has a rule for it. */
function FieldLabel(props: {
  readonly schema: FormSchema;
  readonly field: FormField;
}): JSX.Element {
  return (
    <span class="form-field__label">
      <span class="form-field__label-text">{props.field.label}</span>
      <Show when={props.field.required}>
        <span class="form-field__required" aria-hidden="true">
          *
        </span>
      </Show>
      <Show when={fieldHasRule(props.schema, props.field)}>
        <FieldRule schema={props.schema} field={props.field} />
      </Show>
    </span>
  );
}

function Control(props: FormFieldControlProps): JSX.Element {
  const field = (): FormField => props.field;
  const label = (): JSX.Element => <FieldLabel schema={props.schema} field={field()} />;
  const options = () =>
    (field().options ?? []).map((option) => ({
      value: option.value,
      label: optionLabel(field(), option),
    }));
  return (
    <>
      <Show when={field().type === 'text' || field().type === 'icd10'}>
        <Show
          when={field().multiline}
          fallback={
            <TextField
              label={label()}
              value={textValue(props.value)}
              error={props.error}
              inputClass="form-field__input"
              autocomplete="off"
              spellcheck={false}
              autocapitalize={field().type === 'icd10' ? 'characters' : 'sentences'}
              aria-required={field().required}
              {...(field().type === 'icd10' ? { hint: 'Например, J45.0' } : {})}
              onInput={(event) => {
                const raw = event.currentTarget.value;
                props.onChange(field().type === 'icd10' ? raw.toUpperCase() : raw);
              }}
            />
          }
        >
          <TextArea
            label={label()}
            value={textValue(props.value)}
            error={props.error}
            textareaClass="form-field__input form-field__input--multiline"
            rows={3}
            autocomplete="off"
            spellcheck={false}
            aria-required={field().required}
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
        </Show>
      </Show>
      <Show when={field().type === 'date'}>
        <div class="form-field__date">
          <span class="form-field__date-label">{label()}</span>
          <NativeDateTimeField
            type="date"
            label={field().label}
            placeholder="дд.мм.гггг"
            value={textValue(props.value)}
            class="form-field__date-wrapper"
            buttonClass="form-field__date-button"
            onChange={(next) => props.onChange(next)}
          />
          <Show when={props.error}>
            {(message) => (
              <span class="form-field__error" role="alert">
                {message()}
              </span>
            )}
          </Show>
        </div>
      </Show>
      <Show when={field().type === 'choice' && !field().multiple && isCodeList(field())}>
        <SelectField
          label={label()}
          value={textValue(props.value)}
          error={props.error}
          controlClass="form-field__input"
          aria-required={field().required}
          options={[{ value: '', label: 'Не указано' }, ...options()]}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      </Show>
      <Show when={field().type === 'choice' && !field().multiple && !isCodeList(field())}>
        <div class="form-field__choice">
          <ChoiceGroup
            legend={label()}
            options={options()}
            value={textValue(props.value)}
            error={props.error}
            large
            onChange={(next) => props.onChange(next)}
          />
          <Show when={textValue(props.value) !== '' && !field().required}>
            <button type="button" class="form-field__clear" onClick={() => props.onChange('')}>
              Очистить
            </button>
          </Show>
        </div>
      </Show>
      <Show when={field().type === 'choice' && field().multiple}>
        <fieldset class="form-field__multiple">
          <legend class="form-field__multiple-legend">{label()}</legend>
          <For each={options()}>
            {(option) => (
              <Checkbox
                class="form-field__tap-row"
                label={option.label}
                checked={listValue(props.value).includes(option.value)}
                onChange={(event) => {
                  const current = listValue(props.value);
                  const next = event.currentTarget.checked
                    ? [...current, option.value]
                    : current.filter((item) => item !== option.value);
                  props.onChange(
                    (field().options ?? [])
                      .map((candidate) => candidate.value)
                      .filter((value) => next.includes(value)),
                  );
                }}
              />
            )}
          </For>
        </fieldset>
      </Show>
      <Show when={field().type === 'checkbox'}>
        <Checkbox
          class="form-field__tap-row"
          label={label()}
          checked={props.value === true}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
      </Show>
    </>
  );
}

/** One field of a schema, rendered by type: label, value, marks and the rule behind it. */
export function FormFieldControl(props: FormFieldControlProps): JSX.Element {
  return (
    <div
      id={`form-field-${props.field.id}`}
      class="form-field"
      classList={{
        'form-field--missing': props.missing,
        'form-field--invalid': props.error !== undefined,
        'form-field--prefilled': props.prefilled,
      }}
      data-field={props.field.id}
    >
      <Control {...props} />
    </div>
  );
}
