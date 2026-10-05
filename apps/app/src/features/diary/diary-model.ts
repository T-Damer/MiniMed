/**
 * Patient self-monitoring diary exchanged without a server: the doctor hands over an invitation
 * link, the patient keeps entries in their own browser and shows them back as QR codes.
 *
 * Format v2 is schema-driven: an invitation declares the fields a patient fills in and, when the
 * doctor prescribes something, a plan (medicines, a feeding schedule). Built-in diaries are only
 * templates of that schema, and a doctor can compose a custom one. v1 invitations and stored
 * diaries (blood pressure, glucose, medication) are converted on read.
 * Everything that crosses a device boundary is validated here.
 */

export const DIARY_FORMAT_VERSION = 2 as const;

export type DiaryFieldType = 'number' | 'choice' | 'multi' | 'flag' | 'count' | 'text' | 'plan';

export const DIARY_FIELD_TYPES: readonly DiaryFieldType[] = [
  'number',
  'choice',
  'multi',
  'flag',
  'count',
  'text',
  'plan',
];

export const DIARY_FIELD_TYPE_LABEL: Readonly<Record<DiaryFieldType, string>> = {
  number: 'Число',
  choice: 'Один вариант',
  multi: 'Несколько вариантов',
  flag: 'Отметка «да / нет»',
  count: 'Сколько раз',
  text: 'Свободный текст',
  plan: 'Пункт назначения врача',
};

/** Maps a numeric field onto a patient-card metric and a LOINC code for FHIR export. */
export interface DiaryFieldMetric {
  readonly metricId: string;
  readonly label: string;
  /** Patient-card unit when it differs from the field unit (grams entered, kilograms charted). */
  readonly unit?: string;
  /** Multiplier from the field unit to `unit`. */
  readonly factor?: number;
  readonly loinc?: string;
  readonly ucum?: string;
}

export interface DiaryField {
  /** Stable key inside one diary: `[a-z][a-z0-9-]{0,23}`. */
  readonly id: string;
  readonly type: DiaryFieldType;
  readonly label: string;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly required?: boolean;
  /** Numeric field that must stay below another numeric field (diastolic < systolic). */
  readonly lessThan?: string;
  /** Plan field: ask whether the planned item was taken or skipped. */
  readonly trackDone?: boolean;
  readonly metric?: DiaryFieldMetric;
}

export interface DiaryPlanItem {
  readonly id: string;
  readonly name: string;
  readonly dose?: string;
  readonly schedule?: string;
  /**
   * The doctor removed this item from the plan in a newer link. Entries already made for it keep
   * resolving, but the patient is no longer offered it.
   */
  readonly ended?: boolean;
}

/** What the doctor gives the patient. Contains no patient identity. */
export interface DiaryInvitation {
  readonly v: typeof DIARY_FORMAT_VERSION;
  readonly id: string;
  /** Built-in template id, or `custom`. Only used for presentation. */
  readonly template: string;
  readonly title: string;
  readonly issuedAt: string;
  readonly fields: readonly DiaryField[];
  readonly plan?: readonly DiaryPlanItem[];
  readonly planTitle?: string;
  readonly doctor?: string;
  readonly note?: string;
}

export interface DiaryPlanValue {
  /** Plan item id, absent when the patient typed something not in the plan. */
  readonly item?: string;
  readonly other?: string;
  readonly done?: boolean;
}

export type DiaryValue = number | string | boolean | readonly string[] | DiaryPlanValue;

export interface DiaryEntry {
  readonly id: string;
  /** ISO timestamp of the measurement or event, as entered by the patient. */
  readonly at: string;
  readonly values: Readonly<Record<string, DiaryValue>>;
  readonly note?: string;
}

/** What the patient shows back. The invitation is repeated so the doctor sees the context. */
export interface DiaryResults {
  readonly v: typeof DIARY_FORMAT_VERSION;
  readonly invitation: DiaryInvitation;
  readonly entries: readonly DiaryEntry[];
}

export class DiaryFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiaryFormatError';
  }
}

export const MAX_DIARY_ENTRIES = 1500;
export const MAX_DIARY_FIELDS = 16;
export const MAX_DIARY_OPTIONS = 16;
export const MAX_DIARY_PLAN_ITEMS = 30;
const MAX_TEXT = 200;
const ID_PATTERN = /^[a-z0-9]{6,24}$/u;
const FIELD_ID_PATTERN = /^[a-z][a-z0-9-]{0,23}$/u;
const PLAN_ID_PATTERN = /^[a-z0-9-]{1,24}$/u;
const EARLIEST_ENTRY = Date.UTC(2000, 0, 1);
const NUMBER_LIMIT = 1_000_000;

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DiaryFormatError(`${label}: ожидался объект.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

function text(value: unknown, label: string, optional: true): string | undefined;
function text(value: unknown, label: string, optional?: false): string;
function text(value: unknown, label: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT || hasControlCharacter(value)) {
    throw new DiaryFormatError(`${label}: некорректный текст.`);
  }
  const trimmed = value.trim();
  if (!trimmed && !optional) throw new DiaryFormatError(`${label}: значение обязательно.`);
  return trimmed || undefined;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new DiaryFormatError(`${label}: некорректный идентификатор.`);
  }
  return value;
}

function timestamp(value: unknown, label: string, now: number): string {
  if (typeof value !== 'string') throw new DiaryFormatError(`${label}: нет даты.`);
  const time = Date.parse(value);
  // A day of slack covers devices whose clock or time zone is slightly off.
  if (!Number.isFinite(time) || time < EARLIEST_ENTRY || time > now + 86_400_000) {
    throw new DiaryFormatError(`${label}: дата вне допустимого диапазона.`);
  }
  return new Date(time).toISOString();
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > NUMBER_LIMIT) {
    throw new DiaryFormatError(`${label}: ожидалось число.`);
  }
  return value;
}

export function createDiaryId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('') + Date.now().toString(36);
}

// --- Schema ----------------------------------------------------------------------------------

function parseMetric(value: unknown): DiaryFieldMetric | undefined {
  if (value === undefined) return undefined;
  const source = record(value, 'Показатель');
  const metricId = source['metricId'];
  if (typeof metricId !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/u.test(metricId)) {
    throw new DiaryFormatError('Показатель: некорректный идентификатор.');
  }
  const loinc = source['loinc'];
  if (loinc !== undefined && (typeof loinc !== 'string' || !/^\d{1,7}-\d$/u.test(loinc))) {
    throw new DiaryFormatError('Показатель: некорректный код LOINC.');
  }
  const ucum = text(source['ucum'], 'Единица UCUM', true);
  const unit = text(source['unit'], 'Единица показателя', true);
  const factor = source['factor'] === undefined ? undefined : finite(source['factor'], 'Множитель');
  if (factor !== undefined && factor <= 0) throw new DiaryFormatError('Множитель больше нуля.');
  return {
    metricId,
    label: text(source['label'], 'Название показателя'),
    ...(unit ? { unit } : {}),
    ...(factor === undefined ? {} : { factor }),
    ...(typeof loinc === 'string' ? { loinc } : {}),
    ...(ucum ? { ucum } : {}),
  };
}

function parseField(value: unknown, index: number): DiaryField {
  const source = record(value, `Поле ${index + 1}`);
  const id = source['id'];
  if (typeof id !== 'string' || !FIELD_ID_PATTERN.test(id)) {
    throw new DiaryFormatError(`Поле ${index + 1}: некорректный идентификатор.`);
  }
  const type = source['type'];
  if (typeof type !== 'string' || !DIARY_FIELD_TYPES.includes(type as DiaryFieldType)) {
    throw new DiaryFormatError(`Поле ${index + 1}: неизвестный тип.`);
  }
  const label = text(source['label'], `Поле ${index + 1}`);
  const unit = text(source['unit'], 'Единица', true);
  const min = source['min'] === undefined ? undefined : finite(source['min'], 'Минимум');
  const max = source['max'] === undefined ? undefined : finite(source['max'], 'Максимум');
  if (min !== undefined && max !== undefined && min >= max) {
    throw new DiaryFormatError(`«${label}»: минимум должен быть меньше максимума.`);
  }
  const step = source['step'] === undefined ? undefined : finite(source['step'], 'Шаг');
  if (step !== undefined && step <= 0) throw new DiaryFormatError(`«${label}»: шаг больше нуля.`);
  let options: string[] | undefined;
  if (type === 'choice' || type === 'multi') {
    const list = source['options'];
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_DIARY_OPTIONS) {
      throw new DiaryFormatError(`«${label}»: нужно от 1 до ${MAX_DIARY_OPTIONS} вариантов.`);
    }
    options = list.map((option) => text(option, `Вариант «${label}»`));
    if (new Set(options).size !== options.length) {
      throw new DiaryFormatError(`«${label}»: варианты повторяются.`);
    }
  }
  const lessThan = source['lessThan'];
  if (
    lessThan !== undefined &&
    (typeof lessThan !== 'string' || !FIELD_ID_PATTERN.test(lessThan))
  ) {
    throw new DiaryFormatError(`«${label}»: некорректная связь полей.`);
  }
  const metric = parseMetric(source['metric']);
  return {
    id,
    type: type as DiaryFieldType,
    label,
    ...(unit ? { unit } : {}),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(step === undefined ? {} : { step }),
    ...(options ? { options } : {}),
    ...(source['required'] === true ? { required: true } : {}),
    ...(typeof lessThan === 'string' ? { lessThan } : {}),
    ...(source['trackDone'] === true && type === 'plan' ? { trackDone: true } : {}),
    ...(metric && type === 'number' ? { metric } : {}),
  };
}

function parsePlan(value: unknown): DiaryPlanItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_DIARY_PLAN_ITEMS) {
    throw new DiaryFormatError('Назначение врача некорректно.');
  }
  const items = value.map((item, index) => {
    const source = record(item, `Пункт назначения ${index + 1}`);
    const id = source['id'];
    if (typeof id !== 'string' || !PLAN_ID_PATTERN.test(id)) {
      throw new DiaryFormatError(`Пункт назначения ${index + 1}: некорректный идентификатор.`);
    }
    const dose = text(source['dose'], 'Доза', true);
    const schedule = text(source['schedule'], 'Когда', true);
    return {
      id,
      name: text(source['name'], `Пункт назначения ${index + 1}`),
      ...(dose ? { dose } : {}),
      ...(schedule ? { schedule } : {}),
      ...(source['ended'] === true ? { ended: true } : {}),
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new DiaryFormatError('Пункты назначения повторяются.');
  }
  return items;
}

function parseInvitationV2(
  source: Readonly<Record<string, unknown>>,
  now: number,
): DiaryInvitation {
  const fieldsValue = source['fields'];
  if (
    !Array.isArray(fieldsValue) ||
    fieldsValue.length < 1 ||
    fieldsValue.length > MAX_DIARY_FIELDS
  ) {
    throw new DiaryFormatError(`В дневнике должно быть от 1 до ${MAX_DIARY_FIELDS} полей.`);
  }
  const fields = fieldsValue.map(parseField);
  const ids = new Set(fields.map((field) => field.id));
  if (ids.size !== fields.length) throw new DiaryFormatError('Поля дневника повторяются.');
  for (const field of fields) {
    if (!field.lessThan) continue;
    const other = fields.find((candidate) => candidate.id === field.lessThan);
    if (!other || other.type !== 'number' || field.type !== 'number') {
      throw new DiaryFormatError(`«${field.label}»: связанное поле не найдено.`);
    }
  }
  const plan = parsePlan(source['plan']);
  const template = source['template'];
  if (typeof template !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/u.test(template)) {
    throw new DiaryFormatError('Неизвестный шаблон дневника.');
  }
  const planTitle = text(source['planTitle'], 'Название назначения', true);
  const doctor = text(source['doctor'], 'Врач', true);
  const note = text(source['note'], 'Комментарий врача', true);
  return {
    v: DIARY_FORMAT_VERSION,
    id: identifier(source['id'], 'Дневник'),
    template,
    title: text(source['title'], 'Название дневника'),
    issuedAt: timestamp(source['issuedAt'], 'Дата выдачи', now),
    fields,
    ...(plan?.length ? { plan } : {}),
    ...(planTitle ? { planTitle } : {}),
    ...(doctor ? { doctor } : {}),
    ...(note ? { note } : {}),
  };
}

// --- v1 compatibility ------------------------------------------------------------------------

const V1_GLUCOSE_CONTEXT: Readonly<Record<string, string>> = {
  fasting: 'натощак',
  'before-meal': 'перед едой',
  'after-meal': 'после еды',
  bedtime: 'перед сном',
  other: 'другое',
};

function v1Invitation(source: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kind = source['kind'];
  const template =
    kind === 'blood-pressure' ? 'blood-pressure' : kind === 'glucose' ? 'glucose' : 'medication';
  const base = diaryTemplate(template);
  if (!base || !['blood-pressure', 'glucose', 'medication'].includes(String(kind))) {
    throw new DiaryFormatError('Неизвестный тип дневника.');
  }
  const medications = Array.isArray(source['medications']) ? source['medications'] : undefined;
  if (kind === 'medication' && !medications?.length) {
    throw new DiaryFormatError('В дневнике приёма нет ни одного препарата.');
  }
  return {
    v: DIARY_FORMAT_VERSION,
    id: source['id'],
    template,
    title: base.title,
    issuedAt: source['issuedAt'],
    fields: base.fields,
    ...(medications
      ? {
          plan: medications.map((item, index) => ({
            ...(typeof item === 'object' && item !== null ? item : {}),
            id: `m${index}`,
          })),
        }
      : {}),
    ...(base.planTitle ? { planTitle: base.planTitle } : {}),
    ...(source['doctor'] === undefined ? {} : { doctor: source['doctor'] }),
    ...(source['note'] === undefined ? {} : { note: source['note'] }),
  };
}

function v1Entry(invitation: DiaryInvitation, source: Readonly<Record<string, unknown>>): unknown {
  const common = {
    id: source['id'],
    at: source['at'],
    ...(source['note'] === undefined ? {} : { note: source['note'] }),
  };
  if (invitation.template === 'blood-pressure') {
    return {
      ...common,
      values: {
        systolic: source['systolic'],
        diastolic: source['diastolic'],
        ...(source['pulse'] === undefined ? {} : { pulse: source['pulse'] }),
      },
    };
  }
  if (invitation.template === 'glucose') {
    const context = V1_GLUCOSE_CONTEXT[String(source['context'])];
    return {
      ...common,
      values: { mmol: source['mmol'], ...(context ? { context } : {}) },
    };
  }
  return {
    ...common,
    values: { medication: { item: `m${String(source['medication'])}`, done: source['taken'] } },
  };
}

export function parseDiaryInvitation(value: unknown, now = Date.now()): DiaryInvitation {
  const source = record(value, 'Приглашение');
  if (source['v'] === 1) return parseInvitationV2(v1Invitation(source), now);
  if (source['v'] !== DIARY_FORMAT_VERSION) {
    throw new DiaryFormatError('Неподдерживаемая версия дневника.');
  }
  return parseInvitationV2(source, now);
}

// --- Entries ---------------------------------------------------------------------------------

function parseValue(field: DiaryField, value: unknown, invitation: DiaryInvitation): DiaryValue {
  switch (field.type) {
    case 'number':
    case 'count': {
      const number = finite(value, field.label);
      if (field.type === 'count' && (!Number.isInteger(number) || number < 0)) {
        throw new DiaryFormatError(`«${field.label}»: нужно целое число от нуля.`);
      }
      if (
        (field.min !== undefined && number < field.min) ||
        (field.max !== undefined && number > field.max)
      ) {
        throw new DiaryFormatError(
          `«${field.label}»: значение вне диапазона ${field.min ?? '…'}–${field.max ?? '…'}.`,
        );
      }
      return number;
    }
    case 'choice': {
      if (typeof value !== 'string' || !field.options?.includes(value)) {
        throw new DiaryFormatError(`«${field.label}»: неизвестный вариант.`);
      }
      return value;
    }
    case 'multi': {
      if (!Array.isArray(value) || value.length > MAX_DIARY_OPTIONS) {
        throw new DiaryFormatError(`«${field.label}»: некорректный выбор.`);
      }
      const chosen = [...new Set(value)];
      for (const option of chosen) {
        if (typeof option !== 'string' || !field.options?.includes(option)) {
          throw new DiaryFormatError(`«${field.label}»: неизвестный вариант.`);
        }
      }
      return chosen as string[];
    }
    case 'flag': {
      if (typeof value !== 'boolean')
        throw new DiaryFormatError(`«${field.label}»: ожидалось да или нет.`);
      return value;
    }
    case 'text':
      return text(value, field.label);
    case 'plan': {
      const source = record(value, field.label);
      const item = source['item'];
      if (item !== undefined && !invitation.plan?.some((candidate) => candidate.id === item)) {
        throw new DiaryFormatError(
          `«${field.label}»: запись ссылается на неизвестный пункт назначения.`,
        );
      }
      const other = text(source['other'], field.label, true);
      if (item === undefined && !other) {
        throw new DiaryFormatError(`«${field.label}»: выберите пункт или впишите свой.`);
      }
      const done = source['done'];
      if (done !== undefined && typeof done !== 'boolean') {
        throw new DiaryFormatError(`«${field.label}»: не указано, выполнено ли.`);
      }
      return {
        ...(typeof item === 'string' ? { item } : {}),
        ...(other && item === undefined ? { other } : {}),
        ...(typeof done === 'boolean' ? { done } : {}),
      };
    }
  }
}

export function parseDiaryEntry(
  invitation: DiaryInvitation,
  value: unknown,
  now = Date.now(),
): DiaryEntry {
  let source = record(value, 'Запись');
  if (source['values'] === undefined) source = record(v1Entry(invitation, source), 'Запись');
  const note = text(source['note'], 'Комментарий', true);
  const raw = record(source['values'], 'Значения записи');
  const values: Record<string, DiaryValue> = {};
  for (const field of invitation.fields) {
    const current = raw[field.id];
    const empty =
      current === undefined ||
      current === null ||
      current === '' ||
      (Array.isArray(current) && current.length === 0);
    if (empty) {
      if (field.required) throw new DiaryFormatError(`«${field.label}»: заполните поле.`);
      continue;
    }
    values[field.id] = parseValue(field, current, invitation);
  }
  for (const key of Object.keys(raw)) {
    if (!invitation.fields.some((field) => field.id === key)) {
      throw new DiaryFormatError('Запись содержит неизвестное поле.');
    }
  }
  for (const field of invitation.fields) {
    const own = values[field.id];
    const other = field.lessThan ? values[field.lessThan] : undefined;
    if (typeof own === 'number' && typeof other === 'number' && own >= other) {
      const target = invitation.fields.find((candidate) => candidate.id === field.lessThan);
      throw new DiaryFormatError(
        `«${field.label}» должно быть меньше, чем «${target?.label ?? ''}».`,
      );
    }
  }
  if (Object.keys(values).length === 0 && !note) {
    throw new DiaryFormatError('Заполните хотя бы одно поле.');
  }
  return {
    id: identifier(source['id'], 'Запись'),
    at: timestamp(source['at'], 'Дата записи', now),
    values,
    ...(note ? { note } : {}),
  };
}

export function parseDiaryResults(value: unknown, now = Date.now()): DiaryResults {
  const source = record(value, 'Дневник');
  if (source['v'] !== DIARY_FORMAT_VERSION && source['v'] !== 1) {
    throw new DiaryFormatError('Неподдерживаемая версия дневника.');
  }
  const invitation = parseDiaryInvitation(source['invitation'], now);
  const entries = source['entries'];
  if (!Array.isArray(entries) || entries.length > MAX_DIARY_ENTRIES) {
    throw new DiaryFormatError('Список записей некорректен.');
  }
  const parsed = entries.map((entry) => parseDiaryEntry(invitation, entry, now));
  if (new Set(parsed.map((entry) => entry.id)).size !== parsed.length) {
    throw new DiaryFormatError('Записи дневника повторяются.');
  }
  return {
    v: DIARY_FORMAT_VERSION,
    invitation,
    entries: parsed.toSorted((left, right) => left.at.localeCompare(right.at)),
  };
}

// --- Presentation ----------------------------------------------------------------------------

export function planItem(
  invitation: DiaryInvitation,
  id: string | undefined,
): DiaryPlanItem | undefined {
  return id === undefined ? undefined : invitation.plan?.find((item) => item.id === id);
}

/** Plan items the patient can still choose (the doctor has not ended them). */
export function activePlanItems(invitation: DiaryInvitation): readonly DiaryPlanItem[] {
  return (invitation.plan ?? []).filter((item) => !item.ended);
}

function formatNumber(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function describeDiaryValue(
  invitation: DiaryInvitation,
  field: DiaryField,
  value: DiaryValue,
): string {
  if (typeof value === 'number') {
    return field.type === 'count'
      ? `${field.label}: ${value}`
      : `${field.label}: ${formatNumber(value)}${field.unit ? ` ${field.unit}` : ''}`;
  }
  if (typeof value === 'boolean') return `${field.label}: ${value ? 'да' : 'нет'}`;
  if (typeof value === 'string') return field.type === 'text' ? value : `${field.label}: ${value}`;
  if (Array.isArray(value)) return `${field.label}: ${value.join(', ')}`;
  const plan = value as DiaryPlanValue;
  const item = planItem(invitation, plan.item);
  const name = item ? [item.name, item.dose].filter(Boolean).join(' ') : (plan.other ?? '');
  const done = plan.done === undefined ? '' : plan.done ? ' — выполнено' : ' — пропущено';
  return `${name}${done}`;
}

/** One human-readable line per entry, shared by the patient page and the doctor preview. */
export function describeDiaryEntry(invitation: DiaryInvitation, entry: DiaryEntry): string {
  const byId = new Map(invitation.fields.map((field) => [field.id, field]));
  const pressure =
    typeof entry.values['systolic'] === 'number' && typeof entry.values['diastolic'] === 'number'
      ? `${entry.values['systolic']}/${entry.values['diastolic']} мм рт. ст.`
      : undefined;
  const parts = invitation.fields.flatMap((field) => {
    if (pressure && (field.id === 'systolic' || field.id === 'diastolic')) return [];
    const value = entry.values[field.id];
    return value === undefined
      ? []
      : [describeDiaryValue(invitation, byId.get(field.id) ?? field, value)];
  });
  return [pressure, ...parts].filter(Boolean).join(' · ');
}

// --- Templates -------------------------------------------------------------------------------

export interface DiaryTemplate {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly fields: readonly DiaryField[];
  /** Label for the doctor's plan editor; absent when the diary has no plan. */
  readonly planTitle?: string;
  readonly planHint?: string;
  readonly planRequired?: boolean;
}

const MEDICATION_FIELD: DiaryField = {
  id: 'medication',
  type: 'plan',
  label: 'Препарат',
  trackDone: true,
};

export const DIARY_TEMPLATES: readonly DiaryTemplate[] = [
  {
    id: 'blood-pressure',
    title: 'Дневник артериального давления',
    summary: 'Давление и пульс, рука и самочувствие.',
    fields: [
      {
        id: 'systolic',
        type: 'number',
        label: 'Верхнее',
        unit: 'мм рт. ст.',
        min: 50,
        max: 300,
        required: true,
        metric: {
          metricId: 'blood-pressure-systolic',
          label: 'Давление: систолическое',
          loinc: '8480-6',
          ucum: 'mm[Hg]',
        },
      },
      {
        id: 'diastolic',
        type: 'number',
        label: 'Нижнее',
        unit: 'мм рт. ст.',
        min: 30,
        max: 200,
        required: true,
        lessThan: 'systolic',
        metric: {
          metricId: 'blood-pressure-diastolic',
          label: 'Давление: диастолическое',
          loinc: '8462-4',
          ucum: 'mm[Hg]',
        },
      },
      {
        id: 'pulse',
        type: 'number',
        label: 'Пульс',
        unit: 'уд/мин',
        min: 25,
        max: 250,
        metric: { metricId: 'pulse', label: 'Пульс', loinc: '8867-4', ucum: '/min' },
      },
      { id: 'arm', type: 'choice', label: 'Рука', options: ['левая', 'правая'] },
      {
        id: 'wellbeing',
        type: 'choice',
        label: 'Самочувствие',
        options: ['хорошее', 'головная боль', 'головокружение', 'слабость', 'другое'],
      },
    ],
  },
  {
    id: 'medication',
    title: 'Дневник приёма препаратов',
    summary: 'Врач указывает препараты и дозы, пациент отмечает приём или пропуск.',
    planTitle: 'Назначенные препараты',
    planHint: 'Пациент увидит этот список и будет отмечать каждый приём.',
    planRequired: true,
    fields: [MEDICATION_FIELD],
  },
  {
    id: 'child',
    title: 'Дневник ребёнка',
    summary: 'Питание по плану, вес, сон, стул и жалобы для детей первых лет.',
    planTitle: 'План питания',
    planHint: 'Например: «Грудное молоко / смесь», «90–120 мл», «каждые 3 часа, дни 1–7».',
    fields: [
      { id: 'feeding', type: 'plan', label: 'Кормление' },
      { id: 'amount', type: 'number', label: 'Съел(а)', unit: 'мл или г', min: 0, max: 2000 },
      {
        id: 'weight',
        type: 'number',
        label: 'Вес',
        unit: 'г',
        min: 500,
        max: 40000,
        metric: {
          metricId: 'body-mass',
          label: 'Масса тела',
          unit: 'кг',
          factor: 0.001,
          loinc: '29463-7',
          ucum: 'g',
        },
      },
      { id: 'sleep', type: 'number', label: 'Сон', unit: 'ч', min: 0, max: 24, step: 0.5 },
      { id: 'stool', type: 'flag', label: 'Был стул' },
      { id: 'stool-count', type: 'count', label: 'Стул за день, раз', min: 0, max: 20 },
      {
        id: 'complaints',
        type: 'multi',
        label: 'Жалобы сейчас',
        options: [
          'колики',
          'срыгивание',
          'рвота',
          'сыпь',
          'температура',
          'беспокойство',
          'запор',
          'жидкий стул',
        ],
      },
    ],
  },
  {
    id: 'illness',
    title: 'Дневник течения болезни',
    summary: 'Температура, симптомы и принятые лекарства по дням болезни.',
    planTitle: 'Назначенные лекарства',
    planHint: 'Необязательно: пациент сможет выбрать из списка или вписать своё.',
    fields: [
      {
        id: 'temperature',
        type: 'number',
        label: 'Температура',
        unit: '°C',
        min: 34,
        max: 43,
        step: 0.1,
        metric: { metricId: 'temperature', label: 'Температура', loinc: '8310-5', ucum: 'Cel' },
      },
      {
        id: 'symptoms',
        type: 'multi',
        label: 'Симптомы',
        options: [
          'кашель',
          'насморк',
          'боль в горле',
          'головная боль',
          'боль в животе',
          'рвота',
          'диарея',
          'сыпь',
          'одышка',
          'слабость',
        ],
      },
      { id: 'medicine', type: 'plan', label: 'Принятое лекарство', trackDone: true },
    ],
  },
  {
    id: 'glucose',
    title: 'Дневник глюкозы',
    summary: 'Глюкоза по глюкометру и условие измерения.',
    fields: [
      {
        id: 'mmol',
        type: 'number',
        label: 'Глюкоза',
        unit: 'ммоль/л',
        min: 0.5,
        max: 40,
        step: 0.1,
        required: true,
        metric: {
          metricId: 'capillary-glucose',
          label: 'Глюкоза (глюкометр)',
          loinc: '14743-9',
          ucum: 'mmol/L',
        },
      },
      {
        id: 'context',
        type: 'choice',
        label: 'Когда',
        options: ['натощак', 'перед едой', 'после еды', 'перед сном', 'другое'],
      },
    ],
  },
];

export function diaryTemplate(id: string): DiaryTemplate | undefined {
  return DIARY_TEMPLATES.find((template) => template.id === id);
}
