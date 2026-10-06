import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Field } from '@/diary/diary-fields';
import { formatLongDateTime } from '@/diary/diary-format';
import { inputModeFor, numberProblems, rangeHint } from '@/diary/diary-validation';
import {
  createDiaryId,
  type DiaryEntry,
  type DiaryField,
  type DiaryInvitation,
  type DiaryPlanValue,
} from '@/features/diary/diary-model';

type Draft = Record<string, string | boolean | readonly string[] | DiaryPlanValue>;

const OTHER = '__other__';
const TIME_PROBLEM = '__time__';

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
      const text = String(value).trim().replaceAll(/\s+/gu, '').replace(',', '.');
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

/** Required fields of the kinds `numberProblems` does not cover. */
function missingRequired(invitation: DiaryInvitation, draft: Draft): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of invitation.fields) {
    if (!field.required) continue;
    const value = draft[field.id];
    switch (field.type) {
      case 'choice':
      case 'text':
        if (value === undefined || value === '') problems[field.id] = 'Выберите вариант.';
        break;
      case 'multi':
        if (!Array.isArray(value) || value.length === 0) problems[field.id] = 'Выберите вариант.';
        break;
      case 'plan': {
        const plan = (value ?? {}) as DiaryPlanValue;
        if (plan.item === undefined && !plan.other?.trim()) problems[field.id] = 'Выберите пункт.';
        break;
      }
      default:
        break;
    }
  }
  return problems;
}

/** A button that stays pressed: the answer is visible, and a second tap takes it back. */
function OptionButton(props: {
  readonly selected: boolean;
  readonly wide?: boolean;
  readonly onToggle: () => void;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      class="diary-option"
      classList={{
        'diary-option--on': props.selected,
        'diary-option--wide': props.wide ?? false,
      }}
      aria-pressed={props.selected}
      onClick={props.onToggle}
    >
      <Show when={props.selected}>
        <AppGlyph name="check" class="diary-option__mark" />
      </Show>
      <span class="diary-option__label">{props.children}</span>
    </button>
  );
}

function FieldInput(props: {
  readonly invitation: DiaryInvitation;
  readonly field: DiaryField;
  readonly value: Draft[string] | undefined;
  readonly error: string | undefined;
  readonly onChange: (value: Draft[string]) => void;
}): JSX.Element {
  const inputId = `diary-field-${props.field.id}`;
  const describedBy = (): string =>
    [
      props.field.unit ? `${inputId}-unit` : '',
      rangeHint(props.field) ? `${inputId}-hint` : '',
      props.error ? `${inputId}-error` : '',
    ]
      .filter(Boolean)
      .join(' ');
  switch (props.field.type) {
    case 'number':
      return (
        <Field
          id={inputId}
          label={props.field.label}
          hint={rangeHint(props.field)}
          error={props.error}
        >
          <div class="diary-field__control">
            <input
              id={inputId}
              class="diary-field__input"
              classList={{ 'diary-field__input--invalid': Boolean(props.error) }}
              type="text"
              inputmode={inputModeFor(props.field)}
              autocomplete="off"
              enterkeyhint="next"
              required={props.field.required ?? false}
              aria-invalid={props.error ? 'true' : undefined}
              aria-describedby={describedBy() || undefined}
              value={String(props.value ?? '')}
              onInput={(event) => props.onChange(event.currentTarget.value)}
            />
            <Show when={props.field.unit}>
              <span class="diary-field__unit" id={`${inputId}-unit`}>
                {props.field.unit}
              </span>
            </Show>
          </div>
        </Field>
      );
    case 'count': {
      const count = () => Number(props.value ?? 0) || 0;
      const min = () => props.field.min ?? 0;
      const max = () => props.field.max ?? 99;
      return (
        <Field id={inputId} label={props.field.label} error={props.error} group>
          <div class="diary-counter">
            <Button
              class="diary-counter__button"
              type="button"
              variant="icon"
              aria-label={`Меньше: ${props.field.label}`}
              icon={<AppGlyph name="minus" class="diary-counter__icon" />}
              disabled={count() <= min()}
              onClick={() => props.onChange(String(Math.max(min(), count() - 1)))}
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
              disabled={count() >= max()}
              onClick={() => props.onChange(String(Math.min(max(), count() + 1)))}
            />
          </div>
        </Field>
      );
    }
    case 'choice':
      return (
        <Field id={inputId} label={props.field.label} error={props.error} group>
          <div class="diary-options">
            <For each={props.field.options ?? []}>
              {(option) => (
                <OptionButton
                  selected={props.value === option}
                  onToggle={() => props.onChange(props.value === option ? '' : option)}
                >
                  {option}
                </OptionButton>
              )}
            </For>
          </div>
        </Field>
      );
    case 'multi': {
      const chosen = () => (Array.isArray(props.value) ? (props.value as readonly string[]) : []);
      return (
        <Field
          id={inputId}
          label={props.field.label}
          hint="Можно выбрать несколько"
          error={props.error}
          group
        >
          <div class="diary-options">
            <For each={props.field.options ?? []}>
              {(option) => (
                <OptionButton
                  selected={chosen().includes(option)}
                  onToggle={() =>
                    props.onChange(
                      chosen().includes(option)
                        ? chosen().filter((item) => item !== option)
                        : [...chosen(), option],
                    )
                  }
                >
                  {option}
                </OptionButton>
              )}
            </For>
          </div>
        </Field>
      );
    }
    case 'flag':
      return (
        <label class="diary-flag" for={inputId}>
          <input
            id={inputId}
            class="diary-flag__input"
            type="checkbox"
            checked={props.value === true}
            onChange={(event) => props.onChange(event.currentTarget.checked)}
          />
          <span class="diary-flag__label">{props.field.label}</span>
        </label>
      );
    case 'text':
      return (
        <Field id={inputId} label={props.field.label} error={props.error}>
          <textarea
            id={inputId}
            class="diary-field__input diary-field__input--text"
            classList={{ 'diary-field__input--invalid': Boolean(props.error) }}
            rows={3}
            maxLength={200}
            aria-invalid={props.error ? 'true' : undefined}
            aria-describedby={describedBy() || undefined}
            value={String(props.value ?? '')}
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
        </Field>
      );
    case 'plan': {
      const plan = () => (props.value ?? {}) as DiaryPlanValue;
      const items = () =>
        (props.invitation.plan ?? []).filter((item) => !item.ended || item.id === plan().item);
      const selected = () => plan().item ?? (plan().other !== undefined ? OTHER : '');
      const choose = (value: string): void => {
        const done = plan().done;
        props.onChange({
          ...(value && value !== OTHER ? { item: value } : {}),
          ...(value === OTHER ? { other: '' } : {}),
          ...(done === undefined ? {} : { done }),
        });
      };
      return (
        <div class="diary-plan">
          <Field id={inputId} label={props.field.label} error={props.error} group>
            <div class="diary-options diary-options--column">
              <For each={items()}>
                {(item) => (
                  <OptionButton
                    wide
                    selected={selected() === item.id}
                    onToggle={() => choose(selected() === item.id ? '' : item.id)}
                  >
                    {[item.name, item.dose, item.schedule].filter(Boolean).join(' · ')}
                  </OptionButton>
                )}
              </For>
              <OptionButton
                wide
                selected={selected() === OTHER}
                onToggle={() => choose(selected() === OTHER ? '' : OTHER)}
              >
                Другое — вписать самому
              </OptionButton>
            </div>
          </Field>
          <Show when={selected() === OTHER}>
            <Field id={`${inputId}-other`} label="Что именно">
              <input
                id={`${inputId}-other`}
                class="diary-field__input"
                type="text"
                autocomplete="off"
                value={plan().other ?? ''}
                onInput={(event) => props.onChange({ ...plan(), other: event.currentTarget.value })}
              />
            </Field>
          </Show>
          <Show when={props.field.trackDone && selected()}>
            <fieldset class="diary-plan__done">
              <legend class="diary-field__label">Принято или пропущено</legend>
              <div class="diary-options">
                <OptionButton
                  selected={plan().done !== false}
                  onToggle={() => props.onChange({ ...plan(), done: true })}
                >
                  Принял(а)
                </OptionButton>
                <OptionButton
                  selected={plan().done === false}
                  onToggle={() => props.onChange({ ...plan(), done: false })}
                >
                  Пропустил(а)
                </OptionButton>
              </div>
            </fieldset>
          </Show>
        </div>
      );
    }
  }
}

/**
 * One diary entry as its own step: every field of the invitation, the time (now unless the
 * patient changes it) and a comment, then one big «Сохранить» that stays on the screen. Problems
 * are shown next to the field and again above the button. The same form edits an existing entry.
 */
export function DiaryEntryForm(props: {
  readonly invitation: DiaryInvitation;
  readonly entry?: DiaryEntry | undefined;
  /** Returns a message when the entry could not be saved, nothing when it was. */
  readonly onSave: (value: Record<string, unknown>) => string | undefined;
  readonly onCancel: () => void;
}): JSX.Element {
  const formId = createUniqueId();
  const openedAt = props.entry ? props.entry.at : new Date().toISOString();
  // undefined: the time is «now» (read when saving) or the entry's own time.
  const [customAt, setCustomAt] = createSignal<string | undefined>(undefined);
  const [changingTime, setChangingTime] = createSignal(false);
  const [draft, setDraft] = createSignal<Draft>(draftFrom(props.invitation, props.entry));
  const [note, setNote] = createSignal(props.entry?.note ?? '');
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [formError, setFormError] = createSignal('');
  const [dirty, setDirty] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);

  const change = (fieldId: string, value: Draft[string]): void => {
    setDraft({ ...draft(), [fieldId]: value });
    setDirty(true);
    if (errors()[fieldId]) {
      const { [fieldId]: _fixed, ...rest } = errors();
      setErrors(rest);
    }
  };

  const resolveAt = (): string | undefined => {
    const custom = customAt();
    if (custom === undefined) return props.entry ? props.entry.at : new Date().toISOString();
    const date = new Date(custom);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };

  const focusFirstProblem = (problems: Record<string, string>): void => {
    const first = [...props.invitation.fields.map((field) => field.id), TIME_PROBLEM].find(
      (id) => problems[id],
    );
    const target =
      first === TIME_PROBLEM
        ? document.getElementById(`${formId}-at`)
        : document.getElementById(`diary-field-${first ?? ''}`);
    if (target instanceof HTMLElement && target.matches('input, textarea')) target.focus();
    else (target ?? document.querySelector('.diary-field--invalid'))?.scrollIntoView();
  };

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    setFormError('');
    const texts: Record<string, string> = {};
    for (const field of props.invitation.fields) {
      if (field.type === 'number' || field.type === 'count') {
        texts[field.id] = String(draft()[field.id] ?? '');
      }
    }
    const problems = {
      ...numberProblems(props.invitation, texts),
      ...missingRequired(props.invitation, draft()),
    };
    const at = resolveAt();
    if (!at) problems[TIME_PROBLEM] = 'Укажите дату и время.';
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !at) {
      setFormError('Запись пока не сохранена. Исправьте поля, отмеченные красным.');
      focusFirstProblem(problems);
      return;
    }
    const message = props.onSave({
      id: props.entry?.id ?? createDiaryId().slice(0, 10),
      at,
      values: rawValues(props.invitation, draft()),
      ...(note().trim() ? { note: note().trim() } : {}),
    });
    if (message) setFormError(message);
  };

  const leave = (): void => {
    if (dirty()) setLeaving(true);
    else props.onCancel();
  };

  return (
    <form class="diary-form" id={formId} noValidate onSubmit={submit}>
      <For each={props.invitation.fields}>
        {(field) => (
          <FieldInput
            invitation={props.invitation}
            field={field}
            value={draft()[field.id]}
            error={errors()[field.id]}
            onChange={(value) => change(field.id, value)}
          />
        )}
      </For>
      <div class="diary-field diary-time">
        <span class="diary-field__label">{props.entry ? 'Время записи' : 'Когда измерили'}</span>
        <Show
          when={changingTime()}
          fallback={
            <div class="diary-time__row">
              <span class="diary-time__value">
                {props.entry ? '' : 'Сейчас: '}
                {formatLongDateTime(openedAt)}
              </span>
              <Button
                class="diary-button diary-time__change"
                type="button"
                onClick={() => {
                  setCustomAt(localDateTimeValue(new Date(openedAt)));
                  setChangingTime(true);
                  setDirty(true);
                }}
              >
                Изменить время
              </Button>
            </div>
          }
        >
          <label class="diary-field__label diary-time__label" for={`${formId}-at`}>
            Дата и время
          </label>
          <input
            id={`${formId}-at`}
            class="diary-field__input"
            classList={{ 'diary-field__input--invalid': Boolean(errors()[TIME_PROBLEM]) }}
            type="datetime-local"
            required
            aria-invalid={errors()[TIME_PROBLEM] ? 'true' : undefined}
            value={customAt() ?? ''}
            onInput={(event) => {
              setCustomAt(event.currentTarget.value);
              setDirty(true);
            }}
          />
          <Show when={errors()[TIME_PROBLEM]}>
            <p class="diary-field__error" role="alert">
              {errors()[TIME_PROBLEM]}
            </p>
          </Show>
        </Show>
      </div>
      <div class="diary-field">
        <label class="diary-field__label" for={`${formId}-note`}>
          Комментарий (необязательно)
        </label>
        <input
          id={`${formId}-note`}
          class="diary-field__input"
          type="text"
          maxLength={200}
          autocomplete="off"
          value={note()}
          placeholder="Что ещё важно отметить"
          onInput={(event) => {
            setNote(event.currentTarget.value);
            setDirty(true);
          }}
        />
      </div>
      <Show when={formError()}>
        <p class="diary-error diary-form__error" role="alert">
          {formError()}
        </p>
      </Show>
      <div class="diary-dock">
        <Show
          when={!leaving()}
          fallback={
            <>
              <p class="diary-dock__question">Выйти без сохранения? Введённое пропадёт.</p>
              <Button class="diary-button" type="button" onClick={() => setLeaving(false)}>
                Остаться
              </Button>
              <Button
                class="diary-button diary-button--danger"
                type="button"
                variant="danger"
                onClick={props.onCancel}
              >
                Выйти
              </Button>
            </>
          }
        >
          <Button class="diary-button diary-dock__secondary" type="button" onClick={leave}>
            Отмена
          </Button>
          <Button class="diary-button diary-dock__primary" type="submit" variant="primary">
            {props.entry ? 'Сохранить изменения' : 'Сохранить'}
          </Button>
        </Show>
      </div>
    </form>
  );
}
