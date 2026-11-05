import {
  type CalculatorSchema,
  FORM_FILL_SCHEMA_VERSION,
  type FormField,
  type FormFillField,
  type FormFillForm,
  type FormFillSection,
  type FormFillValue,
  type FormSchema,
  parseFormFillForm,
} from '@localmed/contracts';

/**
 * The app's own schemas as forms to fill from a conversation (FORMFILL1): calculators, the
 * questionnaires of the tool modules, and the official blanks. Each adapter keeps the source
 * schema's ids and returns a mapping back, so an accepted value lands in the tool's own input.
 * Hints and word cues are not part of the source schemas; a form brings them as an overlay
 * (`forms/*.ts`), keyed by field id and option value.
 *
 * A select or choice with exactly the options «Да» and «Нет» is a boolean here: the model answers
 * true/false, and the value maps back to the option.
 */

export type FormFillToolValue = string | number | boolean | readonly string[];

export interface FormFillBinding {
  readonly form: FormFillForm;
  /** An accepted value in the source schema's own terms, or undefined when it has no place there. */
  toSourceValue(fieldId: string, value: FormFillValue): FormFillToolValue | undefined;
}

export interface FormFillOverlayField {
  readonly hint?: string;
  readonly cues?: readonly string[];
  /** Word cues per option value. */
  readonly options?: Readonly<Record<string, readonly string[]>>;
  /** Overrides the label the model reads (a calculator's terse label, an official long one). */
  readonly label?: string;
}

export interface FormFillOverlay {
  readonly fields: Readonly<Record<string, FormFillOverlayField>>;
  /** Only these source fields are offered; by default every field a conversation can give. */
  readonly only?: readonly string[];
}

interface SourceOption {
  readonly value: string | number;
  readonly label: string;
}

function yesNoValues(
  options: readonly SourceOption[],
): { yes: string | number; no: string | number } | null {
  if (options.length !== 2) return null;
  const find = (word: string) =>
    options.find((option) => option.label.trim().toLowerCase() === word);
  const yes = find('да');
  const no = find('нет');
  return yes && no ? { yes: yes.value, no: no.value } : null;
}

function overlaid(field: FormFillField, overlay: FormFillOverlayField | undefined): FormFillField {
  if (!overlay) return field;
  return {
    ...field,
    ...(overlay.label ? { label: overlay.label } : {}),
    ...(overlay.hint ? { hint: overlay.hint } : {}),
    ...(overlay.cues ? { cues: [...overlay.cues] } : {}),
    ...(field.options && overlay.options
      ? {
          options: field.options.map((option) => {
            const cues = overlay.options?.[option.value];
            return cues ? { ...option, cues: [...cues] } : option;
          }),
        }
      : {}),
  };
}

interface Built {
  readonly field: FormFillField;
  readonly back: (value: FormFillValue) => FormFillToolValue | undefined;
}

function choiceField(
  id: string,
  label: string,
  options: readonly SourceOption[],
  multiple: boolean,
): Built {
  const yesNo = multiple ? null : yesNoValues(options);
  if (yesNo) {
    return {
      field: { id, label, type: 'boolean' },
      back: (value) => (typeof value === 'boolean' ? (value ? yesNo.yes : yesNo.no) : undefined),
    };
  }
  const byValue = new Map(options.map((option) => [String(option.value), option.value]));
  return {
    field: {
      id,
      label,
      type: multiple ? 'multi-choice' : 'choice',
      options: options.map((option) => ({ value: String(option.value), label: option.label })),
    },
    back: (value) =>
      Array.isArray(value)
        ? value.map(String)
        : typeof value === 'string'
          ? byValue.get(value)
          : undefined,
  };
}

function binding(
  id: string,
  title: string,
  sections: readonly FormFillSection[],
  built: ReadonlyMap<string, Built>,
  overlay: FormFillOverlay | undefined,
): FormFillBinding {
  const form = parseFormFillForm({
    schemaVersion: FORM_FILL_SCHEMA_VERSION,
    id,
    title,
    sections,
    fields: [...built.values()].map(({ field }) => overlaid(field, overlay?.fields[field.id])),
  });
  return {
    form,
    toSourceValue: (fieldId, value) => built.get(fieldId)?.back(value),
  };
}

function offered(overlay: FormFillOverlay | undefined, id: string): boolean {
  return !overlay?.only || overlay.only.includes(id);
}

/** A calculator's inputs as one section. */
export function formFillFromCalculator(
  calculator: CalculatorSchema,
  overlay?: FormFillOverlay,
): FormFillBinding {
  const built = new Map<string, Built>();
  for (const input of calculator.inputs) {
    if (!offered(overlay, input.id)) continue;
    const label = input.unit ? `${input.label}, ${input.unit}` : input.label;
    if (input.kind === 'select' && input.options && !input.optionGroupInput) {
      built.set(input.id, choiceField(input.id, label, input.options, false));
    } else if (input.kind === 'number') {
      built.set(input.id, {
        field: {
          id: input.id,
          label,
          type: 'number',
          ...(input.minimum !== undefined ? { minimum: input.minimum } : {}),
          ...(input.maximum !== undefined ? { maximum: input.maximum } : {}),
          ...(input.integer ? { integer: true } : {}),
        },
        back: (value) => (typeof value === 'number' ? value : undefined),
      });
    } else if (input.kind === 'checkbox') {
      built.set(input.id, {
        field: { id: input.id, label, type: 'boolean' },
        back: (value) => (typeof value === 'boolean' ? value : undefined),
      });
    } else if (input.kind === 'date' || input.kind === 'text') {
      built.set(input.id, {
        field: { id: input.id, label, type: input.kind },
        back: (value) => (typeof value === 'string' ? value : undefined),
      });
    }
  }
  return binding(
    calculator.id,
    calculator.title,
    [{ id: 'inputs', title: calculator.title, fieldIds: [...built.keys()] }],
    built,
    overlay,
  );
}

/** The questionnaire shape the tool modules carry (`AssessmentDefinitionSchema`). */
export interface FormFillAssessmentSource {
  readonly id: string;
  readonly title: string;
  readonly responseOptions: readonly { readonly value: number; readonly label: string }[];
  readonly scales: readonly { readonly id: string; readonly label: string }[];
  readonly questions: readonly {
    readonly id: string;
    readonly prompt: string;
    readonly scaleId: string;
    readonly responseOptions?: readonly { readonly value: number; readonly label: string }[];
  }[];
}

/** A questionnaire: one section per scale, one choice per question. */
export function formFillFromAssessment(
  assessment: FormFillAssessmentSource,
  overlay?: FormFillOverlay,
): FormFillBinding {
  const built = new Map<string, Built>();
  const sections: FormFillSection[] = [];
  for (const scale of assessment.scales) {
    const ids: string[] = [];
    for (const question of assessment.questions) {
      if (question.scaleId !== scale.id || !offered(overlay, question.id)) continue;
      built.set(
        question.id,
        choiceField(
          question.id,
          question.prompt,
          question.responseOptions ?? assessment.responseOptions,
          false,
        ),
      );
      ids.push(question.id);
    }
    if (ids.length > 0) sections.push({ id: scale.id, title: scale.label, fieldIds: ids });
  }
  return binding(assessment.id, assessment.title, sections, built, overlay);
}

/** Prefill sources a conversation does not replace: the card, the doctor, the organization. */
function prefilledFromRecords(field: FormField): boolean {
  return (field.prefill?.sources ?? []).some((source) => !source.startsWith('episode.'));
}

/**
 * An official blank: its screen sections, keeping the fields a conversation can give — text, date,
 * choice and checkbox fields that are not prefilled from the patient's card, the doctor or the
 * organization; ICD codes, signatures and stamps never.
 */
export function formFillFromOfficialForm(
  form: FormSchema,
  overlay?: FormFillOverlay,
): FormFillBinding {
  const fields = new Map(form.fields.map((field) => [field.id, field]));
  const built = new Map<string, Built>();
  const sections: FormFillSection[] = [];
  for (const section of form.sections) {
    const ids: string[] = [];
    for (const id of section.fieldIds) {
      const field = fields.get(id);
      if (!field || !offered(overlay, id) || prefilledFromRecords(field)) continue;
      let item: Built | null = null;
      if (field.type === 'choice' && field.options) {
        item = choiceField(field.id, field.label, field.options, field.multiple === true);
      } else if (field.type === 'checkbox') {
        item = {
          field: { id: field.id, label: field.label, type: 'boolean' },
          back: (value) => (typeof value === 'boolean' ? value : undefined),
        };
      } else if (field.type === 'text' || field.type === 'date') {
        item = {
          field: {
            id: field.id,
            label: field.label,
            type: field.type,
            ...(field.type === 'text' && field.maxLength ? { maxLength: field.maxLength } : {}),
          },
          back: (value) => (typeof value === 'string' ? value : undefined),
        };
      }
      if (!item) continue;
      built.set(id, item);
      ids.push(id);
    }
    if (ids.length > 0) sections.push({ id: section.id, title: section.title, fieldIds: ids });
  }
  return binding(form.id, `${form.formNumber} ${form.title}`, sections, built, overlay);
}
