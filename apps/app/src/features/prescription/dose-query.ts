/**
 * Reads a search query that names a drug and a patient («амоксициллин ребёнок 20 кг», «азитромицин
 * ребёнку 5 лет 18 кг 5 дней», «цефтриаксон 70 кг», «метформин пожилой») into the drug name and the
 * patient's facts (RX1). Syntactic and deterministic, like the safety and comparison questions: the
 * facts are what the query says, the rest of the words are the drug's name (the app's own medication
 * search finds the drug), and a query with a drug name and no patient data is not a question.
 */
import { normalizeForLimits } from '@/features/medication-safety/age-limits';
import { ADULT_AGE_DAYS } from './dose-population';

export interface DoseQuery {
  /** The drug name as typed, without the patient words. */
  readonly name: string;
  readonly ageDays: number | null;
  /** The patient is a child or an adult, when the query says so and gives no age. */
  readonly group: 'adult' | 'child' | null;
  readonly weightKg: number | null;
  /** Length of the course in days. */
  readonly days: number | null;
  readonly pregnant: boolean;
  readonly lactating: boolean;
  readonly renal: boolean;
  readonly hepatic: boolean;
  /** A dosage form word: the first word of the registry's form («таблетки», «суспензия»). */
  readonly form: string | null;
  /** The strength the query names, in milligrams per unit. */
  readonly strengthMg: number | null;
  /** The query says «доза», «сколько», «схема» and the like. */
  readonly asksDose: boolean;
}

const MAX_QUERY_LENGTH = 120;
const MAX_NAME_WORDS = 4;
const YEAR_DAYS = 365.25;
const MONTH_DAYS = YEAR_DAYS / 12;
const START = '(?<![\\p{L}\\d])';
const END = '(?![\\p{L}\\d])';
const NUMBER = '(\\d+(?:[.,]\\d+)?)';

const WEIGHT = new RegExp(`${START}${NUMBER}\\s*(?:кг|килограмм\\p{L}*|кило)${END}`, 'gu');
const YEARS = new RegExp(`${START}${NUMBER}\\s*(?:лет|года|год|г\\.)${END}`, 'gu');
const MONTHS = new RegExp(`${START}${NUMBER}\\s*(?:месяц\\p{L}*|мес\\.?)${END}`, 'gu');
const DAYS_AS_COURSE = new RegExp(
  `${START}(?:на|в\\s+течение|курс\\p{L}*)?\\s*${NUMBER}\\s*(?:дней|дня|день|дн\\.?|суток|сут\\.?)${END}`,
  'gu',
);
const WEEKS = new RegExp(
  `${START}(?:(на|в\\s+течение|курс\\p{L}*)\\s*)?${NUMBER}\\s*(?:недел\\p{L}*|нед\\.?)${END}`,
  'gu',
);
const STRENGTH = new RegExp(`${START}${NUMBER}\\s*(мкг|мг|г)(?:\\s*/\\s*\\d*\\s*мл)?${END}`, 'gu');
const NEWBORN = new RegExp(
  `${START}(?:новорожд\\p{L}*|грудничок|грудничк\\p{L}*|младенц\\p{L}*)${END}`,
  'u',
);
const CHILD = new RegExp(
  `${START}(?:ребен\\p{L}*|ребят\\p{L}*|дет(?:ям|ей|и|ский|ская|ское)|малыш\\p{L}*|подрост\\p{L}*)${END}`,
  'u',
);
const ADULT = new RegExp(`${START}взросл\\p{L}*${END}`, 'u');
const ELDERLY = new RegExp(`${START}(?:пожил\\p{L}*|старик\\p{L}*|старческ\\p{L}*)${END}`, 'u');
const PREGNANT = new RegExp(`${START}беремен\\p{L}*${END}`, 'u');
const LACTATING = new RegExp(
  `${START}(?:гв|грудн\\p{L}*\\s+вскармлив\\p{L}*|кормящ\\p{L}*|лактаци\\p{L}*|кормлени\\p{L}*\\s+грудью)${END}`,
  'u',
);
const RENAL = new RegExp(
  `${START}(?:почечн\\p{L}*\\s+недостаточн\\p{L}*|скф|ренальн\\p{L}*|хпн|хбп)${END}`,
  'u',
);
const HEPATIC = new RegExp(`${START}печеночн\\p{L}*\\s+недостаточн\\p{L}*${END}`, 'u');
const DOSE_WORD = new RegExp(
  `${START}(?:доз\\p{L}*|дозировк\\p{L}*|сколько|схем\\p{L}*|режим\\p{L}*|как\\s+принимать|как\\s+давать)${END}`,
  'u',
);
const FORM_WORDS: readonly { readonly pattern: RegExp; readonly form: string }[] = [
  { pattern: new RegExp(`${START}(?:таблетк\\p{L}*|таб\\.?)${END}`, 'u'), form: 'таблетки' },
  { pattern: new RegExp(`${START}капсул\\p{L}*${END}`, 'u'), form: 'капсулы' },
  { pattern: new RegExp(`${START}суспензи\\p{L}*${END}`, 'u'), form: 'суспензия' },
  { pattern: new RegExp(`${START}сироп\\p{L}*${END}`, 'u'), form: 'сироп' },
  { pattern: new RegExp(`${START}капл\\p{L}*${END}`, 'u'), form: 'капли' },
  {
    pattern: new RegExp(`${START}(?:свеч\\p{L}*|суппозитор\\p{L}*)${END}`, 'u'),
    form: 'суппозитории',
  },
  {
    pattern: new RegExp(`${START}(?:укол\\p{L}*|инъекц\\p{L}*|ампул\\p{L}*)${END}`, 'u'),
    form: 'раствор',
  },
];

/** Words of the frame of the question: they are not part of the drug's name. */
const FRAME_WORDS = new Set([
  'для',
  'при',
  'у',
  'ребенку',
  'ребенок',
  'ребенка',
  'детям',
  'дети',
  'взрослому',
  'взрослым',
  'взрослый',
  'пациенту',
  'пациент',
  'пациентке',
  'больному',
  'мне',
  'нужно',
  'нужна',
  'надо',
  'сколько',
  'давать',
  'дать',
  'принимать',
  'доза',
  'дозы',
  'дозу',
  'дозировка',
  'дозировку',
  'дозировки',
  'схема',
  'схему',
  'режим',
  'как',
  'на',
  'в',
  'по',
  'с',
  'со',
  'и',
  'или',
  'мг',
  'кг',
  'лет',
  'года',
  'год',
  'мес',
  'дней',
  'дня',
  'день',
  'женщине',
  'женщинам',
  'беременной',
  'пожилому',
  'пожилым',
  'пожилой',
  'старику',
  'курс',
  'курсом',
]);

function normalizeText(text: string): string {
  return normalizeForLimits(text).replace(/\s+/gu, ' ').trim();
}

function numberOf(source: string | undefined): number {
  return Number((source ?? '').replace(',', '.'));
}

interface Taken {
  readonly start: number;
  readonly end: number;
}

function overlaps(taken: readonly Taken[], start: number, end: number): boolean {
  return taken.some((item) => start < item.end && end > item.start);
}

/** The question in the query, or null when it names no drug or no patient data. */
export function parseDoseQuery(raw: string): DoseQuery | null {
  const text = normalizeText(raw);
  if (text.length < 5 || text.length > MAX_QUERY_LENGTH) return null;
  const taken: Taken[] = [];
  const take = (match: RegExpMatchArray): void => {
    taken.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  };

  let weightKg: number | null = null;
  for (const match of text.matchAll(WEIGHT)) {
    const value = numberOf(match[1]);
    if (value >= 0.4 && value <= 400 && weightKg === null) {
      weightKg = value;
      take(match);
    }
  }
  let days: number | null = null;
  for (const match of text.matchAll(DAYS_AS_COURSE)) {
    const value = numberOf(match[1]);
    if (
      value >= 1 &&
      value <= 365 &&
      days === null &&
      !overlaps(taken, match.index ?? 0, (match.index ?? 0) + match[0].length)
    ) {
      days = value;
      take(match);
    }
  }
  const child = CHILD.test(text) || NEWBORN.test(text);
  for (const match of text.matchAll(WEEKS)) {
    const value = numberOf(match[2]);
    if (!(value >= 1 && value <= 52)) continue;
    if (overlaps(taken, match.index ?? 0, (match.index ?? 0) + match[0].length)) continue;
    if (match[1] === undefined && child) continue;
    if (days === null) days = value * 7;
    take(match);
  }
  let ageDays: number | null = null;
  for (const match of text.matchAll(YEARS)) {
    const value = numberOf(match[1]);
    if (
      value > 0 &&
      value <= 120 &&
      ageDays === null &&
      !overlaps(taken, match.index ?? 0, (match.index ?? 0) + match[0].length)
    ) {
      ageDays = Math.round(value * YEAR_DAYS);
      take(match);
    }
  }
  for (const match of text.matchAll(MONTHS)) {
    const value = numberOf(match[1]);
    if (
      value > 0 &&
      value <= 36 &&
      ageDays === null &&
      !overlaps(taken, match.index ?? 0, (match.index ?? 0) + match[0].length)
    ) {
      ageDays = Math.round(value * MONTH_DAYS);
      take(match);
    }
  }
  let strengthMg: number | null = null;
  for (const match of text.matchAll(STRENGTH)) {
    if (overlaps(taken, match.index ?? 0, (match.index ?? 0) + match[0].length)) continue;
    const value = numberOf(match[1]);
    if (!(value > 0)) continue;
    strengthMg = match[2] === 'г' ? value * 1000 : match[2] === 'мкг' ? value / 1000 : value;
    take(match);
    break;
  }

  const newborn = NEWBORN.test(text);
  const elderly = ELDERLY.test(text);
  if (ageDays === null && elderly) ageDays = Math.round(65 * YEAR_DAYS);
  let group: DoseQuery['group'] = null;
  if (ageDays === null) {
    if (child || newborn) group = 'child';
    else if (ADULT.test(text)) group = 'adult';
  }
  const pregnant = PREGNANT.test(text);
  const lactating = LACTATING.test(text);
  const renal = RENAL.test(text);
  const hepatic = HEPATIC.test(text);
  const asksDose = DOSE_WORD.test(text);
  const form = FORM_WORDS.find((spec) => spec.pattern.test(text))?.form ?? null;

  // The state phrases are not part of the name.
  for (const pattern of [RENAL, HEPATIC, LACTATING, PREGNANT]) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'gu'))) {
      if (!overlaps(taken, match.index ?? 0, (match.index ?? 0) + match[0].length)) take(match);
    }
  }
  const hasPatientData =
    ageDays !== null ||
    weightKg !== null ||
    days !== null ||
    group !== null ||
    pregnant ||
    lactating ||
    renal ||
    hepatic ||
    asksDose;
  if (!hasPatientData) return null;

  // The name: what remains once the patient words and the frame words are taken out.
  let rest = text;
  [...taken]
    .toSorted((a, b) => b.start - a.start)
    .forEach(({ start, end }) => {
      rest = `${rest.slice(0, start)} ${rest.slice(end)}`;
    });
  const words = (rest.match(/[\p{L}][\p{L}\d-]*/gu) ?? []).filter((word) => !FRAME_WORDS.has(word));
  const patientWordFilter = [
    PREGNANT,
    LACTATING,
    RENAL,
    HEPATIC,
    NEWBORN,
    ELDERLY,
    ADULT,
    CHILD,
    DOSE_WORD,
  ];
  const nameWords = words.filter(
    (word) =>
      !patientWordFilter.some((pattern) => pattern.test(word)) &&
      !FORM_WORDS.some((spec) => spec.pattern.test(word)) &&
      !/^(?:гв|скф|кк|тип|типа)$/u.test(word),
  );
  if (nameWords.length === 0 || nameWords.length > MAX_NAME_WORDS) return null;
  if (ageDays !== null && ageDays >= ADULT_AGE_DAYS && group === 'child') group = null;
  return {
    name: nameWords.join(' '),
    ageDays,
    group,
    weightKg,
    days,
    pregnant,
    lactating,
    renal,
    hepatic,
    form,
    strengthMg,
    asksDose,
  };
}
