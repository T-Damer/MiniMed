import type { FormField, FormSchema } from '@localmed/contracts';
import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Checkbox } from '@/components/Checkbox';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { NativeDateTimeField } from '@/components/NativeDateTimeField';
import { SelectField } from '@/components/SelectField';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { type FormValue, listValue, textValue } from '@/features/forms/form-values';
import {
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
  readonly missing: boolean;
  readonly error: string | undefined;
  readonly onChange: (value: FormValue) => void;
}

function FieldBadges(props: {
  readonly field: FormField;
  readonly prefilled: boolean;
}): JSX.Element {
  return (
    <>
      <Show when={props.field.required}>
        <span class="form-field__badge form-field__badge--required">обязательное</span>
      </Show>
      <Show when={props.prefilled}>
        <span class="form-field__badge form-field__badge--prefilled">подставлено</span>
      </Show>
    </>
  );
}

function FieldLabel(props: {
  readonly field: FormField;
  readonly prefilled: boolean;
}): JSX.Element {
  return (
    <span class="form-field__label">
      <span class="form-field__label-text">{props.field.label}</span>
      <FieldBadges field={props.field} prefilled={props.prefilled} />
    </span>
  );
}

function FieldRule(props: { readonly schema: FormSchema; readonly field: FormField }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const view = () => fieldRuleView(props.schema, props.field);
  const panelId = `form-rule-${props.field.id}`;
  return (
    <div class="form-field__rule-block">
      <button
        type="button"
        class="form-field__rule-toggle"
        aria-expanded={open()}
        aria-controls={panelId}
        onClick={() => setOpen(!open())}
      >
        <AppGlyph name="question" class="form-field__rule-icon" aria-hidden="true" />
        Правило заполнения
      </button>
      <Show when={open()}>
        <div id={panelId} class="form-field__rule" role="note">
          <Show when={view().status === 'undefined'}>
            <p class="form-field__rule-text">
              Порядок заполнения этого поля не определяет — приказ не содержит для него отдельного
              указания.
            </p>
          </Show>
          <Show when={view().status === 'by-line'}>
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
      </Show>
    </div>
  );
}

function Control(props: FormFieldControlProps): JSX.Element {
  const field = (): FormField => props.field;
  const label = (): JSX.Element => <FieldLabel field={field()} prefilled={props.prefilled} />;
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
              autocomplete="off"
              spellcheck={false}
              autocapitalize={field().type === 'icd10' ? 'characters' : 'sentences'}
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
            rows={2}
            autocomplete="off"
            spellcheck={false}
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
          label={field().label}
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
      <Show when={props.missing && props.error === undefined}>
        <p class="form-field__hint form-field__hint--missing">Не заполнено</p>
      </Show>
      <FieldRule schema={props.schema} field={props.field} />
    </div>
  );
}
