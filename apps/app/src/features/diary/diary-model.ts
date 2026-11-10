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

import {
  PastMedFormatError,
  type PastMedication,
  parsePastMedications,
} from '@/features/diary/diary-med-history';
import { substanceSummary } from '@/features/diary/diary-substances';
import {
  parseUserQuestionnaire,
  stripUntrustedQuestionnaireImages,
  type UserQuestionnaire,
} from '@/state/user-questionnaire-format';
import { parseUserWorksheet, type UserWorksheet } from '@/state/user-worksheet-format';

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

export type DiaryMeal = 'before' | 'with' | 'after';

export const DIARY_MEAL_LABEL: Readonly<Record<DiaryMeal, string>> = {
  before: 'до еды',
  with: 'во время еды',
  after: 'после еды',
};

/** One intake of a planned item at a time of day; the patient ticks it off in the day's checklist. */
export interface DiaryDoseTime {
  /** Local time `HH:MM`. */
  readonly time: string;
  readonly meal?: DiaryMeal;
  /** Dose for this intake when it differs from the item's dose. */
  readonly dose?: string;
}

export interface DiaryPlanItem {
  readonly id: string;
  readonly name: string;
  readonly dose?: string;
  readonly schedule?: string;
  /** Dosage form («таблетки», «капсулы»), as the doctor chose it. */
  readonly form?: string;
  /** The doctor's instruction to the patient (signa): «по 1 таблетке после завтрака». */
  readonly signa?: string;
  /**
   * Days the course runs, as local day ranges `YYYY-MM-DD`; absent or empty: no end date. Intakes
   * are offered only on these days.
   */
  readonly course?: readonly { readonly from: string; readonly to: string }[];
  /** Daily intakes; absent for an item taken when needed or described only in words. */
  readonly times?: readonly DiaryDoseTime[];
  /** Taken when needed: offered as «Принять сейчас», not as a timed check. */
  readonly asNeeded?: boolean;
  /**
   * The doctor removed this item from the plan in a newer link. Entries already made for it keep
   * resolving, but the patient is no longer offered it.
   */
  readonly ended?: boolean;
  /**
   * The medicine as picked from the drug catalog (RESEARCH1): its catalog slug and ATC codes, so a
   * study can group plans by substance and class. Absent when the name was typed by hand.
   */
  readonly drug?: string;
  readonly atc?: readonly string[];
  /**
   * What the doctor prescribes it for (RESEARCH1), in the doctor's words: «давление», «сон»,
   * «тревога». Read by the doctor and a study export; the patient's screen does not show it.
   */
  readonly target?: string;
}

/**
 * Something the doctor asks the patient to fill at set times: a score (wellbeing 0–10), a group of
 * measurements, or a questionnaire every few days.
 */
export type DiaryCheckpointKind = 'score' | 'vitals' | 'questionnaire' | 'text' | 'choice' | 'use';

export interface DiaryCheckpoint {
  readonly id: string;
  readonly kind: DiaryCheckpointKind;
  readonly label: string;
  /** Daily times `HH:MM` (score and vitals). Empty: once a day at any time. */
  readonly times?: readonly string[];
  /**
   * Fields this checkpoint fills (score: one number field; vitals: several; use: a `count` field
   * per substance, a craving score and a «что именно» text).
   */
  readonly fields?: readonly string[];
  /** Questionnaire slug (`phq-9`) for a questionnaire checkpoint; `own-…` for a doctor's own. */
  readonly questionnaire?: string;
  /**
   * The doctor's own questionnaire (main app «Мои опросники»), embedded because the patient's
   * device cannot read the doctor's files. Present exactly when the slug starts with `own-`;
   * pictures are removed (size), the rest is validated by the main app's questionnaire parser.
   */
  readonly custom?: UserQuestionnaire;
  /** Questionnaire: repeat every N days. */
  readonly everyDays?: number;
  /** Switched off by the doctor; kept so earlier entries still resolve. */
  readonly ended?: true;
}

export type DiaryContactKind = 'phone' | 'telegram' | 'link' | 'email';

export interface DiaryContact {
  readonly kind: DiaryContactKind;
  readonly value: string;
  readonly label?: string;
}

/** The doctor's hint on one field, plan item or checkpoint; the patient sees a «?» until read. */
export interface DiaryTip {
  readonly id: string;
  /** Field id, plan item id or checkpoint id. */
  readonly target: string;
  readonly text: string;
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
  readonly checkpoints?: readonly DiaryCheckpoint[];
  readonly contacts?: readonly DiaryContact[];
  readonly tips?: readonly DiaryTip[];
  /** Where to turn in a crisis, besides the doctor's contacts and 112 (one line each). */
  readonly crisis?: readonly string[];
  /** The patient accepts the joining documents before the first entry (`features/diary/consent`). */
  readonly consent?: boolean;
  /** Who runs the follow-up, from the doctor's «Врач и организация»: filled into those documents. */
  readonly operator?: DiaryOperator;
  /** Visits the doctor booked (DIARY27): shown above the patient's day, with a call button. */
  readonly appointments?: readonly DiaryAppointment[];
  /** Lab tests the doctor asks for (DIARY27); the patient types each result into its field. */
  readonly labs?: readonly DiaryLabRequest[];
  /**
   * CBT diaries and homework (CBT1): worksheets the doctor gave, each a copy made for this patient.
   * A new key, so an older patient app skips it instead of refusing the plan.
   */
  readonly assignments?: readonly DiaryAssignment[];
  /**
   * The diary belongs to a research study the patient may join (voluntary, apart from the joining
   * documents). A new key, so an older patient app skips it. The patient's answer travels in the
   * consent record (`consent/study-consent.ts`).
   */
  readonly study?: DiaryStudy;
}

/**
 * A study as the doctor registered it. The consent wording is the one the ethics committee
 * approved, pasted by the doctor; the app ships none of its own.
 */
export interface DiaryStudy {
  /** Stays the same while the doctor edits the study; the patient's answer points at it. */
  readonly id: string;
  readonly title: string;
  /** The protocol number as the committee knows it. */
  readonly protocol: string;
  /** The version of the protocol and consent text; a new one asks the patient again. */
  readonly version: string;
  /** The approved consent text, shown to the patient as written. */
  readonly text: string;
}

export const MAX_DIARY_STUDY_TEXT = 24_000;

/** How often a worksheet is filled: when the event happens, every day, or on chosen weekdays. */
export type DiaryAssignmentRepeat = 'event' | 'daily' | 'days';

export const DIARY_ASSIGNMENT_REPEATS: readonly DiaryAssignmentRepeat[] = [
  'event',
  'daily',
  'days',
];

/**
 * A worksheet the doctor assigned (CBT1): an embedded copy (the patient's phone cannot read the
 * doctor's library), when to fill it, and the patient's memo — why and what to do.
 */
export interface DiaryAssignment {
  readonly id: string;
  readonly worksheet: UserWorksheet;
  readonly repeat: DiaryAssignmentRepeat;
  /** `days`: weekdays, 1 Monday … 7 Sunday. */
  readonly days?: readonly number[];
  /** A reminder time `HH:MM` for `daily` and `days`. */
  readonly time?: string;
  /** The first day (`YYYY-MM-DD`), the day it was given. */
  readonly from: string;
  /** The last day, inclusive; absent: until the doctor ends it. */
  readonly until?: string;
  /** «Зачем это вам», in the doctor's words for this patient. */
  readonly why?: string;
  /** «Что и когда делать», in the doctor's words. */
  readonly what?: string;
  /** Taken off by the doctor; kept so the entries made for it still resolve. */
  readonly ended?: true;
}

/** A visit to the doctor (owner 2026-11-04: «Завтра у вас приём в 14:30» and a call button). */
export interface DiaryAppointment {
  readonly id: string;
  /** `YYYY-MM-DD`, the patient's local day. */
  readonly day: string;
  /** `HH:MM`; absent: the day only. */
  readonly time?: string;
  readonly place?: string;
  readonly note?: string;
}

/**
 * A lab test the doctor asks the patient to take (owner 2026-11-04: «some drugs increase hormone
 * levels — prolactin»). The patient types the result in by hand into `field`, a number field of the
 * diary, as an entry of its own on the day the blood was taken.
 */
export interface DiaryLabRequest {
  readonly id: string;
  readonly name: string;
  /** Id of the number field the result goes into. */
  readonly field: string;
  /** Take it by this day, `YYYY-MM-DD`. */
  readonly by?: string;
  /** Why, in the doctor's words: «рисперидон может повышать пролактин». */
  readonly why?: string;
}

/** The clinic and the doctor as the joining documents name them; every part may be missing. */
export interface DiaryOperator {
  readonly organization?: string;
  readonly address?: string;
  /** ОГРН or ОГРНИП. */
  readonly ogrn?: string;
  readonly clinician?: string;
  readonly position?: string;
}

export const DIARY_OPERATOR_KEYS = [
  'organization',
  'address',
  'ogrn',
  'clinician',
  'position',
] as const satisfies readonly (keyof DiaryOperator)[];

/**
 * Why an intake was missed (DIARY22, owner 2026-11-03: «when the patient didn't take it, ask why —
 * this is important»): one tap in the patient's dose sheet; the doctor sees how often and why.
 */
export const DIARY_MISS_REASONS = [
  'forgot',
  'not-with-me',
  'ran-out',
  'side-effects',
  'felt-better',
  'doubts',
  'other',
] as const;

export type DiaryMissReason = (typeof DIARY_MISS_REASONS)[number];

export const DIARY_MISS_REASON_LABEL: Readonly<Record<DiaryMissReason, string>> = {
  forgot: 'Забыл(а)',
  'not-with-me': 'Не было с собой',
  'ran-out': 'Закончилось',
  'side-effects': 'Плохо переношу',
  'felt-better': 'Стало лучше',
  doubts: 'Сомневаюсь в лечении',
  other: 'Другое',
};

/** The reason as the doctor reads it in a line (lower case). */
export const DIARY_MISS_REASON_SHORT: Readonly<Record<DiaryMissReason, string>> = {
  forgot: 'забыл(а)',
  'not-with-me': 'не было с собой',
  'ran-out': 'закончилось',
  'side-effects': 'плохо переносит',
  'felt-better': 'стало лучше',
  doubts: 'сомневается в лечении',
  other: 'другое',
};

export function isDiaryMissReason(value: unknown): value is DiaryMissReason {
  return typeof value === 'string' && (DIARY_MISS_REASONS as readonly string[]).includes(value);
}

export interface DiaryPlanValue {
  /** Plan item id, absent when the patient typed something not in the plan. */
  readonly item?: string;
  readonly other?: string;
  readonly done?: boolean;
  /** The scheduled intake `HH:MM` this mark answers; absent for an unscheduled intake. */
  readonly slot?: string;
  /**
   * The dose the plan asked for when the mark was made: a later plan change does not rewrite the
   * past. Absent on marks made before doses were recorded (they show the current dose).
   */
  readonly dose?: string;
  /** Why it was not taken (only with `done: false`). */
  readonly reason?: DiaryMissReason;
}

export type DiaryValue = number | string | boolean | readonly string[] | DiaryPlanValue;

export interface DiaryEntry {
  readonly id: string;
  /** ISO timestamp of the measurement or event, as entered by the patient. */
  readonly at: string;
  readonly values: Readonly<Record<string, DiaryValue>>;
  readonly note?: string;
  /** Checkpoint this entry answers (morning wellbeing, a questionnaire…). */
  readonly check?: string;
  /** Questionnaire answers by question id; scored on display from the questionnaire schema. */
  readonly answers?: Readonly<Record<string, number>>;
  /** The doctor corrected this entry (connected diary); the patient sees it marked. */
  readonly corrected?: true;
  /**
   * A short voice recording kept when the phone could not make words of it (owner 2026-11-01):
   * end-to-end encrypted like every record, never in QR codes.
   */
  readonly voice?: DiaryVoice;
  /** The assignment this entry fills (CBT1); its cells are in `sheet`, not in `values`. */
  readonly assignment?: string;
  /** What the patient wrote in the worksheet, by worksheet field id. */
  readonly sheet?: Readonly<Record<string, DiarySheetValue>>;
  /**
   * Text that was spoken (CBT1 stage 3): the recording stays on the phone that made it, only the
   * recognised text travels — this says which text came from a voice and how it was recognised.
   */
  readonly spoken?: readonly DiarySpoken[];
  /**
   * Reserved (CBT1): a simplified retelling and the tone of a spoken text, each claim pointing at
   * the words it rests on. Parsed when present; nothing produces it yet.
   */
  readonly insights?: readonly DiaryVoiceInsight[];
  /**
   * The doctor's own rating at a visit with this scale (slug of `DIARY_CLINICIAN_SCALES`), scored
   * from `answers`. Only a `v-<id>` record written by a doctor carries it (`diary-visit-scales.ts`);
   * the patient's phone never reads those records.
   */
  readonly visitScale?: string;
}

export type DiarySheetValue = number | string | readonly string[];

/** One text that was dictated and recognised on the patient's phone. */
export interface DiarySpoken {
  /** `#note` (the entry's note), `#state` (own words), or a worksheet field id. */
  readonly target: string;
  readonly seconds: number;
  /** The recogniser on the phone: `whisper-base`, `whisper-small`, `gigaam-v3`. */
  readonly engine: string;
  /** The patient changed the recognised text before sending it. */
  readonly edited?: true;
  /**
   * The recording's id on the phone that made it (`diary/voice-store.ts`); the recording itself
   * never leaves that phone.
   */
  readonly clip?: string;
}

/** A span of the spoken text, in characters: what a statement of an insight rests on. */
export interface DiaryTextSpan {
  readonly from: number;
  readonly to: number;
}

/** Reserved for a future model (CBT1): not produced anywhere yet. */
export interface DiaryVoiceInsight {
  readonly target: string;
  /** The text in simpler words. */
  readonly simplified: string;
  /** The tone heard, each with the spans it was heard in. */
  readonly tone: readonly { readonly label: string; readonly spans: readonly DiaryTextSpan[] }[];
  readonly model: string;
  readonly at: string;
}

export interface DiaryVoice {
  readonly mime: string;
  /** Base64 of the recording. */
  readonly data: string;
  readonly seconds: number;
}

/** What the patient shows back. The invitation is repeated so the doctor sees the context. */
export interface DiaryResults {
  readonly v: typeof DIARY_FORMAT_VERSION;
  readonly invitation: DiaryInvitation;
  readonly entries: readonly DiaryEntry[];
  /** Medicines taken before (MEDHIST1), allergies first; absent when none was entered. */
  readonly medHistory?: readonly PastMedication[];
}

export class DiaryFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiaryFormatError';
  }
}

export const MAX_DIARY_ENTRIES = 1500;
export const MAX_DIARY_FIELDS = 40;
export const MAX_DIARY_OPTIONS = 16;
export const MAX_DIARY_PLAN_ITEMS = 30;
export const MAX_DIARY_CHECKPOINTS = 24;
export const MAX_DIARY_CONTACTS = 6;
export const MAX_DIARY_TIPS = 40;
export const MAX_DIARY_DOSE_TIMES = 8;
export const MAX_DIARY_APPOINTMENTS = 10;
export const MAX_DIARY_LABS = 12;
export const MAX_DIARY_ASSIGNMENTS = 12;
/** One embedded worksheet, as JSON: the largest built-in one is under 4 000. */
export const MAX_DIARY_WORKSHEET_CHARS = 24_000;
/** All embedded worksheets of one invitation, ended ones included. */
export const MAX_DIARY_WORKSHEET_TOTAL_CHARS = 96_000;
/** One long text cell of a worksheet («Ситуация», «Доводы за»). */
export const MAX_DIARY_SHEET_TEXT = 2000;
/** Everything written in one worksheet entry. */
export const MAX_DIARY_SHEET_TOTAL = 12_000;
const MAX_SHEET_CELLS = 30;
const MAX_SPOKEN = 16;
/** Free text the patient writes about their state, and the doctor's tips. */
export const MAX_DIARY_NOTE = 4000;
/**
 * A voice recording's base64 length: the record body (≤ 256 000 sealed characters) carries it base64
 * inside JSON, then sealed in base64 again, so ≈ 100 kB of audio — about a minute at 16 kbit/s.
 */
export const MAX_DIARY_VOICE_CHARS = 140_000;
const VOICE_MIME = /^audio\/(webm|ogg|mp4|aac|mpeg)(;\s*codecs=[\w.,"-]+)?$/u;
const MAX_TEXT = 200;
const MAX_ANSWERS = 80;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
/** Up to 64 characters: the bank's clinician scales name their questions after the whole slug. */
const ANSWER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
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

function hasControlCharacter(value: string, allowLineBreaks = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 && !(allowLineBreaks && code === 0x0a)) return true;
  }
  return false;
}

/** Multi-line patient or doctor text: line breaks kept, other control characters refused. */
function longText(value: unknown, label: string, optional: true): string | undefined;
function longText(value: unknown, label: string, optional?: false): string;
function longText(value: unknown, label: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (
    typeof value !== 'string' ||
    value.length > MAX_DIARY_NOTE ||
    hasControlCharacter(value, true)
  ) {
    throw new DiaryFormatError(`${label}: некорректный текст.`);
  }
  const trimmed = value.trim();
  if (!trimmed && !optional) throw new DiaryFormatError(`${label}: значение обязательно.`);
  return trimmed || undefined;
}

function clockTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new DiaryFormatError(`${label}: время в формате ЧЧ:ММ.`);
  }
  return value;
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

const MEALS: readonly DiaryMeal[] = ['before', 'with', 'after'];

function parseDoseTimes(value: unknown, index: number): DiaryDoseTime[] | undefined {
  if (value === undefined) return undefined;
  const label = `Пункт назначения ${index + 1}`;
  if (!Array.isArray(value) || value.length > MAX_DIARY_DOSE_TIMES) {
    throw new DiaryFormatError(`${label}: некорректное время приёма.`);
  }
  const times = value.map((item) => {
    const source = record(item, label);
    const meal = source['meal'];
    if (meal !== undefined && !MEALS.includes(meal as DiaryMeal)) {
      throw new DiaryFormatError(`${label}: неизвестная связь с едой.`);
    }
    const dose = text(source['dose'], 'Доза', true);
    return {
      time: clockTime(source['time'], label),
      ...(meal === undefined ? {} : { meal: meal as DiaryMeal }),
      ...(dose ? { dose } : {}),
    };
  });
  if (new Set(times.map((time) => time.time)).size !== times.length) {
    throw new DiaryFormatError(`${label}: время приёма повторяется.`);
  }
  return times.toSorted((left, right) => left.time.localeCompare(right.time));
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function parseCourse(
  value: unknown,
  index: number,
): { readonly from: string; readonly to: string }[] | undefined {
  if (value === undefined) return undefined;
  const label = `Пункт назначения ${index + 1}`;
  if (!Array.isArray(value) || value.length > 60) {
    throw new DiaryFormatError(`${label}: некорректный срок приёма.`);
  }
  return value.map((range) => {
    const source = record(range, label);
    const from = source['from'];
    const to = source['to'];
    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      !DAY_PATTERN.test(from) ||
      !DAY_PATTERN.test(to) ||
      to < from
    ) {
      throw new DiaryFormatError(`${label}: некорректный срок приёма.`);
    }
    return { from, to };
  });
}

/** Slug of a doctor's own questionnaire: `own-` and a short id; checkpoint ids stay within 24. */
export const CUSTOM_QUESTIONNAIRE_SLUG = /^own-[a-z0-9]{4,16}$/u;
/** One embedded questionnaire, as JSON; 120 questions of average length fit comfortably. */
export const MAX_DIARY_CUSTOM_CHARS = 32_000;
/** All embedded questionnaires of one invitation, ended ones included. */
export const MAX_DIARY_CUSTOM_TOTAL_CHARS = 96_000;

function parseCustomQuestionnaire(value: unknown, label: string): UserQuestionnaire {
  let questionnaire: UserQuestionnaire;
  try {
    questionnaire = parseUserQuestionnaire(stripUntrustedQuestionnaireImages(value));
  } catch (cause) {
    throw new DiaryFormatError(
      `«${label}»: опросник врача некорректен${cause instanceof Error ? ` (${cause.message})` : ''}.`,
    );
  }
  if (JSON.stringify(questionnaire).length > MAX_DIARY_CUSTOM_CHARS) {
    throw new DiaryFormatError(`«${label}»: опросник врача слишком большой для дневника.`);
  }
  return questionnaire;
}

const CHECKPOINT_KINDS: readonly DiaryCheckpointKind[] = [
  'score',
  'vitals',
  'questionnaire',
  'text',
  'choice',
  'use',
];
const CONTACT_KINDS: readonly DiaryContactKind[] = ['phone', 'telegram', 'link', 'email'];

/**
 * The fields of a substance-use checkpoint: counts (with a ceiling), a bounded score and a text,
 * and at least one count; anything else could not be shown by the patient's use sheet.
 */
function checkUseFields(
  label: string,
  fieldIds: readonly string[],
  fields: readonly DiaryField[],
): void {
  const chosen = fieldIds.flatMap((id) => fields.filter((field) => field.id === id));
  for (const field of chosen) {
    const bounded = field.min !== undefined && field.max !== undefined;
    const ok =
      field.type === 'text' ||
      (field.type === 'count' && field.max !== undefined) ||
      (field.type === 'number' && bounded);
    if (!ok) throw new DiaryFormatError(`«${label}»: поле «${field.label}» не того вида.`);
  }
  if (!chosen.some((field) => field.type === 'count')) {
    throw new DiaryFormatError(`«${label}»: нужно хотя бы одно вещество.`);
  }
}

function parseCheckpoints(value: unknown, fields: readonly DiaryField[]): DiaryCheckpoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_CHECKPOINTS) {
    throw new DiaryFormatError('Отметки дневника некорректны.');
  }
  const checkpoints = value.map((item, index) => {
    const source = record(item, `Отметка ${index + 1}`);
    const id = source['id'];
    if (typeof id !== 'string' || !FIELD_ID_PATTERN.test(id)) {
      throw new DiaryFormatError(`Отметка ${index + 1}: некорректный идентификатор.`);
    }
    const kind = source['kind'];
    if (!CHECKPOINT_KINDS.includes(kind as DiaryCheckpointKind)) {
      throw new DiaryFormatError(`Отметка ${index + 1}: неизвестный вид.`);
    }
    const label = text(source['label'], `Отметка ${index + 1}`);
    const timesValue = source['times'];
    if (
      timesValue !== undefined &&
      (!Array.isArray(timesValue) || timesValue.length > MAX_DIARY_DOSE_TIMES)
    ) {
      throw new DiaryFormatError(`«${label}»: некорректное время.`);
    }
    const times = (timesValue as unknown[] | undefined)
      ?.map((time) => clockTime(time, label))
      .toSorted();
    const fieldIds = source['fields'];
    if (
      fieldIds !== undefined &&
      (!Array.isArray(fieldIds) ||
        fieldIds.some(
          (fieldId) => typeof fieldId !== 'string' || !fields.some((field) => field.id === fieldId),
        ))
    ) {
      throw new DiaryFormatError(`«${label}»: ссылается на неизвестное поле.`);
    }
    if (kind !== 'questionnaire' && !(fieldIds as unknown[] | undefined)?.length) {
      throw new DiaryFormatError(`«${label}»: не указаны поля.`);
    }
    // A description writes one text field, a choice one field with options.
    const first = fields.find((field) => field.id === (fieldIds as string[] | undefined)?.[0]);
    if (
      (kind === 'text' && first?.type !== 'text') ||
      (kind === 'choice' && first?.type !== 'choice')
    ) {
      throw new DiaryFormatError(`«${label}»: поле не того вида.`);
    }
    if (kind === 'use') checkUseFields(label, fieldIds as string[], fields);
    const questionnaire = source['questionnaire'];
    if (
      kind === 'questionnaire' &&
      (typeof questionnaire !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(questionnaire))
    ) {
      throw new DiaryFormatError(`«${label}»: не указан опросник.`);
    }
    // An own questionnaire travels inside the checkpoint; a built-in one never does.
    const own = kind === 'questionnaire' && CUSTOM_QUESTIONNAIRE_SLUG.test(questionnaire as string);
    const custom = own ? parseCustomQuestionnaire(source['custom'], label) : undefined;
    if (kind === 'questionnaire' && source['custom'] !== undefined && !own) {
      throw new DiaryFormatError(`«${label}»: опросник врача должен называться own-….`);
    }
    const everyDays =
      source['everyDays'] === undefined ? undefined : finite(source['everyDays'], 'Период');
    if (
      everyDays !== undefined &&
      (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 90)
    ) {
      throw new DiaryFormatError(`«${label}»: период от 1 до 90 дней.`);
    }
    return {
      id,
      kind: kind as DiaryCheckpointKind,
      label,
      ...(times?.length ? { times } : {}),
      ...(kind !== 'questionnaire' ? { fields: fieldIds as string[] } : {}),
      ...(kind === 'questionnaire' ? { questionnaire: questionnaire as string } : {}),
      ...(custom ? { custom } : {}),
      ...(everyDays === undefined ? {} : { everyDays }),
      ...(source['ended'] === true ? { ended: true as const } : {}),
    };
  });
  if (new Set(checkpoints.map((checkpoint) => checkpoint.id)).size !== checkpoints.length) {
    throw new DiaryFormatError('Отметки дневника повторяются.');
  }
  if (checkpoints.filter((item) => item.kind === 'use' && !item.ended).length > 1) {
    throw new DiaryFormatError('Раздел «Употребление» может быть только один.');
  }
  const customChars = checkpoints.reduce(
    (total, checkpoint) =>
      total + (checkpoint.custom ? JSON.stringify(checkpoint.custom).length : 0),
    0,
  );
  if (customChars > MAX_DIARY_CUSTOM_TOTAL_CHARS) {
    throw new DiaryFormatError('Опросники врача слишком велики для одного дневника.');
  }
  return checkpoints;
}

function parseContacts(value: unknown): DiaryContact[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_CONTACTS) {
    throw new DiaryFormatError('Контакты врача некорректны.');
  }
  return value.map((item, index) => {
    const source = record(item, `Контакт ${index + 1}`);
    const kind = source['kind'];
    if (!CONTACT_KINDS.includes(kind as DiaryContactKind)) {
      throw new DiaryFormatError(`Контакт ${index + 1}: неизвестный вид.`);
    }
    const contact = text(source['value'], `Контакт ${index + 1}`);
    if (kind === 'link' && !/^https:\/\/[^\s]+$/u.test(contact)) {
      throw new DiaryFormatError(`Контакт ${index + 1}: ссылка должна начинаться с https://.`);
    }
    const label = text(source['label'], 'Подпись контакта', true);
    return { kind: kind as DiaryContactKind, value: contact, ...(label ? { label } : {}) };
  });
}

function parseTips(value: unknown): DiaryTip[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_TIPS) {
    throw new DiaryFormatError('Подсказки врача некорректны.');
  }
  return value.map((item, index) => {
    const source = record(item, `Подсказка ${index + 1}`);
    const id = source['id'];
    const target = source['target'];
    if (typeof id !== 'string' || !PLAN_ID_PATTERN.test(id)) {
      throw new DiaryFormatError(`Подсказка ${index + 1}: некорректный идентификатор.`);
    }
    if (typeof target !== 'string' || !PLAN_ID_PATTERN.test(target)) {
      throw new DiaryFormatError(`Подсказка ${index + 1}: не указано, к чему она.`);
    }
    return { id, target, text: longText(source['text'], `Подсказка ${index + 1}`) };
  });
}

function parseCrisis(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_CONTACTS) {
    throw new DiaryFormatError('Экстренные контакты некорректны.');
  }
  return value.map((line, index) => text(line, `Экстренный контакт ${index + 1}`));
}

function parseOperator(value: unknown): DiaryOperator | undefined {
  if (value === undefined) return undefined;
  const source = record(value, 'Реквизиты врача');
  const operator: Partial<Record<keyof DiaryOperator, string>> = {};
  for (const key of DIARY_OPERATOR_KEYS) {
    const part = text(source[key], 'Реквизиты врача', true);
    if (part) operator[key] = part;
  }
  return Object.keys(operator).length ? operator : undefined;
}

function parseAppointments(value: unknown): DiaryAppointment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_APPOINTMENTS) {
    throw new DiaryFormatError('Приёмы у врача некорректны.');
  }
  return value.map((item, index) => {
    const source = record(item, `Приём ${index + 1}`);
    const id = source['id'];
    const day = source['day'];
    const time = source['time'];
    if (typeof id !== 'string' || !PLAN_ID_PATTERN.test(id)) {
      throw new DiaryFormatError(`Приём ${index + 1}: некорректный идентификатор.`);
    }
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) {
      throw new DiaryFormatError(`Приём ${index + 1}: некорректная дата.`);
    }
    if (time !== undefined && (typeof time !== 'string' || !TIME_PATTERN.test(time))) {
      throw new DiaryFormatError(`Приём ${index + 1}: некорректное время.`);
    }
    const place = text(source['place'], 'Где приём', true);
    const note = text(source['note'], 'О приёме', true);
    return {
      id,
      day,
      ...(time ? { time } : {}),
      ...(place ? { place } : {}),
      ...(note ? { note } : {}),
    };
  });
}

function parseLabs(value: unknown, fields: readonly DiaryField[]): DiaryLabRequest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_LABS) {
    throw new DiaryFormatError('Анализы некорректны.');
  }
  return value.map((item, index) => {
    const source = record(item, `Анализ ${index + 1}`);
    const id = source['id'];
    const field = source['field'];
    const by = source['by'];
    if (typeof id !== 'string' || !PLAN_ID_PATTERN.test(id)) {
      throw new DiaryFormatError(`Анализ ${index + 1}: некорректный идентификатор.`);
    }
    if (!fields.some((one) => one.id === field && one.type === 'number')) {
      throw new DiaryFormatError(`Анализ ${index + 1}: нет поля для результата.`);
    }
    if (by !== undefined && (typeof by !== 'string' || !DAY_PATTERN.test(by))) {
      throw new DiaryFormatError(`Анализ ${index + 1}: некорректная дата.`);
    }
    const why = text(source['why'], 'Зачем анализ', true);
    return {
      id,
      name: text(source['name'], `Анализ ${index + 1}`),
      field: field as string,
      ...(typeof by === 'string' ? { by } : {}),
      ...(why ? { why } : {}),
    };
  });
}

function parseEmbeddedWorksheet(value: unknown, label: string): UserWorksheet {
  let worksheet: UserWorksheet;
  try {
    worksheet = parseUserWorksheet(value);
  } catch (cause) {
    throw new DiaryFormatError(
      `${label}: лист некорректен${cause instanceof Error ? ` (${cause.message})` : ''}.`,
    );
  }
  if (JSON.stringify(worksheet).length > MAX_DIARY_WORKSHEET_CHARS) {
    throw new DiaryFormatError(`«${worksheet.title}»: лист слишком большой для дневника.`);
  }
  return worksheet;
}

function parseAssignments(value: unknown): DiaryAssignment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DIARY_ASSIGNMENTS) {
    throw new DiaryFormatError('Задания некорректны.');
  }
  const assignments = value.map((item, index): DiaryAssignment => {
    const label = `Задание ${index + 1}`;
    const source = record(item, label);
    const id = source['id'];
    if (typeof id !== 'string' || !PLAN_ID_PATTERN.test(id)) {
      throw new DiaryFormatError(`${label}: некорректный идентификатор.`);
    }
    const worksheet = parseEmbeddedWorksheet(source['worksheet'], label);
    const repeat = source['repeat'];
    if (!DIARY_ASSIGNMENT_REPEATS.includes(repeat as DiaryAssignmentRepeat)) {
      throw new DiaryFormatError(`«${worksheet.title}»: не указано, как часто заполнять.`);
    }
    const daysValue = source['days'];
    let days: number[] | undefined;
    if (repeat === 'days') {
      if (
        !Array.isArray(daysValue) ||
        daysValue.length < 1 ||
        daysValue.length > 7 ||
        daysValue.some(
          (day) => typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7,
        )
      ) {
        throw new DiaryFormatError(`«${worksheet.title}»: выберите дни недели.`);
      }
      days = [...new Set(daysValue as number[])].toSorted((left, right) => left - right);
    } else if (daysValue !== undefined) {
      throw new DiaryFormatError(`«${worksheet.title}»: дни недели только для «по дням».`);
    }
    const time =
      source['time'] === undefined ? undefined : clockTime(source['time'], worksheet.title);
    const from = source['from'];
    const until = source['until'];
    if (typeof from !== 'string' || !DAY_PATTERN.test(from)) {
      throw new DiaryFormatError(`«${worksheet.title}»: некорректная дата начала.`);
    }
    if (
      until !== undefined &&
      (typeof until !== 'string' || !DAY_PATTERN.test(until) || until < from)
    ) {
      throw new DiaryFormatError(`«${worksheet.title}»: некорректная дата окончания.`);
    }
    const why = longText(source['why'], 'Зачем это вам', true);
    const what = longText(source['what'], 'Что и когда делать', true);
    return {
      id,
      worksheet,
      repeat: repeat as DiaryAssignmentRepeat,
      ...(days ? { days } : {}),
      ...(time && repeat !== 'event' ? { time } : {}),
      from,
      ...(typeof until === 'string' ? { until } : {}),
      ...(why ? { why } : {}),
      ...(what ? { what } : {}),
      ...(source['ended'] === true ? { ended: true as const } : {}),
    };
  });
  if (new Set(assignments.map((assignment) => assignment.id)).size !== assignments.length) {
    throw new DiaryFormatError('Задания повторяются.');
  }
  const chars = assignments.reduce(
    (total, assignment) => total + JSON.stringify(assignment.worksheet).length,
    0,
  );
  if (chars > MAX_DIARY_WORKSHEET_TOTAL_CHARS) {
    throw new DiaryFormatError('Задания слишком велики для одного дневника.');
  }
  return assignments;
}

/** ATC codes: level 1–5 codes like «N06AB06», at most a few per medicine. */
const ATC_PATTERN = /^[A-Z](?:\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?)?$/;
const MAX_ATC_CODES = 8;

function parseAtcCodes(value: unknown, index: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_ATC_CODES ||
    !value.every((code) => typeof code === 'string' && ATC_PATTERN.test(code))
  ) {
    throw new DiaryFormatError(`Пункт назначения ${index + 1}: некорректный код АТХ.`);
  }
  return [...new Set(value as string[])];
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
    const times = parseDoseTimes(source['times'], index);
    const form = text(source['form'], 'Форма', true);
    const signa = longText(source['signa'], 'Как принимать', true);
    const course = parseCourse(source['course'], index);
    const drug = text(source['drug'], 'Препарат из справочника', true);
    const atc = parseAtcCodes(source['atc'], index);
    const target = text(source['target'], 'Мишень', true);
    return {
      id,
      name: text(source['name'], `Пункт назначения ${index + 1}`),
      ...(dose ? { dose } : {}),
      ...(form ? { form } : {}),
      ...(signa ? { signa } : {}),
      ...(course?.length ? { course } : {}),
      ...(schedule ? { schedule } : {}),
      ...(times?.length ? { times } : {}),
      ...(source['asNeeded'] === true ? { asNeeded: true } : {}),
      ...(source['ended'] === true ? { ended: true } : {}),
      ...(drug ? { drug } : {}),
      ...(atc?.length ? { atc } : {}),
      ...(target ? { target } : {}),
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
  const checkpoints = parseCheckpoints(source['checkpoints'], fields);
  const contacts = parseContacts(source['contacts']);
  const tips = parseTips(source['tips']);
  const crisis = parseCrisis(source['crisis']);
  const operator = parseOperator(source['operator']);
  const appointments = parseAppointments(source['appointments']);
  const labs = parseLabs(source['labs'], fields);
  const assignments = parseAssignments(source['assignments']);
  const study = parseStudy(source['study']);
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
    ...(checkpoints.length ? { checkpoints } : {}),
    ...(contacts.length ? { contacts } : {}),
    ...(tips.length ? { tips } : {}),
    ...(crisis.length ? { crisis } : {}),
    ...(source['consent'] === true ? { consent: true } : {}),
    ...(operator ? { operator } : {}),
    ...(appointments.length ? { appointments } : {}),
    ...(labs.length ? { labs } : {}),
    ...(assignments.length ? { assignments } : {}),
    ...(study ? { study } : {}),
  };
}

function parseStudy(value: unknown): DiaryStudy | undefined {
  if (value === undefined) return undefined;
  const source = record(value, 'Исследование');
  const body = source['text'];
  if (
    typeof body !== 'string' ||
    body.length > MAX_DIARY_STUDY_TEXT ||
    hasControlCharacter(body, true) ||
    !body.trim()
  ) {
    throw new DiaryFormatError('Исследование: некорректный текст согласия.');
  }
  return {
    id: identifier(source['id'], 'Исследование'),
    title: text(source['title'], 'Название исследования'),
    protocol: text(source['protocol'], 'Номер протокола'),
    version: text(source['version'], 'Версия протокола'),
    // Verbatim: the lines are the committee's, only the edges are trimmed.
    text: body.trim(),
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
      return longText(value, field.label);
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
      const slot =
        source['slot'] === undefined ? undefined : clockTime(source['slot'], field.label);
      const dose = text(source['dose'], field.label, true);
      // An unknown reason (a newer app's) is dropped, not refused: the mark itself still counts.
      const reason =
        done === false && isDiaryMissReason(source['reason']) ? source['reason'] : undefined;
      return {
        ...(typeof item === 'string' ? { item } : {}),
        ...(other && item === undefined ? { other } : {}),
        ...(typeof done === 'boolean' ? { done } : {}),
        ...(slot ? { slot } : {}),
        ...(dose && typeof item === 'string' ? { dose } : {}),
        ...(reason ? { reason } : {}),
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
  const note = longText(source['note'], 'Комментарий', true);
  const check = source['check'];
  if (
    check !== undefined &&
    !invitation.checkpoints?.some((checkpoint) => checkpoint.id === check)
  ) {
    throw new DiaryFormatError('Запись ссылается на неизвестную отметку.');
  }
  const answers = parseAnswers(source['answers']);
  const voice = parseVoice(source['voice']);
  const assignmentId = source['assignment'];
  if (
    assignmentId !== undefined &&
    !invitation.assignments?.some((assignment) => assignment.id === assignmentId)
  ) {
    throw new DiaryFormatError('Запись ссылается на неизвестное задание.');
  }
  const sheet = parseSheet(source['sheet']);
  if (sheet && assignmentId === undefined) {
    throw new DiaryFormatError('Лист задания без задания.');
  }
  const spoken = parseSpoken(source['spoken']);
  const insights = parseInsights(source['insights']);
  const visitScale = source['visitScale'];
  if (visitScale !== undefined) {
    // A rating at a visit is answers to one scale and nothing else.
    if (
      typeof visitScale !== 'string' ||
      !VISIT_SCALE_PATTERN.test(visitScale) ||
      !answers ||
      check !== undefined ||
      assignmentId !== undefined ||
      voice ||
      sheet
    ) {
      throw new DiaryFormatError('Оценка на приёме некорректна.');
    }
  }
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
  if (Object.keys(values).length === 0 && !note && !answers && !voice && !sheet) {
    throw new DiaryFormatError('Заполните хотя бы одно поле.');
  }
  const answered = invitation.checkpoints?.find((candidate) => candidate.id === check);
  if (answered?.kind === 'use' && Object.keys(values).length === 0) {
    throw new DiaryFormatError('Отметьте употребление или «Ничего не было».');
  }
  return {
    id: identifier(source['id'], 'Запись'),
    at: timestamp(source['at'], 'Дата записи', now),
    values,
    ...(note ? { note } : {}),
    ...(typeof check === 'string' ? { check } : {}),
    ...(answers ? { answers } : {}),
    ...(source['corrected'] === true ? { corrected: true as const } : {}),
    ...(voice ? { voice } : {}),
    ...(typeof assignmentId === 'string' ? { assignment: assignmentId } : {}),
    ...(sheet ? { sheet } : {}),
    ...(spoken ? { spoken } : {}),
    ...(insights ? { insights } : {}),
    ...(typeof visitScale === 'string' ? { visitScale } : {}),
  };
}

const VISIT_SCALE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

const SHEET_KEY_PATTERN = /^[a-z][a-z0-9-]{0,23}$/u;

/**
 * The cells of a worksheet entry, checked for shape only: the doctor may later rename, retype or
 * drop a column, and what the patient wrote then still has to load. The fill form checks each
 * cell against its column (`worksheetSheetProblem`) before saving.
 */
function parseSheet(value: unknown): Record<string, DiarySheetValue> | undefined {
  if (value === undefined) return undefined;
  const source = record(value, 'Лист задания');
  const keys = Object.keys(source);
  if (keys.length > MAX_SHEET_CELLS) throw new DiaryFormatError('Лист задания некорректен.');
  const sheet: Record<string, DiarySheetValue> = {};
  let total = 0;
  for (const key of keys) {
    if (!SHEET_KEY_PATTERN.test(key)) throw new DiaryFormatError('Лист задания некорректен.');
    const cell = source[key];
    if (typeof cell === 'number') {
      sheet[key] = finite(cell, 'Лист задания');
    } else if (typeof cell === 'string') {
      if (cell.length > MAX_DIARY_SHEET_TEXT || hasControlCharacter(cell, true)) {
        throw new DiaryFormatError('Лист задания: некорректный текст.');
      }
      const trimmed = cell.trim();
      if (!trimmed) continue;
      total += trimmed.length;
      sheet[key] = trimmed;
    } else if (Array.isArray(cell)) {
      if (cell.length > MAX_DIARY_OPTIONS) throw new DiaryFormatError('Лист задания некорректен.');
      const chosen = [...new Set(cell)].map((option) => text(option, 'Лист задания'));
      total += chosen.join('').length;
      if (chosen.length) sheet[key] = chosen;
    } else {
      throw new DiaryFormatError('Лист задания некорректен.');
    }
  }
  if (total > MAX_DIARY_SHEET_TOTAL) throw new DiaryFormatError('Лист задания слишком длинный.');
  return Object.keys(sheet).length ? sheet : undefined;
}

const ENGINE_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/u;
/** A worksheet column, or the entry's own note / own-words text. */
const SPOKEN_TARGET_PATTERN = /^(?:#note|#state|[a-z][a-z0-9-]{0,23})$/u;

function parseSpoken(value: unknown): DiarySpoken[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SPOKEN) {
    throw new DiaryFormatError('Отметки о голосе некорректны.');
  }
  const spoken = value.map((item): DiarySpoken => {
    const source = record(item, 'Голос');
    const { target, seconds, engine } = source;
    if (
      typeof target !== 'string' ||
      !SPOKEN_TARGET_PATTERN.test(target) ||
      typeof engine !== 'string' ||
      !ENGINE_PATTERN.test(engine) ||
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > 3600
    ) {
      throw new DiaryFormatError('Отметки о голосе некорректны.');
    }
    const clip = source['clip'];
    if (clip !== undefined && (typeof clip !== 'string' || !ID_PATTERN.test(clip))) {
      throw new DiaryFormatError('Отметки о голосе некорректны.');
    }
    return {
      target,
      seconds: Math.round(seconds),
      engine,
      ...(source['edited'] === true ? { edited: true as const } : {}),
      ...(typeof clip === 'string' ? { clip } : {}),
    };
  });
  return spoken.length ? spoken : undefined;
}

function parseSpans(value: unknown): DiaryTextSpan[] {
  if (!Array.isArray(value) || value.length > 40) {
    throw new DiaryFormatError('Разбор голоса некорректен.');
  }
  return value.map((item) => {
    const source = record(item, 'Разбор голоса');
    const { from, to } = source;
    if (
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to <= from ||
      to > MAX_DIARY_NOTE
    ) {
      throw new DiaryFormatError('Разбор голоса некорректен.');
    }
    return { from, to };
  });
}

function parseInsights(value: unknown): DiaryVoiceInsight[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SPOKEN) {
    throw new DiaryFormatError('Разбор голоса некорректен.');
  }
  const insights = value.map((item): DiaryVoiceInsight => {
    const source = record(item, 'Разбор голоса');
    const target = source['target'];
    const model = source['model'];
    if (
      typeof target !== 'string' ||
      !SPOKEN_TARGET_PATTERN.test(target) ||
      typeof model !== 'string' ||
      !ENGINE_PATTERN.test(model)
    ) {
      throw new DiaryFormatError('Разбор голоса некорректен.');
    }
    const toneValue = source['tone'];
    if (!Array.isArray(toneValue) || toneValue.length > 8) {
      throw new DiaryFormatError('Разбор голоса некорректен.');
    }
    return {
      target,
      simplified: longText(source['simplified'], 'Упрощённый текст'),
      tone: toneValue.map((tone) => {
        const part = record(tone, 'Тон');
        return { label: text(part['label'], 'Тон'), spans: parseSpans(part['spans']) };
      }),
      model,
      at: timestamp(source['at'], 'Разбор голоса', Date.now()),
    };
  });
  return insights.length ? insights : undefined;
}

function parseVoice(value: unknown): DiaryVoice | undefined {
  if (value === undefined) return undefined;
  const source = record(value, 'Голосовая запись');
  const { mime, data, seconds } = source;
  if (
    typeof mime !== 'string' ||
    !VOICE_MIME.test(mime) ||
    typeof data !== 'string' ||
    data.length === 0 ||
    data.length > MAX_DIARY_VOICE_CHARS ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(data) ||
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 600
  ) {
    throw new DiaryFormatError('Голосовая запись некорректна.');
  }
  return { mime, data, seconds: Math.round(seconds) };
}

/** The results without voice recordings: for QR codes, which cannot carry them. */
export function withoutVoices(results: DiaryResults): DiaryResults {
  return {
    ...results,
    entries: results.entries.map(({ voice: _voice, ...entry }) => entry),
  };
}

function parseAnswers(value: unknown): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  const source = record(value, 'Ответы опросника');
  const keys = Object.keys(source);
  if (keys.length === 0 || keys.length > MAX_ANSWERS) {
    throw new DiaryFormatError('Ответы опросника некорректны.');
  }
  const answers: Record<string, number> = {};
  for (const key of keys) {
    const answer = source[key];
    if (
      !ANSWER_ID_PATTERN.test(key) ||
      typeof answer !== 'number' ||
      !Number.isInteger(answer) ||
      answer < -10 ||
      answer > 100
    ) {
      throw new DiaryFormatError('Ответы опросника некорректны.');
    }
    answers[key] = answer;
  }
  return answers;
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
  let medHistory: readonly PastMedication[];
  try {
    medHistory = parsePastMedications(source['medHistory']);
  } catch (cause) {
    if (cause instanceof PastMedFormatError) throw new DiaryFormatError(cause.message);
    throw cause;
  }
  return {
    v: DIARY_FORMAT_VERSION,
    invitation,
    entries: parsed.toSorted((left, right) => left.at.localeCompare(right.at)),
    ...(medHistory.length ? { medHistory } : {}),
  };
}

// --- Presentation ----------------------------------------------------------------------------

export function planItem(
  invitation: DiaryInvitation,
  id: string | undefined,
): DiaryPlanItem | undefined {
  return id === undefined ? undefined : invitation.plan?.find((item) => item.id === id);
}

/** The dose of one intake of an item under the current plan: the time's own dose, else the item's. */
export function intakeDose(item: DiaryPlanItem, slot?: string): string | undefined {
  return item.times?.find((time) => time.time === slot)?.dose ?? item.dose;
}

/** A new intake mark of a plan item, carrying the dose the plan asks for now. */
export function intakeMark(item: DiaryPlanItem, done: boolean, slot?: string): DiaryPlanValue {
  const dose = intakeDose(item, slot);
  return { item: item.id, done, ...(slot ? { slot } : {}), ...(dose ? { dose } : {}) };
}

/** The dose a mark was taken at: recorded with the mark, else the plan's current dose. */
export function markedDose(
  invitation: DiaryInvitation,
  value: DiaryPlanValue | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value.dose) return value.dose;
  const item = planItem(invitation, value.item);
  return item ? intakeDose(item, value.slot) : undefined;
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
  const name = item
    ? [item.name, markedDose(invitation, plan)].filter(Boolean).join(' ')
    : (plan.other ?? '');
  const done =
    plan.done === undefined
      ? ''
      : plan.done
        ? ' — выполнено'
        : ` — пропущено${plan.reason ? `: ${DIARY_MISS_REASON_SHORT[plan.reason]}` : ''}`;
  return `${name}${done}`;
}

/** One human-readable line per entry, shared by the patient page and the doctor preview. */
export function describeDiaryEntry(invitation: DiaryInvitation, entry: DiaryEntry): string {
  const byId = new Map(invitation.fields.map((field) => [field.id, field]));
  const checkpoint = entry.check
    ? invitation.checkpoints?.find((candidate) => candidate.id === entry.check)
    : undefined;
  // Substance use reads as one phrase («алкоголь 2 порции · тяга 6»), not a field per substance.
  const use = checkpoint?.kind === 'use' ? substanceSummary(entry.values) : undefined;
  const pressure =
    typeof entry.values['systolic'] === 'number' && typeof entry.values['diastolic'] === 'number'
      ? `${entry.values['systolic']}/${entry.values['diastolic']} мм рт. ст.`
      : undefined;
  const parts = use
    ? []
    : invitation.fields.flatMap((field) => {
        if (pressure && (field.id === 'systolic' || field.id === 'diastolic')) return [];
        const value = entry.values[field.id];
        return value === undefined
          ? []
          : [describeDiaryValue(invitation, byId.get(field.id) ?? field, value)];
      });
  const answers = entry.answers ? Object.keys(entry.answers).length : 0;
  const plan = entry.values['medication'] as DiaryPlanValue | undefined;
  const assignment = entry.assignment
    ? invitation.assignments?.find((candidate) => candidate.id === entry.assignment)
    : undefined;
  // A worksheet row: its title and the first cells it has, by column order.
  const sheet = assignment
    ? assignment.worksheet.fields
        .flatMap((field) => {
          const value = entry.sheet?.[field.id];
          if (value === undefined) return [];
          return [Array.isArray(value) ? value.join(', ') : String(value)];
        })
        .slice(0, 2)
        .map((part) => (part.length > 60 ? `${part.slice(0, 59)}…` : part))
    : [];
  return [
    assignment?.worksheet.title,
    ...sheet,
    checkpoint?.kind === 'vitals' ? undefined : checkpoint?.label,
    answers ? `ответы на ${answers} вопр.` : undefined,
    entry.voice ? `голосовая запись, ${entry.voice.seconds} с` : undefined,
    pressure,
    ...parts,
    use,
    plan?.slot ? `по плану ${plan.slot}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

// --- Templates -------------------------------------------------------------------------------

export interface DiaryTemplate {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly fields: readonly DiaryField[];
  /**
   * A day plan: timed intakes, checkpoints, questionnaires and contacts edited by the doctor; the
   * patient's page is the day's checklist instead of a single entry form.
   */
  readonly care?: true;
  readonly checkpoints?: readonly DiaryCheckpoint[];
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

/**
 * Glucose, activity and meals (owner 2026-11-04): measurements a section of the care diary adds
 * when the doctor asks for them. They are `vitals` checkpoints of number fields, so a patient's
 * diary that does not know them yet still asks them as numbers.
 */
export const GLUCOSE_FIELD: DiaryField = {
  id: 'glucose',
  type: 'number',
  label: 'Глюкоза',
  unit: 'ммоль/л',
  min: 1,
  max: 35,
  step: 0.1,
};
export const STEPS_FIELD: DiaryField = {
  id: 'steps',
  type: 'number',
  label: 'Шаги',
  unit: 'шагов',
  min: 0,
  max: 100_000,
  step: 1,
};
export const ACTIVITY_FIELD: DiaryField = {
  id: 'activity',
  type: 'number',
  label: 'Активные минуты',
  unit: 'мин',
  min: 0,
  max: 1440,
  step: 1,
};
export const MEALS_FIELD: DiaryField = {
  id: 'meals',
  type: 'number',
  label: 'Приёмов пищи',
  unit: 'за день',
  min: 0,
  max: 10,
  step: 1,
};
export const APPETITE_FIELD: DiaryField = {
  id: 'appetite',
  type: 'number',
  label: 'Аппетит',
  unit: 'из 10',
  min: 0,
  max: 10,
  step: 1,
};

/** Vitals and wellbeing preset of the care diary (the doctor can switch checkpoints off). */
export const CARE_CHECKPOINTS: readonly DiaryCheckpoint[] = [
  {
    id: 'am',
    kind: 'score',
    label: 'Самочувствие утром',
    times: ['09:00'],
    fields: ['wellbeing'],
  },
  {
    id: 'pm',
    kind: 'score',
    label: 'Самочувствие вечером',
    times: ['21:00'],
    fields: ['wellbeing'],
  },
  {
    id: 'vitals',
    kind: 'vitals',
    label: 'Пульс, давление, сатурация',
    times: ['09:00'],
    fields: ['pulse', 'systolic', 'diastolic', 'spo2'],
  },
];

export const DIARY_TEMPLATES: readonly DiaryTemplate[] = [
  {
    id: 'care',
    title: 'Дневник лечения',
    summary:
      'Приём лекарств по времени, самочувствие утром и вечером, пульс, давление, сатурация, опросники.',
    planTitle: 'Лекарства',
    planHint: 'Пациент отмечает каждый приём в списке дня и может описать самочувствие после него.',
    care: true,
    checkpoints: CARE_CHECKPOINTS,
    fields: [
      MEDICATION_FIELD,
      {
        id: 'after',
        type: 'multi',
        label: 'После приёма',
        options: [
          'стало лучше',
          'без изменений',
          'стало хуже',
          'сонливость',
          'тревога',
          'тошнота',
          'головная боль',
          'головокружение',
          'другое',
        ],
      },
      {
        id: 'wellbeing',
        type: 'number',
        label: 'Самочувствие',
        unit: 'из 10',
        min: 0,
        max: 10,
        step: 1,
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
      {
        id: 'systolic',
        type: 'number',
        label: 'Давление верхнее',
        unit: 'мм рт. ст.',
        min: 50,
        max: 300,
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
        label: 'Давление нижнее',
        unit: 'мм рт. ст.',
        min: 30,
        max: 200,
        lessThan: 'systolic',
        metric: {
          metricId: 'blood-pressure-diastolic',
          label: 'Давление: диастолическое',
          loinc: '8462-4',
          ucum: 'mm[Hg]',
        },
      },
      {
        id: 'spo2',
        type: 'number',
        label: 'Сатурация',
        unit: '%',
        min: 50,
        max: 100,
        metric: { metricId: 'oxygen-saturation', label: 'SpO₂', loinc: '59408-5', ucum: '%' },
      },
      { id: 'state', type: 'text', label: 'Описание состояния' },
      { id: 'mood', type: 'number', label: 'Настроение', unit: 'из 10', min: 0, max: 10, step: 1 },
      {
        id: 'weight',
        type: 'number',
        label: 'Вес',
        unit: 'кг',
        min: 20,
        max: 300,
        step: 0.1,
        metric: { metricId: 'body-mass', label: 'Масса тела', loinc: '29463-7', ucum: 'kg' },
      },
      {
        id: 'height',
        type: 'number',
        label: 'Рост',
        unit: 'см',
        min: 50,
        max: 250,
        metric: { metricId: 'body-height', label: 'Рост', loinc: '8302-2', ucum: 'cm' },
      },
    ],
  },
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
    planHint: 'Пациент сможет выбрать из списка или вписать своё.',
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

/** The diary is a day plan (checklist page) rather than a single entry form. */
export function isCareDiary(invitation: DiaryInvitation): boolean {
  return diaryTemplate(invitation.template)?.care === true;
}
