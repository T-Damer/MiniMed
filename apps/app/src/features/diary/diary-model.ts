/**
 * Patient self-monitoring diary exchanged without a server: the doctor hands over an invitation
 * link, the patient keeps entries in their own browser and shows them back as QR codes.
 * Everything that crosses a device boundary is validated here.
 */

export const DIARY_FORMAT_VERSION = 1 as const;

export type DiaryKind = 'blood-pressure' | 'glucose' | 'medication';

export const DIARY_KINDS: readonly DiaryKind[] = ['blood-pressure', 'glucose', 'medication'];

export const DIARY_KIND_TITLE: Readonly<Record<DiaryKind, string>> = {
  'blood-pressure': 'Дневник артериального давления',
  glucose: 'Дневник глюкозы',
  medication: 'Дневник приёма препаратов',
};

export type GlucoseContext = 'fasting' | 'before-meal' | 'after-meal' | 'bedtime' | 'other';

export const GLUCOSE_CONTEXTS: readonly GlucoseContext[] = [
  'fasting',
  'before-meal',
  'after-meal',
  'bedtime',
  'other',
];

export const GLUCOSE_CONTEXT_LABEL: Readonly<Record<GlucoseContext, string>> = {
  fasting: 'натощак',
  'before-meal': 'перед едой',
  'after-meal': 'после еды',
  bedtime: 'перед сном',
  other: 'другое',
};

export interface DiaryMedication {
  readonly name: string;
  readonly dose?: string;
  readonly schedule?: string;
}

/** What the doctor gives the patient. Contains no patient identity. */
export interface DiaryInvitation {
  readonly v: typeof DIARY_FORMAT_VERSION;
  readonly id: string;
  readonly kind: DiaryKind;
  readonly issuedAt: string;
  readonly doctor?: string;
  readonly note?: string;
  readonly medications?: readonly DiaryMedication[];
}

interface EntryBase {
  readonly id: string;
  /** ISO timestamp of the measurement or intake, as entered by the patient. */
  readonly at: string;
  readonly note?: string;
}

export interface BloodPressureEntry extends EntryBase {
  readonly systolic: number;
  readonly diastolic: number;
  readonly pulse?: number;
}

export interface GlucoseEntry extends EntryBase {
  /** mmol/L with one decimal place. */
  readonly mmol: number;
  readonly context: GlucoseContext;
}

export interface MedicationEntry extends EntryBase {
  readonly medication: number;
  readonly taken: boolean;
}

export type DiaryEntry = BloodPressureEntry | GlucoseEntry | MedicationEntry;

/** What the patient shows back. Invitation fields are repeated so the doctor sees the context. */
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
const MAX_MEDICATIONS = 12;
const MAX_TEXT = 200;
const ID_PATTERN = /^[a-z0-9]{6,24}$/u;
const EARLIEST_ENTRY = Date.UTC(2000, 0, 1);

export const BLOOD_PRESSURE_LIMITS = {
  systolic: [50, 300],
  diastolic: [30, 200],
  pulse: [25, 250],
} as const;
export const GLUCOSE_LIMITS = [0.5, 40] as const;

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

function bounded(
  value: unknown,
  [minimum, maximum]: readonly [number, number],
  label: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DiaryFormatError(`${label}: значение вне диапазона ${minimum}–${maximum}.`);
  }
  return value;
}

export function createDiaryId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('') + Date.now().toString(36);
}

export function parseDiaryInvitation(value: unknown, now = Date.now()): DiaryInvitation {
  const source = record(value, 'Приглашение');
  if (source['v'] !== DIARY_FORMAT_VERSION) {
    throw new DiaryFormatError('Неподдерживаемая версия дневника.');
  }
  const kind = source['kind'];
  if (typeof kind !== 'string' || !DIARY_KINDS.includes(kind as DiaryKind)) {
    throw new DiaryFormatError('Неизвестный тип дневника.');
  }
  const medications = source['medications'];
  let parsedMedications: DiaryMedication[] | undefined;
  if (medications !== undefined) {
    if (!Array.isArray(medications) || medications.length > MAX_MEDICATIONS) {
      throw new DiaryFormatError('Список препаратов некорректен.');
    }
    parsedMedications = medications.map((item, index) => {
      const medication = record(item, `Препарат ${index + 1}`);
      const dose = text(medication['dose'], 'Доза', true);
      const schedule = text(medication['schedule'], 'Схема приёма', true);
      return {
        name: text(medication['name'], 'Название препарата'),
        ...(dose ? { dose } : {}),
        ...(schedule ? { schedule } : {}),
      };
    });
  }
  if (kind === 'medication' && !parsedMedications?.length) {
    throw new DiaryFormatError('В дневнике приёма нет ни одного препарата.');
  }
  const doctor = text(source['doctor'], 'Врач', true);
  const note = text(source['note'], 'Комментарий врача', true);
  return {
    v: DIARY_FORMAT_VERSION,
    id: identifier(source['id'], 'Дневник'),
    kind: kind as DiaryKind,
    issuedAt: timestamp(source['issuedAt'], 'Дата выдачи', now),
    ...(doctor ? { doctor } : {}),
    ...(note ? { note } : {}),
    ...(parsedMedications?.length ? { medications: parsedMedications } : {}),
  };
}

export function parseDiaryEntry(
  invitation: DiaryInvitation,
  value: unknown,
  now = Date.now(),
): DiaryEntry {
  const source = record(value, 'Запись');
  const note = text(source['note'], 'Комментарий', true);
  const base = {
    id: identifier(source['id'], 'Запись'),
    at: timestamp(source['at'], 'Дата записи', now),
    ...(note ? { note } : {}),
  };
  switch (invitation.kind) {
    case 'blood-pressure': {
      const systolic = bounded(source['systolic'], BLOOD_PRESSURE_LIMITS.systolic, 'Верхнее АД');
      const diastolic = bounded(source['diastolic'], BLOOD_PRESSURE_LIMITS.diastolic, 'Нижнее АД');
      if (diastolic >= systolic) {
        throw new DiaryFormatError('Нижнее давление должно быть меньше верхнего.');
      }
      const pulse =
        source['pulse'] === undefined
          ? undefined
          : bounded(source['pulse'], BLOOD_PRESSURE_LIMITS.pulse, 'Пульс');
      return { ...base, systolic, diastolic, ...(pulse === undefined ? {} : { pulse }) };
    }
    case 'glucose': {
      const context = source['context'];
      if (typeof context !== 'string' || !GLUCOSE_CONTEXTS.includes(context as GlucoseContext)) {
        throw new DiaryFormatError('Неизвестное условие измерения глюкозы.');
      }
      const mmol = Math.round(bounded(source['mmol'], GLUCOSE_LIMITS, 'Глюкоза') * 10) / 10;
      return { ...base, mmol, context: context as GlucoseContext };
    }
    case 'medication': {
      const index = source['medication'];
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= (invitation.medications?.length ?? 0)
      ) {
        throw new DiaryFormatError('Запись ссылается на неизвестный препарат.');
      }
      if (typeof source['taken'] !== 'boolean') {
        throw new DiaryFormatError('Не указано, принят ли препарат.');
      }
      return { ...base, medication: index, taken: source['taken'] };
    }
  }
}

export function parseDiaryResults(value: unknown, now = Date.now()): DiaryResults {
  const source = record(value, 'Дневник');
  if (source['v'] !== DIARY_FORMAT_VERSION) {
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

export function isBloodPressureEntry(entry: DiaryEntry): entry is BloodPressureEntry {
  return 'systolic' in entry;
}

export function isGlucoseEntry(entry: DiaryEntry): entry is GlucoseEntry {
  return 'mmol' in entry;
}

export function isMedicationEntry(entry: DiaryEntry): entry is MedicationEntry {
  return 'medication' in entry;
}

/** One human-readable line per entry, shared by the patient page and the doctor preview. */
export function describeDiaryEntry(invitation: DiaryInvitation, entry: DiaryEntry): string {
  if (isBloodPressureEntry(entry)) {
    const pulse = entry.pulse === undefined ? '' : `, пульс ${entry.pulse}`;
    return `${entry.systolic}/${entry.diastolic} мм рт. ст.${pulse}`;
  }
  if (isGlucoseEntry(entry)) {
    return `${entry.mmol.toLocaleString('ru-RU')} ммоль/л, ${GLUCOSE_CONTEXT_LABEL[entry.context]}`;
  }
  const medication = invitation.medications?.[entry.medication];
  const name = medication ? medication.name : 'Препарат';
  return `${name}: ${entry.taken ? 'принят' : 'пропущен'}`;
}
