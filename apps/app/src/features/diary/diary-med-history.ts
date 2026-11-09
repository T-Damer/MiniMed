/**
 * Medicines taken before (MEDHIST1, owner 2026-11-09: «нужно разрешить вносить данные о прошлых
 * препаратах и их непереносимости/реакции/опыте (сроке) использования»). One medicine is one
 * encrypted record `h-<id>` of the connected diary: the patient's phone, a carer's and the doctors
 * all write it, and the newest revision wins. A diary without a service keeps the list on the phone,
 * inside its results, so the file for the doctor carries it (QR codes do not: no room).
 *
 * Nothing here judges a medicine. The prescribing warning states only that the history holds the
 * same medicine or a medicine of the same ATC group (level 4) with a reaction; it makes no claim
 * about cross-reactivity.
 */
import { type ErrorStates, err, ok, type TypedResult } from '@localmed/contracts';
export const PAST_MED_RECORD_PREFIX = 'h-';
export const MAX_PAST_MEDS = 60;

export const PAST_MED_STOPS = ['ineffective', 'side-effects', 'intolerance', 'other'] as const;
export type PastMedStop = (typeof PAST_MED_STOPS)[number];

export const PAST_MED_STOP_LABEL: Readonly<Record<PastMedStop, string>> = {
  ineffective: 'Не помогал',
  'side-effects': 'Побочные эффекты',
  intolerance: 'Непереносимость',
  other: 'Другая причина',
};

/** Four steps named after CTCAE v5.0 grades 1–4 (grade 5, death, is not a diary answer). */
export const PAST_MED_SEVERITIES = ['mild', 'moderate', 'severe', 'life-threatening'] as const;
export type PastMedSeverity = (typeof PAST_MED_SEVERITIES)[number];

export const PAST_MED_SEVERITY_LABEL: Readonly<Record<PastMedSeverity, string>> = {
  mild: 'Лёгкая',
  moderate: 'Средняя',
  severe: 'Тяжёлая',
  'life-threatening': 'Угрожала жизни',
};

export const PAST_MED_ALLERGY = ['yes', 'no', 'unknown'] as const;
export type PastMedAllergy = (typeof PAST_MED_ALLERGY)[number];

export const PAST_MED_ALLERGY_LABEL: Readonly<Record<PastMedAllergy, string>> = {
  yes: 'Да',
  no: 'Нет',
  unknown: 'Не знаю',
};

export const PAST_MED_EFFECTS = ['helped', 'partly', 'no', 'unsure'] as const;
export type PastMedEffect = (typeof PAST_MED_EFFECTS)[number];

export const PAST_MED_EFFECT_LABEL: Readonly<Record<PastMedEffect, string>> = {
  helped: 'Помог',
  partly: 'Отчасти',
  no: 'Не помог',
  unsure: 'Трудно сказать',
};

export type PastMedAuthor = 'doctor' | 'patient' | 'carer';

export const PAST_MED_AUTHOR_LABEL: Readonly<Record<PastMedAuthor, string>> = {
  doctor: 'врач',
  patient: 'пациент',
  carer: 'близкий',
};

export interface PastMedication {
  readonly id: string;
  /** What the patient or the doctor calls it: the МНН when picked from the catalog, or own words. */
  readonly name: string;
  /** ЕСКЛП МНН card slug, when picked from the catalog. */
  readonly slug?: string;
  /** ATC codes of the picked card. */
  readonly atc?: readonly string[];
  readonly dose?: string;
  /** Began: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  readonly from?: string;
  /** Ended: same precision rules. */
  readonly to?: string;
  /** The dates are approximate. */
  readonly approx?: true;
  /** How long, in words: «около года», «2 недели». */
  readonly duration?: string;
  readonly stop?: PastMedStop;
  /** The other reason, in words. */
  readonly stopNote?: string;
  /** What happened: «сыпь на третий день». */
  readonly reaction?: string;
  readonly severity?: PastMedSeverity;
  readonly allergy?: PastMedAllergy;
  readonly effect?: PastMedEffect;
  readonly note?: string;
  /** Plan item this medicine came from when the doctor took it off the plan. */
  readonly planItem?: string;
  /** Who saved this version and when (ISO). */
  readonly by: PastMedAuthor;
  readonly updatedAt: string;
}

export class PastMedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PastMedFormatError';
  }
}

const LIMITS = {
  name: 120,
  dose: 60,
  duration: 60,
  stopNote: 300,
  reaction: 500,
  note: 1000,
} as const;

/** Lower-case letters and digits: the id is part of the record id (`[a-z0-9-]{1,40}`). */
const ID_PATTERN = /^[a-z0-9]{4,32}$/u;
const PLAN_ITEM_PATTERN = /^[A-Za-z0-9_-]{1,40}$/u;
const SLUG_PATTERN = /^[a-z0-9._-]{1,120}$/u;
const ATC_PATTERN = /^[A-Z](?:\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?)?$/u;
const WHEN_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u;

export function pastMedRecordId(id: string): string {
  return PAST_MED_RECORD_PREFIX + id;
}

export function isPastMedRecord(recordId: string): boolean {
  return recordId.startsWith(PAST_MED_RECORD_PREFIX);
}

/** A partial date `YYYY`, `YYYY-MM` or `YYYY-MM-DD` that exists and is not after today. */
export function isPastMedWhen(value: string, today: Date = new Date()): boolean {
  const match = WHEN_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  if (year < 1900 || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return value <= todayKey.slice(0, value.length);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(
  source: Readonly<Record<string, unknown>>,
  key: keyof typeof LIMITS,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > LIMITS[key]) {
    throw new PastMedFormatError(`Поле «${key}» некорректно.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalOf<T extends string>(
  source: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new PastMedFormatError(`Поле «${key}» некорректно.`);
  }
  return value as T;
}

/** Validates one medicine from another device; throws {@link PastMedFormatError}. */
export function parsePastMedication(value: unknown, today: Date = new Date()): PastMedication {
  if (!isObject(value)) throw new PastMedFormatError('Препарат без содержимого.');
  const id = value['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new PastMedFormatError('Ключ препарата некорректен.');
  }
  const name = value['name'];
  if (typeof name !== 'string' || !name.trim() || name.length > LIMITS.name) {
    throw new PastMedFormatError('Название препарата некорректно.');
  }
  const slug = value['slug'];
  if (slug !== undefined && (typeof slug !== 'string' || !SLUG_PATTERN.test(slug))) {
    throw new PastMedFormatError('Карточка препарата некорректна.');
  }
  const atc = value['atc'];
  if (
    atc !== undefined &&
    (!Array.isArray(atc) ||
      atc.length > 12 ||
      !atc.every((code) => typeof code === 'string' && ATC_PATTERN.test(code)))
  ) {
    throw new PastMedFormatError('Коды АТХ некорректны.');
  }
  const when = (key: 'from' | 'to'): string | undefined => {
    const raw = value[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !isPastMedWhen(raw, today)) {
      throw new PastMedFormatError('Дата приёма некорректна.');
    }
    return raw;
  };
  const from = when('from');
  const to = when('to');
  if (from && to && from.slice(0, Math.min(from.length, to.length)) > to) {
    throw new PastMedFormatError('Начало приёма позже конца.');
  }
  const by = optionalOf(value, 'by', ['doctor', 'patient', 'carer'] as const);
  const updatedAt = value['updatedAt'];
  if (!by || typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw new PastMedFormatError('Не указано, кто внёс препарат.');
  }
  const planItem = value['planItem'];
  if (
    planItem !== undefined &&
    (typeof planItem !== 'string' || !PLAN_ITEM_PATTERN.test(planItem))
  ) {
    throw new PastMedFormatError('Ссылка на назначение некорректна.');
  }
  const dose = optionalText(value, 'dose');
  const duration = optionalText(value, 'duration');
  const stop = optionalOf(value, 'stop', PAST_MED_STOPS);
  const stopNote = optionalText(value, 'stopNote');
  const reaction = optionalText(value, 'reaction');
  const severity = optionalOf(value, 'severity', PAST_MED_SEVERITIES);
  const allergy = optionalOf(value, 'allergy', PAST_MED_ALLERGY);
  const effect = optionalOf(value, 'effect', PAST_MED_EFFECTS);
  const note = optionalText(value, 'note');
  return {
    id,
    name: name.trim(),
    ...(slug === undefined ? {} : { slug }),
    ...(atc === undefined || !atc.length ? {} : { atc: atc as string[] }),
    ...(dose ? { dose } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(value['approx'] === true ? { approx: true as const } : {}),
    ...(duration ? { duration } : {}),
    ...(stop ? { stop } : {}),
    ...(stopNote ? { stopNote } : {}),
    ...(reaction ? { reaction } : {}),
    ...(severity ? { severity } : {}),
    ...(allergy ? { allergy } : {}),
    ...(effect ? { effect } : {}),
    ...(note ? { note } : {}),
    ...(planItem === undefined ? {} : { planItem }),
    by,
    updatedAt,
  };
}

/** A list read from a saved diary or a file: the bad ones are left out, duplicates keep the newest. */
export function parsePastMedications(value: unknown): readonly PastMedication[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PastMedFormatError('Список препаратов некорректен.');
  const byId = new Map<string, PastMedication>();
  for (const raw of value.slice(0, MAX_PAST_MEDS * 2)) {
    let item: PastMedication;
    try {
      item = parsePastMedication(raw);
    } catch (cause) {
      if (cause instanceof PastMedFormatError) continue;
      throw cause;
    }
    const known = byId.get(item.id);
    if (!known || known.updatedAt <= item.updatedAt) byId.set(item.id, item);
  }
  return sortPastMedications([...byId.values()]).slice(0, MAX_PAST_MEDS);
}

/** What the doctor would see of one medicine: a change of any field sends it again. */
export function pastMedFingerprint(item: PastMedication): string {
  return JSON.stringify(item);
}

/** The diary with this list of medicines (sorted; the key is dropped when the list is empty). */
export function withMedHistory<T extends { readonly medHistory?: readonly PastMedication[] }>(
  results: T,
  items: readonly PastMedication[],
): T {
  const { medHistory: _old, ...rest } = results;
  const sorted = sortPastMedications(items).slice(0, MAX_PAST_MEDS);
  return (sorted.length ? { ...rest, medHistory: sorted } : rest) as T;
}

/** Two copies of one list: every medicine of both, the newer version of one kept. */
export function mergePastMedications(
  left: readonly PastMedication[] = [],
  right: readonly PastMedication[] = [],
): PastMedication[] {
  const byId = new Map<string, PastMedication>();
  for (const item of [...left, ...right]) {
    const known = byId.get(item.id);
    if (!known || known.updatedAt < item.updatedAt) byId.set(item.id, item);
  }
  return sortPastMedications([...byId.values()]).slice(0, MAX_PAST_MEDS);
}

/** Who wrote a record revision, as the item names it: `d:` a doctor, `p:` a phone. */
export function authorMatches(item: PastMedication, revisionAuthor: string): boolean {
  return revisionAuthor.startsWith('d:') ? item.by === 'doctor' : item.by !== 'doctor';
}

// --- What matters -------------------------------------------------------------------------------

export type PastMedConcern = 'allergy' | 'intolerance' | 'side-effects';

/** Why this medicine needs the doctor's eye, the strongest reason first; none for a plain record. */
export function pastMedConcern(item: PastMedication): PastMedConcern | undefined {
  if (item.allergy === 'yes') return 'allergy';
  if (
    item.stop === 'intolerance' ||
    item.severity === 'severe' ||
    item.severity === 'life-threatening'
  ) {
    return 'intolerance';
  }
  if (item.stop === 'side-effects' || item.reaction || item.severity) return 'side-effects';
  return undefined;
}

export const PAST_MED_CONCERN_LABEL: Readonly<Record<PastMedConcern, string>> = {
  allergy: 'Аллергия',
  intolerance: 'Непереносимость',
  'side-effects': 'Побочные эффекты',
};

const CONCERN_ORDER: Readonly<Record<PastMedConcern | 'none', number>> = {
  allergy: 0,
  intolerance: 1,
  'side-effects': 2,
  none: 3,
};

/** Allergies first, then intolerance and side effects, then the rest; newest first inside. */
export function sortPastMedications(items: readonly PastMedication[]): PastMedication[] {
  return items.toSorted(
    (left, right) =>
      CONCERN_ORDER[pastMedConcern(left) ?? 'none'] -
        CONCERN_ORDER[pastMedConcern(right) ?? 'none'] ||
      (right.to ?? right.from ?? '').localeCompare(left.to ?? left.from ?? '') ||
      left.name.localeCompare(right.name, 'ru'),
  );
}

// --- Words --------------------------------------------------------------------------------------

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

const MONTHS_OF = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/**
 * `2022` → «2022», `2022-03` → «март 2022» («марта 2022» after «с», «до»), `2022-03-14` →
 * «14.03.2022».
 */
export function pastMedWhenWords(when: string, genitive = false): string {
  const [year, month, day] = when.split('-');
  if (day) return `${day}.${month}.${year}`;
  if (month) return `${(genitive ? MONTHS_OF : MONTHS)[Number(month) - 1]} ${year}`;
  return year ?? when;
}

/** «≈ март 2021 — 2022, около года», «с марта 2023»; empty when nothing is known. */
export function pastMedPeriod(item: PastMedication): string {
  const from = item.from ? pastMedWhenWords(item.from) : '';
  const to = item.to ? pastMedWhenWords(item.to) : '';
  const range =
    from && to
      ? from === to
        ? from
        : `${from} — ${to}`
      : item.from
        ? `с ${pastMedWhenWords(item.from, true)}`
        : item.to
          ? `до ${pastMedWhenWords(item.to, true)}`
          : '';
  const dated = range && item.approx ? `≈ ${range}` : range;
  return [dated, item.duration].filter(Boolean).join(', ');
}

/** One line under the name: what happened and how bad. */
export function pastMedOutcome(item: PastMedication): string {
  const parts: string[] = [];
  if (item.stop) {
    parts.push(
      item.stop === 'other' && item.stopNote
        ? item.stopNote
        : PAST_MED_STOP_LABEL[item.stop].toLowerCase(),
    );
  }
  if (item.reaction) parts.push(item.reaction);
  if (item.severity) parts.push(`тяжесть: ${PAST_MED_SEVERITY_LABEL[item.severity].toLowerCase()}`);
  if (item.effect) parts.push(`эффект: ${PAST_MED_EFFECT_LABEL[item.effect].toLowerCase()}`);
  return parts.join(' · ');
}

// --- Prescribing warning -------------------------------------------------------------------------

export interface PrescribedDrug {
  readonly name: string;
  /** The trade name the doctor typed, when it differs from the МНН. */
  readonly product?: string | null;
  readonly slug?: string;
  readonly atc?: readonly string[];
}

export interface PastMedWarning {
  readonly item: PastMedication;
  readonly concern: PastMedConcern;
  /** `same`: the same medicine; `group`: the same ATC level-4 group. */
  readonly match: 'same' | 'group';
  /** The shared ATC code (level 5 for `same` when known, level 4 for `group`). */
  readonly code?: string;
}

function normalizedName(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

/** Level-4 codes of a list: `J01CA04` → `J01CA`; a level-4 code stays itself. */
function groupCodes(codes: readonly string[]): Set<string> {
  return new Set(codes.filter((code) => code.length >= 5).map((code) => code.slice(0, 5)));
}

/**
 * Medicines of the history with a reaction that match the one being prescribed: the same card,
 * the same ATC substance code or the same name; otherwise the same ATC level-4 group.
 */
export function prescribingWarnings(
  history: readonly PastMedication[],
  drug: PrescribedDrug,
): PastMedWarning[] {
  const names = new Set(
    [drug.name, drug.product ?? ''].map(normalizedName).filter((name) => name.length > 2),
  );
  if (!names.size && !drug.atc?.length) return [];
  const substances = new Set((drug.atc ?? []).filter((code) => code.length === 7));
  const groups = groupCodes(drug.atc ?? []);
  const warnings: PastMedWarning[] = [];
  for (const item of sortPastMedications(history)) {
    const concern = pastMedConcern(item);
    if (!concern) continue;
    const sameCode = (item.atc ?? []).find((code) => substances.has(code));
    const same =
      (item.slug !== undefined && item.slug === drug.slug) ||
      sameCode !== undefined ||
      names.has(normalizedName(item.name));
    if (same) {
      warnings.push({ item, concern, match: 'same', ...(sameCode ? { code: sameCode } : {}) });
      continue;
    }
    const group = [...groupCodes(item.atc ?? [])].find((code) => groups.has(code));
    if (group) warnings.push({ item, concern, match: 'group', code: group });
  }
  return warnings;
}

// --- Ids ----------------------------------------------------------------------------------------

let counter = 0;

/** A new id: time plus a counter, unique on one device. */
export function newPastMedId(now: Date = new Date()): string {
  counter = (counter + 1) % 1296;
  return `${now.getTime().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.floor(
    Math.random() * 1296,
  )
    .toString(36)
    .padStart(2, '0')}`;
}

// --- The editor's draft ------------------------------------------------------------------------

/** What the editor holds: text as typed, choices as picked. */
export interface PastMedDraft {
  readonly id: string;
  readonly name: string;
  readonly slug?: string | undefined;
  readonly atc?: readonly string[] | undefined;
  readonly dose: string;
  /** «2022», «03.2022» or «14.03.2022». */
  readonly fromText: string;
  readonly toText: string;
  readonly approx: boolean;
  readonly duration: string;
  readonly stop?: PastMedStop | undefined;
  readonly stopNote: string;
  readonly reaction: string;
  readonly severity?: PastMedSeverity | undefined;
  readonly allergy?: PastMedAllergy | undefined;
  readonly effect?: PastMedEffect | undefined;
  readonly note: string;
  readonly planItem?: string | undefined;
}

export type PastMedDraftError =
  | { readonly kind: 'no-name' }
  | { readonly kind: 'bad-from' }
  | { readonly kind: 'bad-to' }
  | { readonly kind: 'from-after-to' };

export const PAST_MED_DRAFT_ERRORS: ErrorStates<PastMedDraftError> = {
  'no-name': { title: 'Введите название препарата' },
  'bad-from': { title: 'Начало: год, ММ.ГГГГ или ДД.ММ.ГГГГ, не позже сегодня' },
  'bad-to': { title: 'Конец: год, ММ.ГГГГ или ДД.ММ.ГГГГ, не позже сегодня' },
  'from-after-to': { title: 'Начало позже конца' },
};

const WHEN_INPUT = /^(?:(\d{1,2})\.)?(?:(\d{1,2})\.)?(\d{4})$/u;

/**
 * Typed text to a stored partial date: «2022» → `2022`, «3.2022» → `2022-03`, «14.03.2022» →
 * `2022-03-14`; `''` for empty text and `undefined` for text that is not a past date.
 */
export function parseWhenInput(text: string, today: Date = new Date()): string | undefined {
  const trimmed = text.trim().replaceAll('/', '.').replaceAll('-', '.');
  if (!trimmed) return '';
  const match = WHEN_INPUT.exec(trimmed);
  if (!match) return undefined;
  const [, first, second, year] = match;
  const pad = (part: string): string => part.padStart(2, '0');
  const value =
    first !== undefined && second !== undefined
      ? `${year}-${pad(second)}-${pad(first)}`
      : first !== undefined
        ? `${year}-${pad(first)}`
        : (year as string);
  return isPastMedWhen(value, today) ? value : undefined;
}

/** A stored partial date as the patient types it: `2022-03` → «03.2022». */
export function whenInputText(value: string | undefined): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return [day, month, year].filter(Boolean).join('.');
}

export function emptyPastMedDraft(id: string = newPastMedId()): PastMedDraft {
  return {
    id,
    name: '',
    dose: '',
    fromText: '',
    toText: '',
    approx: false,
    duration: '',
    stopNote: '',
    reaction: '',
    note: '',
  };
}

export function draftOf(item: PastMedication): PastMedDraft {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    atc: item.atc,
    dose: item.dose ?? '',
    fromText: whenInputText(item.from),
    toText: whenInputText(item.to),
    approx: item.approx === true,
    duration: item.duration ?? '',
    stop: item.stop,
    stopNote: item.stopNote ?? '',
    reaction: item.reaction ?? '',
    severity: item.severity,
    allergy: item.allergy,
    effect: item.effect,
    note: item.note ?? '',
    planItem: item.planItem,
  };
}

function clip(text: string, key: keyof typeof LIMITS): string | undefined {
  const trimmed = text.trim().slice(0, LIMITS[key]);
  return trimmed || undefined;
}

/** The draft as a saved medicine, signed by `by` at `now`; or the first thing to fix. */
export function pastMedFromDraft(
  draft: PastMedDraft,
  by: PastMedAuthor,
  now: Date = new Date(),
): TypedResult<PastMedication, PastMedDraftError> {
  const name = clip(draft.name, 'name');
  if (!name) return err({ kind: 'no-name' });
  const from = parseWhenInput(draft.fromText, now);
  if (from === undefined) return err({ kind: 'bad-from' });
  const to = parseWhenInput(draft.toText, now);
  if (to === undefined) return err({ kind: 'bad-to' });
  if (from && to && from.slice(0, Math.min(from.length, to.length)) > to) {
    return err({ kind: 'from-after-to' });
  }
  const dose = clip(draft.dose, 'dose');
  const duration = clip(draft.duration, 'duration');
  const stopNote = draft.stop === 'other' ? clip(draft.stopNote, 'stopNote') : undefined;
  const reaction = clip(draft.reaction, 'reaction');
  const note = clip(draft.note, 'note');
  return ok({
    id: draft.id,
    name,
    ...(draft.slug ? { slug: draft.slug } : {}),
    ...(draft.atc?.length ? { atc: draft.atc } : {}),
    ...(dose ? { dose } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(draft.approx && (from || to) ? { approx: true as const } : {}),
    ...(duration ? { duration } : {}),
    ...(draft.stop ? { stop: draft.stop } : {}),
    ...(stopNote ? { stopNote } : {}),
    ...(reaction ? { reaction } : {}),
    ...(draft.severity ? { severity: draft.severity } : {}),
    ...(draft.allergy ? { allergy: draft.allergy } : {}),
    ...(draft.effect ? { effect: draft.effect } : {}),
    ...(note ? { note } : {}),
    ...(draft.planItem ? { planItem: draft.planItem } : {}),
    by,
    updatedAt: now.toISOString(),
  });
}
