/**
 * Pure edits of a doctor's own worksheet (CBT1) for the editor page: fields, text sections and
 * variants. Each returns a new sheet; the editor validates it with the format parser on save.
 */
import {
  freeWorksheetFieldId,
  freeWorksheetSectionId,
  isNumericField,
  MAX_WORKSHEET_FIELDS,
  MAX_WORKSHEET_SECTIONS,
  MAX_WORKSHEET_VARIANTS,
  type UserWorksheet,
  type WorksheetField,
  type WorksheetFieldType,
  type WorksheetSection,
  type WorksheetVariant,
} from '@/state/user-worksheet-format';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function move<T>(items: readonly T[], index: number, delta: -1 | 1): readonly T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

export function canAddWorksheetField(worksheet: UserWorksheet): boolean {
  return worksheet.fields.length < MAX_WORKSHEET_FIELDS;
}

export function addWorksheetField(worksheet: UserWorksheet): UserWorksheet {
  if (!canAddWorksheetField(worksheet)) return worksheet;
  const field: WorksheetField = {
    id: freeWorksheetFieldId(worksheet),
    type: 'text',
    label: 'Новое поле',
    patientHint: '',
    doctorHint: '',
  };
  return { ...worksheet, fields: [...worksheet.fields, field] };
}

/** A change of some keys of a field; `undefined` removes an optional key (a unit, a mark). */
export type WorksheetFieldPatch = {
  readonly [K in Exclude<keyof WorksheetField, 'id'>]?: WorksheetField[K] | undefined;
};

export function updateWorksheetField(
  worksheet: UserWorksheet,
  id: string,
  patch: WorksheetFieldPatch,
): UserWorksheet {
  return {
    ...worksheet,
    fields: worksheet.fields.map((field) => {
      if (field.id !== id) return field;
      const merged: Record<string, unknown> = { ...field, ...patch };
      for (const key of Object.keys(merged)) {
        if (merged[key] === undefined) delete merged[key];
      }
      return merged as unknown as WorksheetField;
    }),
  };
}

/**
 * A new type keeps what still applies: options only for a choice (two placeholders when there
 * were none), unit and range only for a number, the chart only for numbers.
 */
export function setWorksheetFieldType(
  worksheet: UserWorksheet,
  id: string,
  type: WorksheetFieldType,
): UserWorksheet {
  return {
    ...worksheet,
    fields: worksheet.fields.map((field) => {
      if (field.id !== id) return field;
      const {
        options: _options,
        unit: _unit,
        min: _min,
        max: _max,
        chart: _chart,
        ...rest
      } = field;
      const next: Mutable<WorksheetField> = { ...rest, type };
      if (type === 'choice' || type === 'multi') {
        next.options = field.options && field.options.length >= 2 ? field.options : ['да', 'нет'];
      }
      if (type === 'number') {
        if (field.unit) next.unit = field.unit;
        if (field.min !== undefined) next.min = field.min;
        if (field.max !== undefined) next.max = field.max;
      }
      if (field.chart && isNumericField(type)) next.chart = true;
      return next;
    }),
  };
}

export function removeWorksheetField(worksheet: UserWorksheet, id: string): UserWorksheet {
  return { ...worksheet, fields: worksheet.fields.filter((field) => field.id !== id) };
}

export function moveWorksheetField(
  worksheet: UserWorksheet,
  id: string,
  delta: -1 | 1,
): UserWorksheet {
  const index = worksheet.fields.findIndex((field) => field.id === id);
  return { ...worksheet, fields: move(worksheet.fields, index, delta) };
}

/** Options typed one per line; blank lines dropped. */
export function optionsFromText(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function canAddWorksheetSection(worksheet: UserWorksheet): boolean {
  return worksheet.sections.length < MAX_WORKSHEET_SECTIONS;
}

export function addWorksheetSection(worksheet: UserWorksheet): UserWorksheet {
  if (!canAddWorksheetSection(worksheet)) return worksheet;
  const section: WorksheetSection = {
    id: freeWorksheetSectionId(worksheet),
    title: 'Новый раздел',
    text: 'Текст раздела.',
  };
  return { ...worksheet, sections: [...worksheet.sections, section] };
}

export function updateWorksheetSection(
  worksheet: UserWorksheet,
  id: string,
  patch: Partial<Omit<WorksheetSection, 'id'>>,
): UserWorksheet {
  return {
    ...worksheet,
    sections: worksheet.sections.map((section) =>
      section.id === id ? { ...section, ...patch } : section,
    ),
  };
}

export function removeWorksheetSection(worksheet: UserWorksheet, id: string): UserWorksheet {
  return { ...worksheet, sections: worksheet.sections.filter((section) => section.id !== id) };
}

export function moveWorksheetSection(
  worksheet: UserWorksheet,
  id: string,
  delta: -1 | 1,
): UserWorksheet {
  const index = worksheet.sections.findIndex((section) => section.id === id);
  return { ...worksheet, sections: move(worksheet.sections, index, delta) };
}

export function updateWorksheetVariant(
  worksheet: UserWorksheet,
  id: string,
  patch: Partial<Omit<WorksheetVariant, 'id'>>,
): UserWorksheet {
  return {
    ...worksheet,
    variants: worksheet.variants.map((variant) =>
      variant.id === id ? { ...variant, ...patch } : variant,
    ),
  };
}

/** Removing the chosen variant chooses the first one left (or none). */
export function removeWorksheetVariant(worksheet: UserWorksheet, id: string): UserWorksheet {
  const variants = worksheet.variants.filter((variant) => variant.id !== id);
  const { variant: _variant, ...rest } = worksheet;
  const chosen = worksheet.variant === id ? variants[0]?.id : worksheet.variant;
  return { ...rest, variants, ...(chosen ? { variant: chosen } : {}) };
}

export function addWorksheetVariant(worksheet: UserWorksheet): UserWorksheet {
  if (worksheet.variants.length >= MAX_WORKSHEET_VARIANTS) return worksheet;
  const used = new Set(worksheet.variants.map((variant) => variant.id));
  let index = 1;
  while (used.has(`v${index}`)) index += 1;
  const variant: WorksheetVariant = {
    id: `v${index}`,
    label: 'Новый вариант',
    patientNote: '',
    doctorNote: '',
  };
  return {
    ...worksheet,
    variants: [...worksheet.variants, variant],
    variant: worksheet.variant ?? variant.id,
  };
}
