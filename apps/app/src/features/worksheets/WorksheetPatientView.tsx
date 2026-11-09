import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { toast } from 'solid-sonner';

import { PATIENT_MEMO } from '@/features/worksheets/assignment-memo';
import {
  activeWorksheetFields,
  type UserWorksheet,
  WORKSHEET_WEEKDAYS,
  type WorksheetField,
  worksheetHourRows,
  worksheetPatientNote,
} from '@/state/user-worksheet-format';

function Paragraphs(props: { readonly text: string; readonly class: string }): JSX.Element {
  const blocks = (): readonly string[] =>
    props.text
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean);
  return <For each={blocks()}>{(block) => <p class={props.class}>{block}</p>}</For>;
}

let showcaseToldAt = 0;

/** The preview can be used like the patient would; it keeps nothing (owner 2026-10-28). */
function tellShowcase(): void {
  const now = Date.now();
  if (now - showcaseToldAt < 8000) return;
  showcaseToldAt = now;
  toast('Это показ: пациент заполнит лист у себя в дневнике.');
}

function scaleRange(field: WorksheetField): { readonly min: number; readonly max: number } {
  if (field.type === 'percent') return { min: 0, max: 100 };
  if (field.type === 'scale') return { min: 0, max: 10 };
  return { min: field.min ?? 0, max: field.max ?? 100_000 };
}

function FieldControl(props: { readonly field: WorksheetField; readonly id: string }): JSX.Element {
  return (
    <Switch>
      <Match when={props.field.type === 'long-text'}>
        <textarea
          id={props.id}
          class="worksheet-patient__input worksheet-patient__input--long"
          rows={3}
          onInput={tellShowcase}
        />
      </Match>
      <Match when={props.field.type === 'choice' || props.field.type === 'multi'}>
        <fieldset class="worksheet-patient__options" aria-labelledby={`${props.id}-label`}>
          <For each={props.field.options ?? []}>
            {(option) => (
              <button type="button" class="worksheet-patient__option" onClick={tellShowcase}>
                {option}
              </button>
            )}
          </For>
        </fieldset>
      </Match>
      <Match when={props.field.type === 'scale'}>
        <fieldset class="worksheet-patient__scale" aria-labelledby={`${props.id}-label`}>
          <For each={Array.from({ length: 11 }, (_, index) => index)}>
            {(value) => (
              <button type="button" class="worksheet-patient__scale-step" onClick={tellShowcase}>
                {value}
              </button>
            )}
          </For>
        </fieldset>
      </Match>
      <Match when={true}>
        <input
          id={props.id}
          class="worksheet-patient__input"
          inputMode={
            props.field.type === 'text' ||
            props.field.type === 'time' ||
            props.field.type === 'date'
              ? 'text'
              : 'numeric'
          }
          placeholder={
            props.field.type === 'time'
              ? 'ЧЧ:ММ'
              : props.field.type === 'date'
                ? 'ДД.ММ.ГГГГ'
                : props.field.type === 'percent'
                  ? '0–100'
                  : props.field.type === 'duration'
                    ? 'минут'
                    : props.field.type === 'number'
                      ? `${scaleRange(props.field).min}–${scaleRange(props.field).max}`
                      : ''
          }
          onInput={tellShowcase}
        />
      </Match>
    </Switch>
  );
}

/** Where one row of the sheet belongs: the hour, the weekday or the step. */
function rowPlace(worksheet: UserWorksheet): string | undefined {
  if (worksheet.layout === 'hours') {
    const hours = worksheetHourRows(worksheet);
    return `Час: ${hours[0] ?? ''} … ${hours.at(-1) ?? ''}`;
  }
  if (worksheet.layout === 'week') return `День: ${WORKSHEET_WEEKDAYS.join(', ').toLowerCase()}`;
  if (worksheet.layout === 'ladder') return 'Ступени по порядку, начиная с первой';
  return undefined;
}

/**
 * The sheet as the patient sees it in the diary: why it helps, the memo, the text of a material,
 * then one row to fill with what every field means under its label (as the diary's own fields do).
 * The doctor sees it on the template page, so the patient-only lines (`patientCare`, «Если не
 * получилось… расскажите на приёме») stay out (owner 2026-11-09); the diary sheet shows them.
 */
export function WorksheetPatientView(props: {
  readonly worksheet: UserWorksheet;
  /** «Что и когда делать» from an assignment. */
  readonly what?: string;
}): JSX.Element {
  const fields = (): readonly WorksheetField[] => activeWorksheetFields(props.worksheet);
  const idOf = (field: WorksheetField): string => `worksheet-preview-${field.id}`;
  return (
    <article class="worksheet-patient" aria-label="Как увидит пациент">
      <h3 class="worksheet-patient__title">{props.worksheet.title}</h3>
      <div class="worksheet-patient__why">
        <span class="worksheet-patient__why-title">{PATIENT_MEMO.whyTitle}</span>
        <Paragraphs text={worksheetPatientNote(props.worksheet)} class="worksheet-patient__text" />
      </div>
      <Show when={props.what?.trim()}>
        {(what) => (
          <p class="worksheet-patient__what">
            <span class="worksheet-patient__why-title">{PATIENT_MEMO.whatTitle}</span> {what()}
          </p>
        )}
      </Show>
      <Show when={props.worksheet.layout === 'material' && props.worksheet.sections.length > 0}>
        <div class="worksheet-patient__material">
          <For each={props.worksheet.sections}>
            {(section) => (
              <section class="worksheet-patient__part">
                <h4 class="worksheet-patient__part-title">{section.title}</h4>
                <Paragraphs text={section.text} class="worksheet-patient__text" />
              </section>
            )}
          </For>
        </div>
      </Show>
      <Show when={fields().length > 0}>
        <div class="worksheet-patient__row">
          <Show when={rowPlace(props.worksheet)}>
            {(place) => <p class="worksheet-patient__place">{place()}</p>}
          </Show>
          <For each={fields()}>
            {(field) => (
              <div class="worksheet-patient__field">
                <label
                  class="worksheet-patient__label"
                  id={`${idOf(field)}-label`}
                  for={idOf(field)}
                >
                  {field.label}
                </label>
                <Show when={field.patientHint}>
                  <span class="worksheet-patient__hint">{field.patientHint}</span>
                </Show>
                <FieldControl field={field} id={idOf(field)} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </article>
  );
}
