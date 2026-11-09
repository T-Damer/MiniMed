/*
 * The worksheet file format (CBT1): a diary or homework sheet the doctor gives a patient — a thought
 * record, a sleep diary, a fear ladder, a coping card, a reading. Types, strict parser and draft
 * helpers only; no storage, so the patient diary can carry a worksheet without the user library
 * (storage: `user-worksheets.ts`). Everything is declared data: the screens and the print render
 * the layout and the fields and never branch on a worksheet id.
 */

export const USER_WORKSHEET_FORMAT = 'minimed-worksheet';
export const USER_WORKSHEET_VERSION = 1;

export const MAX_WORKSHEET_FIELDS = 14;
export const MAX_WORKSHEET_SECTIONS = 20;
export const MAX_WORKSHEET_VARIANTS = 6;
export const MAX_WORKSHEET_SOURCES = 12;
export const MAX_WORKSHEET_OPTIONS = 16;
const MAX_TITLE = 120;
const MAX_LABEL = 120;
const MAX_LINE = 240;
const MAX_HINT = 800;
const MAX_NOTE = 4000;
const MAX_SECTION_TEXT = 6000;
const MAX_ROWS = 40;
/** Worksheet ids: a built-in slug (`cbt-thought-record`) or a doctor's own (`own-…`). */
const WORKSHEET_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
/** Field ids are keys of the patient's diary values (`diary-model.ts` FIELD_ID_PATTERN). */
const FIELD_ID = /^[a-z][a-z0-9-]{0,23}$/u;
const PART_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DOCUMENT_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/u;
const MAX_URL = 400;

export type WorksheetGroup =
  | 'self-monitoring'
  | 'cognitive'
  | 'experiment'
  | 'activation'
  | 'exposure'
  | 'skills'
  | 'education';

export const WORKSHEET_GROUPS: readonly WorksheetGroup[] = [
  'self-monitoring',
  'cognitive',
  'experiment',
  'activation',
  'exposure',
  'skills',
  'education',
];

export const WORKSHEET_GROUP_LABEL: Readonly<Record<WorksheetGroup, string>> = {
  'self-monitoring': 'Самонаблюдение',
  cognitive: 'Когнитивная работа',
  experiment: 'Поведенческий эксперимент',
  activation: 'Поведенческая активация',
  exposure: 'Экспозиция',
  skills: 'Навыки',
  education: 'Психообразование',
};

/**
 * How the sheet is filled and printed:
 * - `log` — one row per event (a thought, an attack, a night, a meal);
 * - `hours` — one row per hour of the day (`hours` gives the span);
 * - `week` — rows grouped by the days of a week;
 * - `ladder` — ordered steps (a fear hierarchy, graded tasks, the downward arrow);
 * - `card` — one card filled together and kept at hand;
 * - `material` — a text to read or a practice to follow, the fields (if any) log the practice.
 */
export type WorksheetLayout = 'log' | 'hours' | 'week' | 'ladder' | 'card' | 'material';

export const WORKSHEET_LAYOUTS: readonly WorksheetLayout[] = [
  'log',
  'hours',
  'week',
  'ladder',
  'card',
  'material',
];

export const WORKSHEET_LAYOUT_LABEL: Readonly<Record<WorksheetLayout, string>> = {
  log: 'Запись на каждый случай',
  hours: 'По часам',
  week: 'На неделю',
  ladder: 'Ступени',
  card: 'Карточка',
  material: 'Материал',
};

export type WorksheetFieldType =
  | 'text'
  | 'long-text'
  | 'number'
  | 'percent'
  | 'scale'
  | 'choice'
  | 'multi'
  | 'time'
  | 'duration'
  | 'date';

export const WORKSHEET_FIELD_TYPES: readonly WorksheetFieldType[] = [
  'text',
  'long-text',
  'number',
  'percent',
  'scale',
  'choice',
  'multi',
  'time',
  'duration',
  'date',
];

export const WORKSHEET_FIELD_TYPE_LABEL: Readonly<Record<WorksheetFieldType, string>> = {
  text: 'Короткий текст',
  'long-text': 'Подробный текст',
  number: 'Число',
  percent: '0–100 %',
  scale: '0–10',
  choice: 'Один вариант',
  multi: 'Несколько вариантов',
  time: 'Время',
  duration: 'Минуты',
  date: 'Дата',
};

export interface WorksheetField {
  /** Stable key of the patient's answer: `[a-z][a-z0-9-]{0,23}`. */
  readonly id: string;
  readonly type: WorksheetFieldType;
  readonly label: string;
  /** What the field means and how to fill it, in plain words; printed under the blank. */
  readonly patientHint: string;
  /** What the answer tells the doctor and how to read it. */
  readonly doctorHint: string;
  /** Number only. */
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  /** Choice and multi only. */
  readonly options?: readonly string[];
  /** Part of the extended version only (a 7-column thought record over the basic 3). */
  readonly extended?: true;
  /** The doctor sees this number on a chart. */
  readonly chart?: true;
}

/** A titled block of the text: the material itself, the steps of a practice, the rules. */
export interface WorksheetSection {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** One kind of the same sheet (exposure in vivo, interoceptive, ERP…): its own explanations. */
export interface WorksheetVariant {
  readonly id: string;
  readonly label: string;
  readonly patientNote: string;
  readonly doctorNote: string;
  /**
   * A procedural line for the patient only («если станет невыносимо, обратитесь к врачу», «обсудим на
   * приёме»): shown where the patient fills or prints the sheet, never on the doctor's template page
   * or in the doctor's explanation (owner 2026-11-09). Not a clinical claim, so it needs no source.
   */
  readonly patientCare?: string;
}

/**
 * A source the sheet's explanations rest on (owner 2026-11-09: every claim has a source). Shown in
 * the «?» under «Источники» as a named row; a КР the app has opens in the reader by `documentId`.
 */
export interface WorksheetSource {
  readonly title: string;
  readonly publisher?: string;
  readonly year?: string;
  /** Where in it: pages, sections. */
  readonly detail?: string;
  readonly url?: string;
  readonly documentId?: string;
}

export interface WorksheetOrigin {
  /** Id of the built-in worksheet this copy was made from. */
  readonly id: string;
  /** Its version (`YYYY-MM-DD`) when copied. */
  readonly version: string;
}

export interface UserWorksheet {
  readonly format: typeof USER_WORKSHEET_FORMAT;
  readonly version: typeof USER_WORKSHEET_VERSION;
  readonly id: string;
  readonly title: string;
  readonly group: WorksheetGroup;
  readonly layout: WorksheetLayout;
  /** One line for lists and pickers. */
  readonly summary: string;
  /** For the doctor: when it is used, what it gives, how to read what the patient writes. */
  readonly doctorNote: string;
  /** For the patient: why it helps, how to fill it, in plain words. */
  readonly patientNote: string;
  /**
   * A procedural line for the patient only («если станет невыносимо, обратитесь к врачу», «обсудим на
   * приёме»): shown where the patient fills or prints the sheet, never on the doctor's template page
   * or in the doctor's explanation (owner 2026-11-09). Not a clinical claim, so it needs no source.
   */
  readonly patientCare?: string;
  readonly fields: readonly WorksheetField[];
  readonly sections: readonly WorksheetSection[];
  readonly variants: readonly WorksheetVariant[];
  /** What the explanations rest on; empty for a doctor's new sheet. */
  readonly sources: readonly WorksheetSource[];
  /** The chosen variant id; absent when the sheet has none. */
  readonly variant?: string;
  /** Show the fields marked `extended`. */
  readonly extended: boolean;
  /** Empty rows on a printed blank (steps of a ladder). */
  readonly rows: number;
  /** `hours` layout: the first and the last hour of the day printed. */
  readonly hours?: { readonly from: number; readonly to: number };
  /**
   * The texts are a draft the doctor has not checked yet (the built-in ones until a doctor saves
   * their own version). Shown to the doctor as one badge; never to the patient.
   */
  readonly draft: boolean;
  /** Built-ins: the date of this edition of the texts. */
  readonly edition?: string;
  readonly basedOn?: WorksheetOrigin;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class WorksheetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorksheetFormatError';
  }
}

type Untrusted = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): Untrusted {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorksheetFormatError(`${label}: ожидался объект.`);
  }
  return value as Untrusted;
}

function hasControlCharacter(value: string, allowLineBreaks: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 && !(allowLineBreaks && code === 0x0a)) return true;
  }
  return false;
}

function text(
  value: unknown,
  label: string,
  max: number,
  options: { readonly lines?: boolean; readonly empty?: boolean } = {},
): string {
  if (value === undefined && options.empty) return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    hasControlCharacter(value, options.lines === true)
  ) {
    throw new WorksheetFormatError(`${label}: некорректный текст.`);
  }
  const trimmed = options.lines ? value.replace(/[ \t]+$/gmu, '').trim() : value.trim();
  if (!trimmed && !options.empty) throw new WorksheetFormatError(`${label}: заполните текст.`);
  return trimmed;
}

function identifier(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new WorksheetFormatError(`${label}: некорректный идентификатор.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new WorksheetFormatError(`${label}: неизвестное значение.`);
  }
  return value as T;
}

function finite(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new WorksheetFormatError(`${label}: некорректное число.`);
  }
  return value;
}

function list(value: unknown, max: number, label: string): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new WorksheetFormatError(`${label}: некорректный список.`);
  }
  return value;
}

function unique<T extends { readonly id: string }>(items: readonly T[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new WorksheetFormatError(`${label}: повторяется «${item.id}».`);
    seen.add(item.id);
  }
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new WorksheetFormatError(`${label}: некорректная дата.`);
  }
  return value;
}

function parseField(value: unknown, index: number): WorksheetField {
  const label = `Поле ${index + 1}`;
  const source = record(value, label);
  const type = oneOf(source['type'], WORKSHEET_FIELD_TYPES, label);
  const field: {
    -readonly [K in keyof WorksheetField]: WorksheetField[K];
  } = {
    id: identifier(source['id'], FIELD_ID, label),
    type,
    label: text(source['label'], label, MAX_LABEL),
    patientHint: text(source['patientHint'], `${label}: пояснение для пациента`, MAX_HINT, {
      lines: true,
      empty: true,
    }),
    doctorHint: text(source['doctorHint'], `${label}: пояснение для врача`, MAX_HINT, {
      lines: true,
      empty: true,
    }),
  };
  if (type === 'number') {
    const unit = text(source['unit'], `${label}: единица`, 24, { empty: true });
    if (unit) field.unit = unit;
    const min = finite(source['min'], `${label}: минимум`);
    const max = finite(source['max'], `${label}: максимум`);
    if (min !== undefined) field.min = min;
    if (max !== undefined) field.max = max;
    if (min !== undefined && max !== undefined && min >= max) {
      throw new WorksheetFormatError(`${label}: минимум должен быть меньше максимума.`);
    }
  }
  if (type === 'choice' || type === 'multi') {
    const options = list(source['options'], MAX_WORKSHEET_OPTIONS, `${label}: варианты`).map(
      (option, optionIndex) => text(option, `${label}: вариант ${optionIndex + 1}`, MAX_LABEL),
    );
    if (options.length < 2) {
      throw new WorksheetFormatError(`${label}: нужно хотя бы два варианта.`);
    }
    if (new Set(options).size !== options.length) {
      throw new WorksheetFormatError(`${label}: варианты повторяются.`);
    }
    field.options = options;
  }
  if (source['extended'] === true) field.extended = true;
  if (source['chart'] === true) {
    if (!isNumericField(type)) {
      throw new WorksheetFormatError(`${label}: на графике бывают только числа.`);
    }
    field.chart = true;
  }
  return field;
}

function parseSection(value: unknown, index: number): WorksheetSection {
  const label = `Раздел ${index + 1}`;
  const source = record(value, label);
  return {
    id: identifier(source['id'], PART_ID, label),
    title: text(source['title'], label, MAX_LABEL),
    text: text(source['text'], label, MAX_SECTION_TEXT, { lines: true }),
  };
}

function parseVariant(value: unknown, index: number): WorksheetVariant {
  const label = `Вариант ${index + 1}`;
  const source = record(value, label);
  const patientCare = careLine(source['patientCare'], `${label}: только пациенту`);
  return {
    ...(patientCare ? { patientCare } : {}),
    id: identifier(source['id'], PART_ID, label),
    label: text(source['label'], label, MAX_LABEL),
    patientNote: text(source['patientNote'], `${label}: для пациента`, MAX_NOTE, {
      lines: true,
      empty: true,
    }),
    doctorNote: text(source['doctorNote'], `${label}: для врача`, MAX_NOTE, {
      lines: true,
      empty: true,
    }),
  };
}

function careLine(value: unknown, label: string): string | undefined {
  return value === undefined
    ? undefined
    : text(value, label, MAX_HINT, { lines: true, empty: true });
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  return value === undefined ? undefined : text(value, label, max);
}

function parseSource(value: unknown, index: number): WorksheetSource {
  const label = `Источник ${index + 1}`;
  const source = record(value, label);
  const publisher = optionalText(source['publisher'], `${label}: издатель`, MAX_LABEL);
  const year = optionalText(source['year'], `${label}: год`, 40);
  const detail = optionalText(source['detail'], `${label}: где`, MAX_LINE);
  const url = optionalText(source['url'], `${label}: ссылка`, MAX_URL);
  if (url !== undefined && !/^https:\/\/[^\s]+$/u.test(url)) {
    throw new WorksheetFormatError(`${label}: ссылка должна начинаться с https://.`);
  }
  const documentId =
    source['documentId'] === undefined
      ? undefined
      : identifier(source['documentId'], DOCUMENT_ID, `${label}: документ`);
  return {
    title: text(source['title'], label, MAX_LINE),
    ...(publisher ? { publisher } : {}),
    ...(year ? { year } : {}),
    ...(detail ? { detail } : {}),
    ...(url ? { url } : {}),
    ...(documentId ? { documentId } : {}),
  };
}

export function isNumericField(type: WorksheetFieldType): boolean {
  return type === 'number' || type === 'percent' || type === 'scale' || type === 'duration';
}

/** Strict parser for a worksheet file, a built-in seed entry or one embedded in a diary plan. */
export function parseUserWorksheet(value: unknown): UserWorksheet {
  const source = record(value, 'Рабочий лист');
  if (source['format'] !== USER_WORKSHEET_FORMAT) {
    throw new WorksheetFormatError('Это не рабочий лист MiniMed.');
  }
  if (source['version'] !== USER_WORKSHEET_VERSION) {
    throw new WorksheetFormatError('Версия рабочего листа не поддерживается.');
  }
  const layout = oneOf(source['layout'], WORKSHEET_LAYOUTS, 'Вид листа');
  const fields = list(source['fields'], MAX_WORKSHEET_FIELDS, 'Поля').map(parseField);
  const sections = list(source['sections'], MAX_WORKSHEET_SECTIONS, 'Разделы').map(parseSection);
  const variants = list(source['variants'], MAX_WORKSHEET_VARIANTS, 'Варианты').map(parseVariant);
  const sources = list(source['sources'], MAX_WORKSHEET_SOURCES, 'Источники').map(parseSource);
  const patientCare = careLine(source['patientCare'], 'Только пациенту');
  unique(fields, 'Поля');
  unique(sections, 'Разделы');
  unique(variants, 'Варианты');
  if (layout !== 'material' && fields.length === 0) {
    throw new WorksheetFormatError('В листе нет ни одного поля.');
  }
  if (layout === 'material' && sections.length === 0) {
    throw new WorksheetFormatError('В материале нет текста.');
  }
  if (fields.length > 0 && fields.every((field) => field.extended)) {
    throw new WorksheetFormatError('Хотя бы одно поле должно быть в основной версии.');
  }
  const variant =
    source['variant'] === undefined
      ? undefined
      : identifier(source['variant'], PART_ID, 'Выбранный вариант');
  if (variant !== undefined && !variants.some((item) => item.id === variant)) {
    throw new WorksheetFormatError('Выбранного варианта нет в списке.');
  }
  const rowsValue = finite(source['rows'], 'Строк на бланке') ?? defaultRows(layout);
  if (!Number.isInteger(rowsValue) || rowsValue < 1 || rowsValue > MAX_ROWS) {
    throw new WorksheetFormatError('Строк на бланке: от 1 до 40.');
  }
  let hours: UserWorksheet['hours'];
  if (layout === 'hours') {
    const span = source['hours'] === undefined ? DEFAULT_HOURS : record(source['hours'], 'Часы');
    const from = finite(span['from'], 'Часы: с');
    const to = finite(span['to'], 'Часы: до');
    if (
      from === undefined ||
      to === undefined ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to > 24 ||
      from >= to
    ) {
      throw new WorksheetFormatError('Часы: от 0 до 24, начало раньше конца.');
    }
    hours = { from, to };
  }
  let basedOn: WorksheetOrigin | undefined;
  if (source['basedOn'] !== undefined) {
    const origin = record(source['basedOn'], 'Основа');
    const version = origin['version'];
    if (typeof version !== 'string' || !DATE.test(version)) {
      throw new WorksheetFormatError('Основа: некорректная версия.');
    }
    basedOn = { id: identifier(origin['id'], WORKSHEET_ID, 'Основа'), version };
  }
  const edition = source['edition'];
  if (edition !== undefined && (typeof edition !== 'string' || !DATE.test(edition))) {
    throw new WorksheetFormatError('Редакция: некорректная дата.');
  }
  return {
    format: USER_WORKSHEET_FORMAT,
    version: USER_WORKSHEET_VERSION,
    id: identifier(source['id'], WORKSHEET_ID, 'Рабочий лист'),
    title: text(source['title'], 'Название', MAX_TITLE),
    group: oneOf(source['group'], WORKSHEET_GROUPS, 'Раздел'),
    layout,
    summary: text(source['summary'], 'Кратко', MAX_LINE, { empty: true }),
    doctorNote: text(source['doctorNote'], 'Пояснение для врача', MAX_NOTE, {
      lines: true,
      empty: true,
    }),
    patientNote: text(source['patientNote'], 'Пояснение для пациента', MAX_NOTE, {
      lines: true,
      empty: true,
    }),
    ...(patientCare ? { patientCare } : {}),
    fields,
    sections,
    variants,
    sources,
    ...(variant ? { variant } : {}),
    extended: source['extended'] === true,
    rows: rowsValue,
    ...(hours ? { hours } : {}),
    draft: source['draft'] === true,
    ...(typeof edition === 'string' ? { edition } : {}),
    ...(basedOn ? { basedOn } : {}),
    createdAt: timestamp(source['createdAt'], 'Создан'),
    updatedAt: timestamp(source['updatedAt'], 'Изменён'),
  };
}

const DEFAULT_HOURS = { from: 6, to: 24 } as const;

function defaultRows(layout: WorksheetLayout): number {
  if (layout === 'ladder') return 10;
  if (layout === 'card') return 1;
  // A material's rows log the practice (relaxation sessions over a week).
  if (layout === 'material') return 7;
  if (layout === 'week') return 3;
  return 8;
}

/** The fields of the version the doctor chose (basic or extended). */
export function activeWorksheetFields(worksheet: UserWorksheet): readonly WorksheetField[] {
  return worksheet.fields.filter((field) => worksheet.extended || !field.extended);
}

export function worksheetHasExtendedFields(worksheet: UserWorksheet): boolean {
  return worksheet.fields.some((field) => field.extended);
}

export function selectedWorksheetVariant(worksheet: UserWorksheet): WorksheetVariant | undefined {
  return worksheet.variants.find((variant) => variant.id === worksheet.variant);
}

/** The patient's explanation: the sheet's own, then the chosen variant's. */
export function worksheetPatientNote(worksheet: UserWorksheet): string {
  const variant = selectedWorksheetVariant(worksheet);
  return [worksheet.patientNote, variant?.patientNote ?? ''].filter(Boolean).join('\n\n');
}

/** The patient-only lines (`patientCare`): the sheet's own, then the chosen variant's. */
export function worksheetPatientCare(worksheet: UserWorksheet): string {
  const variant = selectedWorksheetVariant(worksheet);
  return [worksheet.patientCare ?? '', variant?.patientCare ?? ''].filter(Boolean).join('\n\n');
}

export function worksheetDoctorNote(worksheet: UserWorksheet): string {
  const variant = selectedWorksheetVariant(worksheet);
  return [worksheet.doctorNote, variant?.doctorNote ?? ''].filter(Boolean).join('\n\n');
}

/** The printed hours of an `hours` sheet, each as `HH:00`. */
export function worksheetHourRows(worksheet: UserWorksheet): readonly string[] {
  const span = worksheet.hours ?? DEFAULT_HOURS;
  const rows: string[] = [];
  for (let hour = span.from; hour < span.to; hour += 1) {
    rows.push(`${String(hour).padStart(2, '0')}:00`);
  }
  return rows;
}

export const WORKSHEET_WEEKDAYS = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
] as const;

/** A doctor's own copy of a built-in sheet: a new id, the origin kept, the draft mark kept. */
export function copyWorksheet(
  source: UserWorksheet,
  now = new Date().toISOString(),
): UserWorksheet {
  const { edition: _edition, ...rest } = source;
  return {
    ...rest,
    id: newWorksheetId(),
    basedOn:
      source.basedOn ?? (source.edition ? { id: source.id, version: source.edition } : undefined),
    createdAt: now,
    updatedAt: now,
  } as UserWorksheet;
}

export function newWorksheetId(): string {
  return `own-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

/** A field id not used yet in this sheet. */
export function freeWorksheetFieldId(worksheet: UserWorksheet): string {
  const used = new Set(worksheet.fields.map((field) => field.id));
  for (let index = 1; ; index += 1) {
    const id = `f${index}`;
    if (!used.has(id)) return id;
  }
}

export function freeWorksheetSectionId(worksheet: UserWorksheet): string {
  const used = new Set(worksheet.sections.map((section) => section.id));
  for (let index = 1; ; index += 1) {
    const id = `s${index}`;
    if (!used.has(id)) return id;
  }
}

/** A new empty sheet of the doctor's own. */
export function createUserWorksheetDraft(now = new Date().toISOString()): UserWorksheet {
  return {
    format: USER_WORKSHEET_FORMAT,
    version: USER_WORKSHEET_VERSION,
    id: newWorksheetId(),
    title: 'Новый дневник',
    group: 'self-monitoring',
    layout: 'log',
    summary: '',
    doctorNote: '',
    patientNote: '',
    fields: [
      {
        id: 'f1',
        type: 'long-text',
        label: 'Что произошло',
        patientHint: '',
        doctorHint: '',
      },
    ],
    sections: [],
    variants: [],
    sources: [],
    extended: false,
    rows: 8,
    draft: false,
    createdAt: now,
    updatedAt: now,
  };
}
