/**
 * Reads dose statements from the «Способ применения и дозы» sections of an official instruction
 * (RX1). Pure and deterministic: the build script feeds it the released modules, the app feeds it
 * the instruction that is open, the unit tests feed it real sentences.
 *
 * A statement becomes a rule only when its numbers were read with confidence: an amount with a
 * unit, and either a frequency, a daily basis, a single-dose word or a word that names the amount
 * a dose («по», «в дозе», «назначают»). Everything else stays text, and the screen shows the
 * quoted section instead. Nothing here summarises, converts between patients or fills a gap: a
 * rule holds the numbers as printed (in mg, ml and days) and the offsets of the sentence.
 */
import {
  COND_DIALYSIS,
  COND_HEPATIC,
  COND_RENAL,
  type DoseRule,
  GROUP_ADOLESCENT,
  GROUP_ADULT,
  GROUP_CHILD,
  GROUP_ELDERLY,
  GROUP_INFANT,
  GROUP_NEWBORN,
  ROLE_INITIAL,
  ROLE_LOADING,
  ROLE_MAINTENANCE,
  ROLE_SINGLE,
  ROUTE_EYE_EAR_NOSE,
  ROUTE_IM,
  ROUTE_INHALED,
  ROUTE_IV,
  ROUTE_ORAL,
  ROUTE_RECTAL,
  ROUTE_SC,
  ROUTE_SUBLINGUAL,
  ROUTE_TOPICAL,
  ROUTE_VAGINAL,
  RULE_CAP,
  RULE_DOSE,
  RULE_DURATION,
} from '@localmed/contracts';

import {
  canonicalSectionText,
  sectionChecksum,
  splitSentenceSpans,
  type TextSpan,
} from '@/features/drug-interactions/interaction-text';
import { extractAmountLimits, normalizeForLimits } from '@/features/medication-safety/age-limits';
import { detectDosageForms } from '@/features/medication-safety/dosage-forms';
import { classifyRule, type PopulationSource, shapeIndex } from './dose-gate';
import {
  type AmountMatch,
  findAmounts,
  findDurations,
  findFrequencies,
  numberValue,
  pieceKindIndex,
  unitIndex,
} from './dose-numbers';

export interface DoseSectionInput {
  readonly id: string;
  readonly type: string | null;
  readonly title: string;
  /** The section's chunks in reading order (`original_text`). */
  readonly chunks: readonly string[];
}

export interface ExtractedDoseRules {
  /** The dosage sections read: id and checksum of the canonical text. */
  readonly sections: readonly { readonly id: string; readonly checksum: string }[];
  /** Rules, `s` indexing `sections`. */
  readonly rules: readonly DoseRule[];
  /** The instruction says a tablet may be divided. */
  readonly divisible: boolean;
  /** Counters for the build report. */
  readonly stats: DoseParseStats;
}

export interface DoseParseStats {
  readonly clauses: number;
  readonly doseRules: number;
  readonly capRules: number;
  readonly durationRules: number;
  /** Clauses with an amount and a unit that were not turned into a rule. */
  readonly skippedAmounts: number;
}

const DAYS_PER_YEAR = 365.25;
const ADULT_AGE_DAYS = Math.round(18 * DAYS_PER_YEAR);
const ELDERLY_AGE_DAYS = Math.round(65 * DAYS_PER_YEAR);
const NEWBORN_AGE_DAYS = 28;
const INFANT_AGE_DAYS = Math.round(DAYS_PER_YEAR);
const MAX_RULES_PER_DOCUMENT = 80;
const MAX_CLAUSE_LENGTH = 700;

const AMOUNT_ANYWHERE = /\d|[½¼¾]|(?<![\p{L}])(?:одн|дву|двух|трех|пол(?:ов|тор))/u;
const GROUP_WORD = `(?:взросл\\p{L}*|дет(?:ям|ей|ьми|ях|и)(?![\\p{L}])|детск\\p{L}*|ребен\\p{L}*|пожил\\p{L}*|старческ\\p{L}*|подрост\\p{L}*|новорожд\\p{L}*|недоношен\\p{L}*|грудн\\p{L}*\\s+(?:возраст|дет)\\p{L}*|младенц\\p{L}*)`;
const POPULATION_SPLIT = new RegExp(
  `(?:[,;:.]\\s+|\\s+[-–—]\\s+|\\s+и\\s+|^)(?=(?:а\\s+|для\\s+|у\\s+)?(?:истощенн\\p{L}*\\s+|ослабленн\\p{L}*\\s+)?${GROUP_WORD})`,
  'gu',
);
const SEQUENCE_SPLIT =
  /(?:^|[,;.]\s+)(?=(?:затем|далее|после\s+этого|в\s+дальнейшем|в\s+последующие\s+дни|со\s+второго\s+дня|начиная\s+со)(?![\p{L}]))/gu;

const NEGATIVE =
  /противопоказ|не\s+применя|не\s+рекомендуется\s+(?:применять|назначать|принимать)|не\s+назнача|не\s+следует\s+(?:применять|назначать|принимать|использовать)|содержит|содержани|состав\s|передозиров|запива\p{L}*|(?:увеличивае?т|уменьшае?т|повышае?т|снижае?т)(?![\p{L}])|превышал\p{L}*|превышающ\p{L}*|превышен\p{L}*\s+доз|случайн\p{L}*\s+(?:введен|прием)|другие\s+лекарственные\s+формы|другой\s+лекарственной\s+форме|други[хе]\s+производител|разделительной\s+риск|разделив\s+таблетку|для\s+обеспечени\p{L}*|эффективност\p{L}*|безопасност\p{L}*|сопоставим|не\s+изучал\p{L}*|не\s+проводил\p{L}*|исследован\p{L}*|наблюдал\p{L}*|отмечал\p{L}*/u;
/** A sentence that restricts or warns names a population without setting the dose's population. */
const RESTRICTION =
  /противопоказ|не\s+применя|не\s+рекоменд|не\s+назнач|не\s+установлен|не\s+изуч|не\s+проводил|отсутству|нельзя|запрещ|не\s+показан|нет\s+(?:данных|опыта)|безопасност|с\s+осторожностью/u;
/** Words of how to take a dose, not who takes it: a group named there is not a heading for the next sentence. */
const ADMINISTRATION =
  /после\s+приема|следует\s+(?:дать|выпить|запить)|выпить|проглотить|смыть|запить|взбалтыв|встряхн/u;
/** Words of preparing a solution: an amount in such a sentence is the volume or the strength of the mix. */
const PREPARATION =
  /растворител|разведен|разводят|разводить|добавля|приготовлен\p{L}*\s+раствор|объем\p{L}*\s+(?:раствор|жидкост)/u;
/** Endings of the names of other drugs a dose sentence may be about («дарунавира», «бевацизумаб»). */
const DRUG_NAME_ENDINGS =
  /(?<![\p{L}])[\p{L}]{3,}(?:мицин|циллин|азол|прил|сартан|статин|олол|флоксацин|коксиб|навир|тиниб|умаб|парин|пенем|бактам|зепам|перидон|оксетин|триптилин|зидин|глинид|глитазон|глиптин|флозин|платин|рубицин|таксел|метотрексат|цефалекс|цефазолин|цефтриаксон|цефепим|цефотаксим|фунгин|вудин|фосфамид|ксифен|мустин|цитабин|абин|тецан|ксат|винбластин|винкристин|винорелбин|этопозид|тоцин|тоин)[\p{L}]{0,3}(?![\p{L}])/gu;

/** The stems (first five letters) of the words that name the document's own drug. */
export function subjectStems(names: readonly (string | null | undefined)[]): readonly string[] {
  const stems = new Set<string>();
  for (const name of names) {
    for (const word of normalizeForLimits(name ?? '').match(/[\p{L}]{4,}/gu) ?? []) {
      stems.add(word.slice(0, 5));
    }
  }
  return [...stems];
}

/** True when a word that looks like the name of another drug stands before the amount. */
function namesOtherDrugBefore(
  text: string,
  amountStart: number,
  stems: readonly string[],
): boolean {
  if (stems.length === 0) return false;
  const before = text.slice(Math.max(0, amountStart - 70), amountStart);
  for (const match of before.matchAll(DRUG_NAME_ENDINGS)) {
    if (!stems.includes(match[0].slice(0, 5))) return true;
  }
  return false;
}

const MODIFIER = /(?:снижа|снизи|уменьш|увеличи|повыш|корректир|титр|пропущен)/u;
const DOSE_CUE =
  /(?:^|[^\p{L}])(?:по|в\s+дозе|(?:разов|рекомендуем|обычн|начальн|поддерживающ|суточн)\p{L}*\s+доз\p{L}*|доз[аыуе]\s+(?:препарата\s+)?(?:[-–—:]|составляет)|назнача\p{L}*|принима\p{L}*|применя\p{L}*|вводя?т\p{L}*|вводить|начина\p{L}*|рекомендуем\p{L}*|рекомендуется|составляет|составляют)(?![\p{L}])/u;
const DILUENT = /(?:^|[^\p{L}])(?:в|на)\s+$/u;
const DILUENT_AFTER =
  /^\s*(?:\d[\d,.]*\s*%\s*)?(?:воды|раствор|изотонич|физиолог|натрия|декстроз|глюкоз|жидкост|стакан|кипяч)/u;

const CAP_PHRASE =
  /(?<![\p{L}\d])(?:(?:максимальн\p{L}*|предельн\p{L}*|высш\p{L}*)\s+(?:(?<scope>разов\p{L}*|суточн\p{L}*|дневн\p{L}*|курсов\p{L}*|однократн\p{L}*)\s+)?(?:доз\p{L}*|количеств\p{L}*)?|не\s+(?:более|боле|превышать|превышает|превышающ\p{L}*)|не\s+(?:должн\p{L}*|следует)\s+превышать|не\s+больше|не\s+выше|превышать)/gu;
const DAILY_AFTER =
  /^\s*(?:\(?\s*)?(?:однократно\s+)?(?:в\s+сутки|в\s+день|за\s+сутки|за\s+день|\/\s*сут)/u;
const SINGLE_AFTER =
  /^\s*(?:за\s+(?:один\s+)?(?:прием|раз)|на\s+(?:один\s+)?прием|однократно(?!\s+(?:в|за)\s+(?:сутки|день))|за\s+одно)/u;

const RENAL =
  /(?:(?<![\p{L}])почечн\p{L}*|функци\p{L}*\s+почек|клиренс\p{L}*\s+креатинин|скф|(?<![\p{L}])кк(?![\p{L}])|креатинин\p{L}*)/u;
const HEPATIC =
  /(?:печеночн\p{L}*|функци\p{L}*\s+печени|нарушени\p{L}*\s+печени|цирроз|child-?pugh|чайлд)/u;
const DIALYSIS = /гемодиализ|диализ|гемофильтрац/u;

const ROUTES: readonly { readonly bit: number; readonly pattern: RegExp }[] = [
  { bit: ROUTE_ORAL, pattern: /(?<![\p{L}])(?:внутрь|перорально|приема?\s+внутрь|per\s+os)/u },
  { bit: ROUTE_IV, pattern: /внутривенн|(?<![\p{L}])в\s*\/\s*в(?![\p{L}])|в\s+вену/u },
  { bit: ROUTE_IM, pattern: /внутримышечн|(?<![\p{L}])в\s*\/\s*м(?![\p{L}])/u },
  { bit: ROUTE_SC, pattern: /подкожн|(?<![\p{L}])п\s*\/\s*к(?![\p{L}])/u },
  { bit: ROUTE_INHALED, pattern: /ингаляц|вдыхани|небулайзер/u },
  {
    bit: ROUTE_TOPICAL,
    pattern:
      /наружн|(?<![\p{L}])местно(?![\p{L}])|местного\s+применения|накожн|наносят|наносить|втира/u,
  },
  { bit: ROUTE_RECTAL, pattern: /ректальн|в\s+прямую\s+кишку/u },
  { bit: ROUTE_SUBLINGUAL, pattern: /сублингвальн|под\s+язык/u },
  {
    bit: ROUTE_EYE_EAR_NOSE,
    pattern:
      /закапыва|закапать|конъюнктивальн\p{L}*\s+мешок|в\s+нос|интраназальн|в\s+ухо|в\s+носов/u,
  },
  { bit: ROUTE_VAGINAL, pattern: /вагинальн|интравагинальн/u },
];

const ROLE_PATTERNS: readonly { readonly role: number; readonly pattern: RegExp }[] = [
  { role: ROLE_LOADING, pattern: /нагрузочн|ударн/u },
  {
    role: ROLE_INITIAL,
    pattern:
      /начальн|первоначальн|стартов|начина(?:ют|ть|йте|ется|ют)(?![\p{L}])|в\s+первый\s+день|первые\s+\d+\s+дн|перв(?:ая|ую|ой)\s+доз/u,
  },
  { role: ROLE_MAINTENANCE, pattern: /поддерживающ|поддержани/u },
  {
    role: ROLE_SINGLE,
    pattern:
      /однократн(?:ая|ой|ую|ое)\s+(?:доз|инъекци|введени|прием|приём)|в\s+виде\s+однократн|однократно\s+(?:вводят|вводится|вводить|ввести|введение|принять|принимают)|разовая\s+доза\s+составляет\s+\d+\s+(?:мг|г)\s*$/u,
  },
];

const DIVISIBLE =
  /(?:можно|допускается|разрешается|следует)\s+(?:делить|разделить|разделять|разламывать|разломить|ломать)|разделить\s+(?:таблетку\s+)?(?:пополам|на\s+(?:\d|две|четыре|равн)\p{L}*)|делится\s+(?:пополам|на)|делят\s+(?:пополам|на)|(?:таблетк\p{L}*|табл\.)\s+с\s+риск\p{L}*|(?:с|по)\s+риск\p{L}+\s+(?:для|можно)|разломить|разламыва/u;

function bitsOf(
  specs: readonly { readonly bit: number; readonly pattern: RegExp }[],
  text: string,
): number {
  let bits = 0;
  for (const spec of specs) if (spec.pattern.test(text)) bits |= spec.bit;
  return bits;
}

/** Population words and limits of a clause, in the form the rule stores. */
interface Population {
  readonly or?: 1;
  readonly p0?: number;
  readonly p1?: number;
  readonly w0?: number;
  readonly w1?: number;
  readonly g: number;
}

const GROUP_PATTERNS: readonly { readonly bit: number; readonly pattern: RegExp }[] = [
  { bit: GROUP_ADULT, pattern: /(?<![\p{L}])взросл\p{L}*/u },
  {
    bit: GROUP_CHILD,
    pattern:
      /(?<![\p{L}])(?:дет(?:ям|ей|ьми|ях|и)|детск\p{L}*|ребен\p{L}*|ребят\p{L}*)(?![\p{L}])/u,
  },
  { bit: GROUP_ELDERLY, pattern: /пожил\p{L}*|старческ\p{L}*/u },
  { bit: GROUP_NEWBORN, pattern: /новорожд\p{L}*|недоношен\p{L}*/u },
  {
    bit: GROUP_INFANT,
    pattern: /грудн\p{L}*\s+(?:возраст|дет)\p{L}*|младенц\p{L}*|грудничк\p{L}*/u,
  },
  { bit: GROUP_ADOLESCENT, pattern: /подрост\p{L}*/u },
];

/** True when the heading pattern's sentence is about children only («детям до 12 лет»). */
/** «масса тела 50 кг или более», «20 кг и менее»: the weight limits `extractAmountLimits` does not read. */
function weightOrMoreLimits(text: string): ReturnType<typeof extractAmountLimits> {
  const found: ReturnType<typeof extractAmountLimits>[number][] = [];
  // «10–14 кг»: a band of body mass in a row of a table, with no word of mass before it.
  for (const match of text.matchAll(
    /(?<![\p{L}\d/.,-])(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*кг(?![\p{L}\d/])/gu,
  )) {
    const low = Number((match[1] ?? '').replace(',', '.'));
    const high = Number((match[2] ?? '').replace(',', '.'));
    const before = text.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    if (!(low < high) || high > 200 || /мг\s*$|мкг\s*$|г\s*$/u.test(before)) continue;
    found.push({
      dimension: 'weight',
      operator: 'range',
      lower: Math.round(low * 10),
      upper: Math.round(high * 10),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  for (const match of text.matchAll(
    /(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s*кг\s+(?:или|и)\s+(более|больше|выше|менее|меньше|ниже)(?![\p{L}])/gu,
  )) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    if (!/масс|вес/u.test(before)) continue;
    const tenths = Math.round(Number((match[1] ?? '').replace(',', '.')) * 10);
    const below = /^(?:менее|меньше|ниже)$/u.test(match[2] ?? '');
    found.push({
      dimension: 'weight',
      operator: below ? 'below' : 'from',
      lower: below ? null : tenths,
      upper: below ? tenths : null,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return found;
}

/** Age limits of adults («старше 75 лет», «18–65 лет»), which `extractAmountLimits` leaves out. */
function adultAgeLimits(text: string): readonly { lower: number | null; upper: number | null }[] {
  const found: { lower: number | null; upper: number | null }[] = [];
  const years = (value: string): number => Math.round(Number(value) * DAYS_PER_YEAR);
  const adult = (value: string): boolean => Number(value) >= 18 && Number(value) <= 110;
  for (const match of text.matchAll(
    /(?<![\p{L}\d])(\d{2,3})\s*-\s*(\d{2,3})\s*(?:лет|года)(?![\p{L}])/gu,
  )) {
    if (adult(match[1] ?? '') && adult(match[2] ?? '') && Number(match[1]) < Number(match[2])) {
      found.push({ lower: years(match[1] ?? ''), upper: years(match[2] ?? '') });
    }
  }
  for (const match of text.matchAll(
    /(?<![\p{L}\d])(старше|от|свыше|более|не\s+менее|с|до|младше|моложе|менее)\s+(\d{2,3})\s*(?:лет|года)(?![\p{L}])/gu,
  )) {
    const value = match[2] ?? '';
    if (!adult(value)) continue;
    const below = /^(?:до|младше|моложе|менее)$/u.test(match[1] ?? '');
    found.push(below ? { lower: null, upper: years(value) } : { lower: years(value), upper: null });
  }
  for (const match of text.matchAll(
    /(?<![\p{L}\d])(\d{2,3})\s*(?:лет|года)\s+и\s+(?:старше|более)(?![\p{L}])/gu,
  )) {
    if (adult(match[1] ?? '')) found.push({ lower: years(match[1] ?? ''), upper: null });
  }
  return found;
}

const BOTH_GROUPS =
  /(?:взросл\p{L}*|дет(?:ям|ей|и|ьми|ях)(?![\p{L}])|подрост\p{L}*)(?:\s*\([^)]{0,60}\))?\s*(?:и|,|\/)\s*(?:взросл\p{L}*|дет(?:ям|ей|и|ьми|ях)(?![\p{L}])|подрост\p{L}*)/u;

/**
 * The group bits of a clause. «Взрослым и детям» names both; a sentence that names children and later
 * mentions adults («у детей … как у взрослых») is about the group it names first.
 */
function groupBitsOf(text: string): number {
  const groups = bitsOf(GROUP_PATTERNS, text);
  const child = (groups & (GROUP_CHILD | GROUP_NEWBORN | GROUP_INFANT | GROUP_ADOLESCENT)) !== 0;
  if ((groups & GROUP_ADULT) === 0 || !child || BOTH_GROUPS.test(text)) return groups;
  const adultAt = /взросл\p{L}*/u.exec(text)?.index ?? Infinity;
  const childAt = Math.min(
    ...GROUP_PATTERNS.filter((spec) => spec.bit !== GROUP_ADULT && spec.bit !== GROUP_ELDERLY).map(
      (spec) => spec.pattern.exec(text)?.index ?? Infinity,
    ),
  );
  return adultAt < childAt
    ? groups & ~(GROUP_CHILD | GROUP_NEWBORN | GROUP_INFANT | GROUP_ADOLESCENT)
    : groups & ~GROUP_ADULT;
}

/**
 * «(соответствует дозе для взрослых пациентов)» is a remark on what an amount equals, often a table
 * cell that ended up in the sentence next to it: its population words say nothing about the dose of
 * the sentence. Same length, so offsets stay valid.
 */
export function maskEquivalenceRemarks(text: string): string {
  return text.replace(/\(\s*соответствует[^)]*\)/gu, (match) => ' '.repeat(match.length));
}

function populationOf(textWithRemarks: string, rawWithRemarks: string): Population | null {
  const text = maskEquivalenceRemarks(textWithRemarks);
  const raw = maskEquivalenceRemarks(rawWithRemarks);
  const groups = groupBitsOf(text);
  if (groups === 0 && !/\d/u.test(text)) return null;
  const limits = [...extractAmountLimits(raw), ...weightOrMoreLimits(text)];
  const adults = adultAgeLimits(text);
  if (groups === 0 && limits.length === 0 && adults.length === 0) return null;
  let p0: number | undefined;
  let p1: number | undefined;
  let w0: number | undefined;
  let w1: number | undefined;
  for (const limit of adults) {
    if (limit.lower !== null) p0 = p0 === undefined ? limit.lower : Math.max(p0, limit.lower);
    if (limit.upper !== null) p1 = p1 === undefined ? limit.upper : Math.min(p1, limit.upper);
  }
  for (const limit of limits) {
    if (limit.dimension === 'age') {
      if (limit.lower !== null) p0 = p0 === undefined ? limit.lower : Math.max(p0, limit.lower);
      if (limit.upper !== null) p1 = p1 === undefined ? limit.upper : Math.min(p1, limit.upper);
    } else {
      if (limit.lower !== null) w0 = w0 === undefined ? limit.lower : Math.max(w0, limit.lower);
      if (limit.upper !== null) w1 = w1 === undefined ? limit.upper : Math.min(w1, limit.upper);
    }
  }
  const adult = (groups & GROUP_ADULT) !== 0;
  const child = (groups & (GROUP_CHILD | GROUP_NEWBORN | GROUP_INFANT | GROUP_ADOLESCENT)) !== 0;
  if (p0 === undefined && adult && !child) p0 = ADULT_AGE_DAYS;
  if (p1 === undefined && child && !adult) {
    p1 =
      (groups & GROUP_NEWBORN) !== 0
        ? NEWBORN_AGE_DAYS
        : (groups & GROUP_INFANT) !== 0
          ? INFANT_AGE_DAYS
          : ADULT_AGE_DAYS - 1;
  }
  if (p0 === undefined && p1 === undefined && (groups & GROUP_ELDERLY) !== 0 && !adult && !child) {
    p0 = ELDERLY_AGE_DAYS;
  }
  const hasAge = p0 !== undefined || p1 !== undefined;
  const hasWeight = w0 !== undefined || w1 !== undefined;
  const alternative = hasAge && hasWeight && /и\/или|или\s+(?:с\s+)?(?:масс|вес)/u.test(text);
  return {
    ...(alternative ? { or: 1 as const } : {}),
    ...(p0 === undefined ? {} : { p0 }),
    ...(p1 === undefined ? {} : { p1 }),
    ...(w0 === undefined ? {} : { w0 }),
    ...(w1 === undefined ? {} : { w1 }),
    g: groups,
  };
}

function conditionBits(text: string): number {
  let bits = 0;
  if (RENAL.test(text)) bits |= COND_RENAL;
  if (HEPATIC.test(text)) bits |= COND_HEPATIC;
  if (DIALYSIS.test(text)) bits |= COND_DIALYSIS;
  return bits;
}

interface Heading {
  readonly start: number;
  readonly end: number;
  readonly population: Population | null;
  readonly cond: number;
  /** A heading of the whole section («Особые группы»): clears the population. */
  readonly reset: boolean;
}

const HEADING_START = new RegExp(
  `^(?:для\\s+|у\\s+)?(?:${GROUP_WORD}|пациент\\p{L}*|больн\\p{L}*|лиц\\p{L}*)`,
  'u',
);
const CONDITION_HEADING =
  /^(?:нарушени\p{L}*\s+функци\p{L}*|почечн\p{L}*\s+недостаточност|печеночн\p{L}*\s+недостаточност|пациент\p{L}*\s+с\s+нарушени|при\s+(?:почечн|печеночн|нарушени))/u;
const RESET_HEADING =
  /^(?:особые|специальные|отдельные)\s+(?:группы|категории)|^режим\s+дозирования$/u;

/** Lines of the canonical text with their offsets; a line that continues on the next is joined. */
function lineSpans(canonical: string): readonly TextSpan[] {
  const spans: TextSpan[] = [];
  let offset = 0;
  for (const line of canonical.split('\n')) {
    spans.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  }
  return spans;
}

function headingsOf(
  lineList: readonly TextSpan[],
  norm: string,
  cased: string,
): readonly Heading[] {
  const lines = lineList.filter((span) => span.end > span.start);
  const headings: Heading[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index] as TextSpan;
    let end = first.end;
    let last = index;
    let text = norm.slice(first.start, end).trim();
    if (text.length < 3) continue;
    const startsLikeHeading = HEADING_START.test(text);
    const conditionHeading = CONDITION_HEADING.test(text);
    const resetHeading = RESET_HEADING.test(text);
    if (!startsLikeHeading && !conditionHeading && !resetHeading) continue;
    // A heading broken over lines: «Взрослые (…) и дети старше 12 лет с массой / тела свыше 45 кг».
    while (last + 1 < lines.length && last - index < 2) {
      const next = lines[last + 1] as TextSpan;
      const nextText = norm.slice(next.start, next.end).trim();
      const nextCased = cased.slice(next.start, next.end).trim();
      if (!/^[\p{Ll}\d(,]/u.test(nextCased) || /[.!?]$/u.test(text)) break;
      if (text.length + nextText.length > 160) break;
      end = next.end;
      text = `${text} ${nextText}`;
      last += 1;
    }
    const following = lines[last + 1];
    const followingText = following ? cased.slice(following.start, following.end).trim() : '';
    const endsSentence = /[.!?]$/u.test(text);
    const words = text.split(/\s+/u).length;
    if (text.length > 150) continue;
    if (endsSentence && words > 3) continue;
    if (/(?:ают|яют|ует|уют|ется|ются|ает|яет|ишь|ите)(?![\p{L}])/u.test(text)) continue;
    if (findAmounts(text).length > 0) continue;
    if (
      /(?:^|[^\p{L}])(?:следует|назнач\p{L}*|принима\p{L}*|рекомендует\p{L}*|применя\p{L}*|вводят|составляет|необходим\p{L}*|должн\p{L}*|могут|может)(?![\p{L}])/u.test(
        text,
      )
    ) {
      continue;
    }
    // A heading is followed by a sentence that starts a new thought, not by its own continuation.
    if (following && /^[\p{Ll}]/u.test(followingText) && !endsSentence) continue;
    const raw = norm.slice(first.start, end);
    const cond = conditionBits(text);
    const population = populationOf(text, raw);
    if (!population && cond === 0 && !resetHeading) continue;
    headings.push({
      start: first.start,
      end,
      population: conditionHeading && cond !== 0 && population === null ? null : population,
      cond,
      reset: resetHeading,
    });
    index = last;
  }
  return headings;
}

/** Splits a sentence into clauses: at «;», at a new population with its own amount, at «затем». */
function clausesOf(norm: string, sentence: TextSpan): readonly TextSpan[] {
  const text = norm.slice(sentence.start, sentence.end);
  const cuts = new Set<number>([0]);
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ';' && depth === 0) cuts.add(index + 1);
  }
  for (const bullet of text.matchAll(/(?<=[.;:!?)])\s+(?:[-•●▪►]\s+)(?=\S)/gu)) {
    cuts.add((bullet.index ?? 0) + bullet[0].length);
  }
  for (const bullet of text.matchAll(/\s•\s+/gu)) cuts.add((bullet.index ?? 0) + bullet[0].length);
  for (const pattern of [POPULATION_SPLIT, SEQUENCE_SPLIT]) {
    for (const match of text.matchAll(pattern)) {
      const at =
        match.index + (match[0].length - (match[0].trimStart().length === match[0].length ? 0 : 0));
      let cut = at;
      // Keep the separator with the clause it ends.
      while (
        cut < text.length &&
        /[\s,;:.\-–—]/u.test(text.charAt(cut)) &&
        cut < at + match[0].length
      ) {
        cut += 1;
      }
      if (cut > 0 && cut < text.length) cuts.add(cut);
    }
  }
  const ordered = [...cuts].toSorted((left, right) => left - right);
  const pieces: { start: number; end: number }[] = [];
  ordered.forEach((cut, index) => {
    pieces.push({ start: cut, end: ordered[index + 1] ?? text.length });
  });
  // A piece without an amount belongs to the next piece (its population words), or to the previous.
  const hasAmount = (piece: { start: number; end: number }): boolean =>
    findAmounts(text.slice(piece.start, piece.end)).length > 0;
  const merged: { start: number; end: number }[] = [];
  let carry: { start: number; end: number } | null = null;
  for (const piece of pieces) {
    const joined: { start: number; end: number } = carry
      ? { start: carry.start, end: piece.end }
      : piece;
    if (hasAmount(joined)) {
      merged.push(joined);
      carry = null;
    } else {
      carry = joined;
    }
  }
  if (carry) {
    const rest = text.slice(carry.start, carry.end);
    // A trailing sentence about another population that states no dose is not part of the dose before it.
    const ownGroup = GROUP_PATTERNS.some((spec) => (spec.pattern.exec(rest)?.index ?? 99) < 30);
    // After a colon the words qualify the dose before them («… в следующих случаях: у взрослых с весом менее 50 кг»).
    if (!ownGroup || text.slice(0, carry.start).trimEnd().endsWith(':')) {
      const previous = merged.pop();
      merged.push(previous ? { start: previous.start, end: carry.end } : carry);
    }
  }
  return merged
    .map((piece) => trimSpan(norm, sentence.start + piece.start, sentence.start + piece.end))
    .filter((span): span is TextSpan => span !== null);
}

function trimSpan(text: string, start: number, end: number): TextSpan | null {
  let from = start;
  let to = end;
  while (from < to && /[\s,;:.\-–—]/u.test(text.charAt(from))) from += 1;
  while (to > from && /[\s,;:]/u.test(text.charAt(to - 1))) to -= 1;
  return to - from >= 8 ? { start: from, end: to } : null;
}

interface CapRead {
  readonly rule: Omit<DoseRule, 's' | 'a' | 'b'>;
  readonly amountIndex: number;
  /** Where the cap phrase begins in the clause. */
  readonly phraseStart: number;
}

function capsOf(text: string, amounts: readonly AmountMatch[]): readonly CapRead[] {
  const caps: CapRead[] = [];
  const used = new Set<number>();
  for (const phrase of text.matchAll(CAP_PHRASE)) {
    const phraseEnd = phrase.index + phrase[0].length;
    // The nearest amount after the phrase; one a previous phrase already took is not taken twice.
    const amountIndex = amounts.findIndex(
      (amount) => !amount.rate && amount.start >= phraseEnd - 1 && amount.start - phraseEnd <= 60,
    );
    if (amountIndex < 0 || used.has(amountIndex)) continue;
    const amount = amounts[amountIndex] as AmountMatch;
    const between = text.slice(phraseEnd, amount.start);
    if (/[.;]/u.test(between)) continue;
    used.add(amountIndex);
    const scopeWord = phrase.groups?.['scope'] ?? '';
    const after = text.slice(amount.end, amount.end + 40);
    let scope: 0 | 1 | 2 | null = null;
    if (/^(?:разов|однократн)/u.test(scopeWord)) scope = 0;
    else if (/^(?:суточн|дневн)/u.test(scopeWord)) scope = 1;
    else if (/^курсов/u.test(scopeWord)) scope = 2;
    else {
      const before = text.slice(Math.max(0, phrase.index - 40), phrase.index);
      if (
        amount.daily ||
        DAILY_AFTER.test(after) ||
        /сут|в\s+день|дневн/u.test(between) ||
        /суточн\p{L}*\s+доз\p{L}*[^.;]*$/u.test(before)
      )
        scope = 1;
      else if (
        SINGLE_AFTER.test(after) ||
        /разов|за\s+(?:один\s+)?прием/u.test(`${before} ${between} ${after}`)
      )
        scope = 0;
    }
    if (scope === null) continue;
    const value = amount.hi ?? amount.lo;
    caps.push({
      amountIndex,
      phraseStart: phrase.index,
      rule: {
        k: RULE_CAP,
        u: unitIndex(amount.unit),
        d1: value,
        ...(amount.per === 0 ? {} : { pk: amount.per }),
        bs: scope,
        ...(amount.piece ? { qu: pieceKindIndex(amount.piece) } : {}),
      },
    });
  }
  return caps;
}

function roleOf(text: string): number | undefined {
  for (const spec of ROLE_PATTERNS) if (spec.pattern.test(text)) return spec.role;
  return undefined;
}

interface DoseRead {
  readonly rule: Omit<DoseRule, 's' | 'a' | 'b'>;
}

function doseOf(
  text: string,
  amounts: readonly AmountMatch[],
  skip: ReadonlySet<number>,
  frequencyIndex: number,
  frequencies: ReturnType<typeof findFrequencies>,
): DoseRead | null {
  const candidates = amounts
    .map((amount, index) => ({ amount, index }))
    .filter(({ amount, index }) => !skip.has(index) && !amount.rate);
  if (candidates.length === 0) return null;
  // A rate («0,67 мл на кг в час») first in the clause makes the whole clause a rate.
  const leading = amounts.find((_, index) => !skip.has(index));
  if (leading?.rate) return null;
  const nonPiece = candidates.filter(
    ({ amount }) => amount.piece === null && amount.unit !== 'piece',
  );
  const pieces = candidates.filter(({ amount }) => amount.unit === 'piece');
  const mainMass = nonPiece.find(({ amount }) => !amount.inParentheses) ?? nonPiece[0];
  const mainPieces = pieces.find(({ amount }) => !amount.inParentheses) ?? pieces[0];

  // A diluent volume («развести в 100 мл воды») is no dose.
  const isDiluent = (amount: AmountMatch): boolean =>
    amount.unit === 'ml' &&
    DILUENT.test(text.slice(Math.max(0, amount.start - 6), amount.start)) &&
    DILUENT_AFTER.test(text.slice(amount.end));

  // The amount outside parentheses that comes first leads; the other one, in parentheses, is the
  // same dose in the other unit («по 1–2 таблетки (500–1000 мг)», «500 мг (1 таблетка)»).
  let primary =
    candidates.find(({ amount }) => !amount.inParentheses && !isDiluent(amount)) ??
    mainMass ??
    mainPieces;
  if (primary && isDiluent(primary.amount)) {
    primary = nonPiece.find(({ amount }) => !isDiluent(amount)) ?? mainPieces;
    if (primary && isDiluent(primary.amount)) return null;
  }
  if (!primary) return null;

  // «2 таблетки по 500 мг»: the mass belongs to each piece.
  const perPiece =
    mainPieces &&
    mainMass &&
    mainMass.amount.start >= mainPieces.amount.end &&
    ((mainMass.amount.byWord &&
      mainMass.amount.start - mainPieces.amount.end <= 45 &&
      !/[\d.;(]/u.test(text.slice(mainPieces.amount.end, mainMass.amount.start))) ||
      (!mainMass.amount.inParentheses &&
        !mainPieces.amount.inParentheses &&
        mainMass.amount.start - mainPieces.amount.end <= 2));
  const main = primary.amount;
  // «850 мг – 2 таблетки (1700 мг)»: a strength, a count, and their product in parentheses.
  const productInParentheses =
    mainMass && mainPieces && !mainMass.amount.inParentheses && !mainPieces.amount.inParentheses
      ? nonPiece.find(
          ({ amount }) =>
            amount.inParentheses &&
            amount.unit === mainMass.amount.unit &&
            amount.hi === null &&
            mainPieces.amount.hi === null &&
            mainMass.amount.hi === null &&
            Math.abs(amount.lo - mainMass.amount.lo * mainPieces.amount.lo) <
              1e-6 * Math.max(1, amount.lo),
        )
      : undefined;
  // «до 3 раз в сутки» is a ceiling on the frequency, not a frequency: left for the doctor to choose.
  const rawFrequency = frequencies[frequencyIndex];
  const before = text.slice(Math.max(0, main.start - 60), main.start);
  // «суточная доза [ампициллина | для взрослых] составляет 25–50 мг»: a short qualifier between the
  // words and the amount keeps the daily meaning unless it speaks of splitting into intakes.
  const dailyGap = /суточн\p{L}*\s+доз\p{L}*([^.;]{0,45})$/u.exec(before)?.[1];
  const dailyWord =
    (dailyGap !== undefined &&
      !/(?:^|[^\p{L}])(?:по|на|дел\p{L}*|раздел\p{L}*|разов\p{L}*|увелич\p{L}*|повыш\p{L}*|довод\p{L}*|довест\p{L}*|снижа\p{L}*|уменьш\p{L}*)(?![\p{L}])|\d/u.test(
        dailyGap,
      )) ||
    /доз\p{L}*\s+в\s+сутки\s*(?:составляет\s*)?[-–—:]?\s*$|в\s+суточной\s+дозе\s*$/u.test(before);
  // «300 мг (1 капсула 150 мг 2 раза в сутки)»: the amount outside is the day's total of the split inside.
  const splitInside = ((): boolean => {
    if (main.inParentheses || main.per !== 0 || main.hi !== null || main.unit === 'piece')
      return false;
    const rest = text.slice(main.end);
    const open = /^\s*\(/u.exec(rest);
    if (!open) return false;
    const close = rest.indexOf(')', open[0].length);
    const inside = rest.slice(open[0].length, close < 0 ? undefined : close);
    const innerFrequency = findFrequencies(inside).find(
      (item) => item.period === 1 && item.hi === item.lo,
    );
    const innerAmounts = findAmounts(inside);
    const innerMass = innerAmounts.find(
      (item) => item.unit === main.unit && !item.rate && item.per === 0,
    );
    if (!innerFrequency || !innerMass) return false;
    const innerPieces = innerAmounts.find((item) => item.unit === 'piece')?.lo ?? 1;
    const total = innerMass.lo * innerPieces * innerFrequency.lo;
    return Math.abs(total - main.lo) <= 1e-6 * Math.max(1, main.lo);
  })();
  // «400 мг/сутки (2 таблетки утром, 2 таблетки вечером)»: the pieces in parentheses are the day's, in parts.
  const piecesInParts = ((): boolean => {
    if (main.unit === 'piece') return false;
    const rest = text.slice(main.end);
    const open = /^\s*\(/u.exec(rest);
    if (!open) return false;
    const close = rest.indexOf(')', open[0].length);
    const inside = rest.slice(open[0].length, close < 0 ? undefined : close);
    return findAmounts(inside).filter((item) => item.unit === 'piece').length >= 2;
  })();
  // «в сутки в 3 приема», «суточная доза, разделенная на 3 приема»: every amount of the clause is the day's.
  const dividedDaily =
    /(?:сутки|сут\.?|день)\s+(?:в|на|за)\s+\d(?:\s*-\s*\d)?\s+(?:прием|введени)|разделе\p{L}*\s+на\s+\d(?:\s*-\s*\d)?\s+(?:прием|введени)/u.test(
      text,
    ) && main.per !== 2;
  // «10 мг/кг в 2–3 приема»: an amount shared out over intakes is a day's amount (unless «по» says each).
  const sharedOut =
    /(?:^|[^\p{L}])в\s+\d(?:\s*-\s*\d)?\s+прием/u.test(text.slice(main.end, main.end + 60)) &&
    !/(?:^|[^\p{L}])по\s*$/u.test(text.slice(Math.max(0, main.start - 6), main.start)) &&
    main.per !== 2;
  let basis: 0 | 1 =
    main.daily ||
    dailyWord ||
    splitInside ||
    dividedDaily ||
    sharedOut ||
    (perPiece && mainMass.amount.daily)
      ? 1
      : 0;
  // A day's amount with an interval of weeks («… до 40 мг в сутки, оценивать каждые 4 недели») has no frequency.
  const frequency =
    rawFrequency?.upTo || (basis === 1 && (rawFrequency?.period ?? 1) > 1)
      ? undefined
      : rawFrequency;
  let q0: number | undefined;
  let q1: number | undefined;
  let qu: number | undefined;
  let pm: number | undefined;
  let u = main.unit;
  let d0 = main.lo;
  let d1 = main.hi ?? undefined;
  let pk = main.per;

  if (main.unit === 'piece') {
    // Pieces only (or pieces first): «по 1–2 таблетки (500–1000 мг)».
    const mass =
      mainMass && (mainMass.amount.unit === 'mg' || mainMass.amount.unit === 'ml')
        ? mainMass.amount
        : null;
    if (mass && mass.unit === 'ml' && mass.per === 0 && mass.inParentheses) {
      // «по 1 десертной ложке (10 мл)»: the volume is the dose, the spoon its measure.
      u = 'ml';
      d0 = mass.lo;
      d1 = mass.hi ?? undefined;
    }
    q0 = main.lo;
    q1 = main.hi ?? undefined;
    qu = main.piece ? pieceKindIndex(main.piece) : undefined;
    if (mass && mass.unit === 'mg' && mass.per === 0) {
      if (perPiece) {
        pm = mass.lo;
        u = 'mg';
        d0 = main.lo * mass.lo;
        d1 = main.hi === null ? undefined : main.hi * mass.lo;
      } else if (!mass.inParentheses) {
        // A mass that is neither per piece nor in parentheses may belong to anything: pieces only.
        pk = 0;
      } else if (mass.hi === null && main.hi === null && main.lo > 0) {
        pm = mass.lo / main.lo;
        u = 'mg';
        d0 = mass.lo;
        d1 = undefined;
      } else if (mass.inParentheses && mass.hi !== null && main.hi !== null && main.lo > 0) {
        const ratio = mass.lo / main.lo;
        if (Math.abs(mass.hi / main.hi - ratio) < 1e-6 * Math.max(1, ratio)) {
          pm = ratio;
          u = 'mg';
          d0 = mass.lo;
          d1 = mass.hi;
        }
      }
    }
    pk = 0;
  } else {
    // Mass first: pieces in parentheses are the same dose in tablets.
    if (
      mainPieces &&
      main.per === 0 &&
      mainPieces.amount.inParentheses &&
      !splitInside &&
      !piecesInParts
    ) {
      q0 = mainPieces.amount.lo;
      q1 = mainPieces.amount.hi ?? undefined;
      qu = mainPieces.amount.piece ? pieceKindIndex(mainPieces.amount.piece) : undefined;
      if (u === 'mg' && q0 > 0 && main.hi === null && q1 === undefined) pm = main.lo / q0;
      else if (u === 'mg' && q0 > 0 && main.hi !== null && q1 !== undefined) {
        const ratio = main.lo / q0;
        if (Math.abs(main.hi / q1 - ratio) < 1e-6 * Math.max(1, ratio)) pm = ratio;
        else {
          q0 = undefined;
          q1 = undefined;
          qu = undefined;
        }
      }
    }
  }

  if (productInParentheses && mainMass && mainPieces) {
    u = 'mg';
    d0 = productInParentheses.amount.lo;
    d1 = undefined;
    pm = mainMass.amount.lo;
    q0 = mainPieces.amount.lo;
    q1 = undefined;
    qu = mainPieces.amount.piece ? pieceKindIndex(mainPieces.amount.piece) : undefined;
    pk = 0;
  }

  // «1 таблетка в сутки» is one intake a day; a larger count a day is a daily total.
  let f0: number | undefined;
  let f1: number | undefined;
  let fp: number | undefined;
  let up: 1 | undefined;
  if (frequency) {
    f0 = frequency.lo;
    f1 = frequency.hi;
    if (frequency.period !== 1) fp = frequency.period;
    if (frequency.upTo) up = 1;
  } else if (main.unit === 'piece' && main.daily && main.lo <= 1) {
    basis = 0;
    f0 = 1;
    f1 = 1;
  }
  if (main.upTo) up = 1;
  if (basis === 1 && main.unit === 'piece' && frequency === undefined && main.lo <= 1) basis = 0;

  const rule: Omit<DoseRule, 's' | 'a' | 'b'> = {
    k: RULE_DOSE,
    u: unitIndex(u),
    d0,
    ...(d1 === undefined ? {} : { d1 }),
    ...(pk === 0 ? {} : { pk }),
    ...(basis === 0 ? {} : { bs: basis }),
    ...(up ? { up } : {}),
    ...(q0 === undefined ? {} : { q0 }),
    ...(q1 === undefined ? {} : { q1 }),
    ...(qu === undefined ? {} : { qu }),
    ...(pm === undefined ? {} : { pm: round6(pm) }),
    ...(f0 === undefined ? {} : { f0 }),
    ...(f1 === undefined ? {} : { f1 }),
    ...(fp === undefined ? {} : { fp }),
  };
  return { rule };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Amounts in mg keep six decimals: 1,6 мкг is 0.0016 mg, not 0.002. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundRule<T extends Omit<DoseRule, 's' | 'a' | 'b'>>(rule: T): T {
  const copy: Record<string, unknown> = { ...rule };
  for (const key of ['d0', 'd1', 'q0', 'q1', 'f0', 'f1', 't0', 't1']) {
    const value = copy[key];
    if (typeof value === 'number') copy[key] = key.startsWith('d') ? round6(value) : round3(value);
  }
  return copy as unknown as T;
}

interface ClauseResult {
  readonly rules: readonly DoseRule[];
  readonly hadAmount: boolean;
}

interface SectionState {
  /** Routes named before the first dose of the section («Внутрь.»). */
  leadRoute: number;
  seenDose: boolean;
  /** Stems of the words that name the document's own drug. */
  subject: readonly string[];
  /** The title of the section being read («В зависимости от массы тела ребенка …»), for the gate. */
  sectionTitle: string;
  /** The dosage form the document's metadata states, for the unit check of the gate. */
  dosageForm: string | null;
  /** The document's drug is a combination of several substances (its name has several words). */
  combination: boolean;
  /** The last clause that named a population itself: the clauses after it without one inherit it. */
  sticky?: { readonly population: Population; readonly start: number; readonly end: number };
}

/**
 * A clause sets the population of the clauses after it only when it leads with it («Дети от 6 до 12
 * лет …») or states an age or weight; a child mentioned in the middle of a sentence does not.
 */
function namesPopulationFirst(text: string, population: Population): boolean {
  if (
    population.p0 !== undefined ||
    population.p1 !== undefined ||
    population.w0 !== undefined ||
    population.w1 !== undefined
  ) {
    return true;
  }
  const first = GROUP_PATTERNS.map((spec) => spec.pattern.exec(text)?.index ?? Infinity);
  return Math.min(...first) < 30;
}

/** Two bands of one kind, or three limits, in one clause: a flattened table of ages or weights. */
function isTableOfLimits(limits: ReturnType<typeof extractAmountLimits>): boolean {
  for (const dimension of ['age', 'weight'] as const) {
    const own = limits.filter((limit) => limit.dimension === dimension);
    if (own.length >= 3 || own.filter((limit) => limit.operator === 'range').length >= 2) {
      return true;
    }
    // Two limits far apart are two rows of a table; a «от X и до Y» pair is one band.
    if (own.length === 2) {
      const [first, second] = own;
      if (first && second && second.start - first.end > 60) return true;
      // «от 19 кг и до 40 кг» is a band; «более 40 кг … 40 кг или менее» is two rows.
      const lower = first?.lower ?? second?.lower ?? null;
      const upper = first?.upper ?? second?.upper ?? null;
      if (lower !== null && upper !== null && lower >= upper) return true;
    }
  }
  return false;
}

/** What a clause takes from the lines and clauses before it. */
interface Inherited {
  readonly population: Population | null;
  readonly cond: number;
  readonly span: [number, number] | null;
  /** Where the population came from, for the gate. */
  readonly source: PopulationSource;
}

const STICKY_SPAN_LIMIT = 220;
/** A population carries on for this many characters after the sentence or heading that set it. */
const STICKY_DISTANCE = 900;
const HEADING_DISTANCE = 1800;

/**
 * The population a clause without words of its own stands under: the nearest heading or earlier
 * clause that named one. A clause that restricts itself to a condition (renal function, say) does not
 * take a population from the clauses before it: its own words are the restriction.
 */
function inheritedBy(
  own: Population | null,
  ownCond: number,
  clause: TextSpan,
  heading: Heading | undefined,
  state: SectionState,
): Inherited {
  const headingCond = heading?.cond ?? 0;
  if (own !== null && own.g === 0) {
    // Only an age or a weight («масса тела 50 кг или более»): the group of the lines before it applies.
    const before = state.sticky;
    if (before && before.start < clause.start && clause.start - before.end <= STICKY_DISTANCE) {
      return {
        population: {
          ...own,
          g: before.population.g,
          ...(own.p0 === undefined && own.p1 === undefined
            ? {
                ...(before.population.p0 === undefined ? {} : { p0: before.population.p0 }),
                ...(before.population.p1 === undefined ? {} : { p1: before.population.p1 }),
              }
            : {}),
        },
        cond: headingCond,
        span: [before.start, Math.min(before.end, before.start + STICKY_SPAN_LIMIT)] as [
          number,
          number,
        ],
        source: 'sticky',
      };
    }
  }
  if (own !== null) return { population: own, cond: headingCond, span: null, source: 'own' };
  if (ownCond !== 0) return { population: null, cond: headingCond, span: null, source: 'none' };
  const sticky =
    state.sticky &&
    state.sticky.start < clause.start &&
    clause.start - state.sticky.end <= STICKY_DISTANCE
      ? state.sticky
      : undefined;
  if (sticky && (!heading || sticky.start >= heading.start)) {
    return {
      population: sticky.population,
      cond: headingCond,
      span: [sticky.start, Math.min(sticky.end, sticky.start + STICKY_SPAN_LIMIT)] as [
        number,
        number,
      ],
      source: 'sticky',
    };
  }
  if (heading && clause.start - heading.end <= HEADING_DISTANCE) {
    return {
      population: heading.population,
      cond: headingCond,
      span: [heading.start, heading.end] as [number, number],
      source: 'heading',
    };
  }
  return { population: null, cond: 0, span: null, source: 'none' };
}

function contextOf(
  population: Population | null,
  cond: number,
  span: [number, number] | null,
): Partial<DoseRule> {
  return {
    ...(population?.p0 === undefined ? {} : { p0: population.p0 }),
    ...(population?.p1 === undefined ? {} : { p1: population.p1 }),
    ...(population?.w0 === undefined ? {} : { w0: population.w0 }),
    ...(population?.w1 === undefined ? {} : { w1: population.w1 }),
    ...(population && population.g !== 0 ? { g: population.g } : {}),
    ...(population?.or ? { or: population.or } : {}),
    ...(cond === 0 ? {} : { c: cond }),
    ...(span && (population || cond !== 0) ? { h: span } : {}),
  };
}

/**
 * A short clause with no verb that follows a line «Таблица N …» is a row of that table flattened to
 * text: the cells that said who it is for (a clearance band, a weight row) are lines of their own,
 * so the row alone must not be read as a dose.
 */
export function inTableContext(norm: string, clauseStart: number, text: string): boolean {
  if (
    text.length > 320 ||
    /(?:назнач|принима|рекоменд|вводят|вводить|применя|следует|необходим|должн)\p{L}*/u.test(text)
  ) {
    return false;
  }
  const before = norm.slice(Math.max(0, clauseStart - 3000), clauseStart);
  const captions = [...before.matchAll(/(?:^|\s)таблица\s+\d+/gu)];
  const caption = captions[captions.length - 1];
  if (!caption) return false;
  const between = before.slice(caption.index + caption[0].length);
  return !/\p{L}[.!?]\s+\p{L}{3,}\s+\p{L}{3,}\s+\p{L}{3,}/u.test(between);
}

/** «30–50 750 мг …», «>50 1,5 г …»: a band cell of a table in front of the dose of its row. */
const BAND_CELL = /^(?:[>≥<≤]\s*\d|\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s+\d)/u;

function readClause(
  norm: string,
  clause: TextSpan,
  heading: Heading | undefined,
  state: SectionState,
): ClauseResult {
  const text = norm.slice(clause.start, clause.end);
  const own = populationOf(text, text);
  const ownCond = conditionBits(text);
  const inherited = inheritedBy(own, ownCond, clause, heading, state);
  let tableLike = false;
  const finish = (read: ClauseResult): ClauseResult => {
    const context =
      inherited.span === null ? null : norm.slice(inherited.span[0], inherited.span[1]);
    const result: ClauseResult = {
      ...read,
      rules: read.rules.map((rule) => {
        const shape = classifyRule({
          rule,
          clause: text,
          before: norm.slice(Math.max(0, clause.start - 500), clause.start),
          source: inherited.source,
          contextText: context,
          between: inherited.span === null ? '' : norm.slice(inherited.span[1], clause.start),
          dosageForm: state.dosageForm,
          subject: state.subject,
          combination: state.combination,
          sectionTitle: state.sectionTitle,
          after: norm.slice(clause.end, clause.end + 80),
        });
        const code = shapeIndex(shape);
        return code === 0 ? rule : { ...rule, gc: code };
      }),
    };
    if (
      own !== null &&
      !tableLike &&
      namesPopulationFirst(text, own) &&
      !RESTRICTION.test(text) &&
      !ADMINISTRATION.test(text) &&
      !result.hadAmount
    ) {
      state.sticky = { population: own, start: clause.start, end: clause.end };
    }
    return result;
  };
  if (text.length > MAX_CLAUSE_LENGTH || !AMOUNT_ANYWHERE.test(text)) {
    return finish({ rules: [], hadAmount: false });
  }
  const amounts = findAmounts(text);
  if (amounts.length === 0) {
    // A duration alone is still a statement worth keeping.
    return finish(durationOnly(text, clause, ownCond, inherited));
  }
  // A flattened table: comparison signs next to numbers («> 33 кг − ≤ 50 кг»), or two age limits.
  const limits = extractAmountLimits(text);
  if (
    BAND_CELL.test(text) ||
    inTableContext(norm, clause.start, text) ||
    /[≤≥<>]\s*\d/u.test(text) ||
    /\*\*/u.test(text) ||
    /(?:^|\s)таблиц\p{L}*\s+\d|^таблиц/u.test(text) ||
    isTableOfLimits(limits)
  ) {
    tableLike = true;
    return finish({ rules: [], hadAmount: true });
  }
  const frequencies = findFrequencies(text);
  const durations = findDurations(text);
  const caps = capsOf(text, amounts);
  const skip = new Set(caps.map((cap) => cap.amountIndex));
  // Amounts after a cap phrase belong to the cap sentence («… не более 10 мг, а для X — 25 мг»).
  const firstCap = Math.min(...caps.map((cap) => cap.phraseStart));
  amounts.forEach((amount, index) => {
    if (caps.length > 0 && amount.start >= firstCap) skip.add(index);
  });
  const negative = NEGATIVE.test(text);
  const cond = ownCond | inherited.cond;
  // «перевести Вас на прием внутрь» names the next step, not the route of this dose; «после окончания
  // внутривенной терапии», «после внутривенного применения» name the earlier therapy.
  const routeText = text
    .replace(/(?:перевест\p{L}*|переход\p{L}*\s+на|переводить)[^.;]{0,60}/gu, ' ')
    .replace(
      /(?:после|перед|вслед\s+за)\s+(?:\p{L}+\s+){0,2}?(?:внутривенн|внутримышечн|подкожн|парентеральн)\p{L}*/gu,
      ' ',
    );
  const routeBits = bitsOf(ROUTES, routeText);
  const forms = detectDosageForms(routeText);

  // The frequency to read: the first one after the first amount, else the first.
  const firstAmount = amounts.find((_, index) => !skip.has(index));
  const frequencyIndex = Math.max(
    0,
    frequencies.findIndex((frequency) => !firstAmount || frequency.start >= firstAmount.start),
  );
  // «в комбинации с 200 мг пембролизумаба»: the amount belongs to another drug.
  const partnerDose =
    firstAmount !== undefined &&
    /(?:(?:в\s+комбинации|совместно|вместе|в\s+сочетании|одновременно)\s+с\s+[^.;]{0,60}|дополнительно\s+(?:применять|назначать|принимать|вводить)[^.;]{0,60})$/u.test(
      text.slice(0, firstAmount.end),
    );
  const otherDrug =
    firstAmount !== undefined && namesOtherDrugBefore(text, firstAmount.start, state.subject);
  // «Максимальная доза … составляет 14 мг»: a ceiling whose scope the sentence does not say is no dose.
  const ceilingWithoutScope =
    caps.length === 0 &&
    firstAmount !== undefined &&
    /(?:максимальн|предельн|высш)\p{L}*\s+(?:\p{L}+\s+){0,3}?доз/u.test(
      text.slice(0, firstAmount.start),
    );
  const dose =
    negative || partnerDose || ceilingWithoutScope || PREPARATION.test(text) || otherDrug
      ? null
      : doseOf(text, amounts, skip, frequencyIndex, frequencies);
  const frequency = frequencies[frequencyIndex];
  const duration = durations[0];

  const out: Omit<DoseRule, 's' | 'a' | 'b'>[] = [];
  const context = contextOf(inherited.population, cond, inherited.span);
  const rt = routeBits !== 0 ? routeBits : state.leadRoute;
  const base = {
    ...(rt === 0 ? {} : { rt }),
    ...(forms === 0 ? {} : { fm: forms }),
  };

  if (dose) {
    const hasDosePhrase = DOSE_CUE.test(
      text.slice(Math.max(0, (firstAmount?.start ?? 0) - 25), (firstAmount?.start ?? 0) + 1),
    );
    const certain =
      frequency !== undefined || dose.rule.bs === 1 || /однократно/u.test(text) || hasDosePhrase;
    // «дозу 1,3 мг/м2 снижают до 1,0»: a change of a dose, not a dose, unless it comes with a frequency.
    const modification =
      /(?:снизи|снижа|уменьш|изменени\p{L}*\s+доз|изменить\s+доз)\p{L}*/u.test(text) ||
      // «дозу увеличивают на 20 мг»: a step, never a dose.
      /(?:увелич|повыш|уменьш|снизи|снижа)\p{L}*\s+(?:[\p{L}]+\s+){0,3}на\s+\d/u.test(text) ||
      (MODIFIER.test(text) && frequency === undefined && dose.rule.bs !== 1);
    if (certain && !modification) {
      // A dose with a frequency («однократная доза ... каждые 4 недели») is repeated, not a one-off.
      const found = roleOf(text);
      const role = found === ROLE_SINGLE && dose.rule.f0 !== undefined ? undefined : found;
      out.push(
        roundRule({
          ...dose.rule,
          ...context,
          ...base,
          ...(duration
            ? {
                t0: duration.lo,
                t1: duration.hi,
                ...(duration.atMost ? { tm: 1 as const } : {}),
              }
            : {}),
          ...(role === undefined ? {} : { ro: role }),
        } as Omit<DoseRule, 's' | 'a' | 'b'>),
      );
      state.seenDose = true;
    }
  }
  for (const cap of caps) {
    out.push(roundRule({ ...cap.rule, ...context, ...base } as Omit<DoseRule, 's' | 'a' | 'b'>));
  }
  if (out.length === 0 && duration) {
    return finish(durationOnly(text, clause, ownCond, inherited));
  }
  return finish({
    rules: out.map((rule) => ({ ...rule, s: 0, a: clause.start, b: clause.end })),
    hadAmount: true,
  });
}

function durationOnly(
  text: string,
  clause: TextSpan,
  ownCond: number,
  inherited: Inherited,
): ClauseResult {
  const duration = findDurations(text)[0];
  if (!duration || NEGATIVE.test(text)) return { rules: [], hadAmount: false };
  const rule: DoseRule = {
    k: RULE_DURATION,
    s: 0,
    a: clause.start,
    b: clause.end,
    ...contextOf(inherited.population, ownCond | inherited.cond, inherited.span),
    t0: round3(duration.lo),
    t1: round3(duration.hi),
    ...(duration.atMost ? { tm: 1 as const } : {}),
  };
  return { rules: [rule], hadAmount: false };
}

/** The headings that apply at `offset`: the last one before it, unless a reset came after. */
function headingAt(headings: readonly Heading[], offset: number): Heading | undefined {
  let current: Heading | undefined;
  for (const heading of headings) {
    if (heading.start >= offset) break;
    current = heading.reset ? undefined : heading;
  }
  return current;
}

/** «3 млн. МЕ в объеме …»: a full stop after an abbreviation does not end the sentence. */
function mergeAbbreviations(canonical: string, spans: readonly TextSpan[]): readonly TextSpan[] {
  const merged: TextSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      /(?:млн|тыс)\.\s*$/u.test(canonical.slice(previous.start, previous.end).toLowerCase())
    ) {
      merged[merged.length - 1] = { start: previous.start, end: span.end };
    } else merged.push(span);
  }
  return merged;
}

interface Joined {
  readonly text: string;
  /** The same text with the letters as printed (the normal form is lower case). */
  readonly cased: string;
  /** Joined offset → canonical offset (length + 1 entries). */
  readonly toCanonical: readonly number[];
  /** Canonical offset → joined offset (length + 1 entries). */
  readonly fromCanonical: readonly number[];
}

/**
 * The normal form of the canonical text with the hyphenation of the PDF removed («де- тям» →
 * «детям»), and the offset maps between the two. Everything the parsers read works on the joined
 * text; the rules store canonical offsets.
 */
export function joinHyphenation(canonical: string): Joined {
  const normal = normalizeForLimits(canonical);
  const toCanonical: number[] = [];
  const fromCanonical: number[] = new Array<number>(normal.length + 1).fill(0);
  let text = '';
  let cased = '';
  let index = 0;
  while (index < normal.length) {
    if (
      normal.charAt(index) === '-' &&
      index > 0 &&
      /\p{L}/u.test(normal.charAt(index - 1)) &&
      /\s/u.test(normal.charAt(index + 1))
    ) {
      let after = index + 1;
      while (after < normal.length && /\s/u.test(normal.charAt(after))) after += 1;
      if (after < normal.length && /\p{Ll}/u.test(normal.charAt(after))) {
        for (let skipped = index; skipped < after; skipped += 1)
          fromCanonical[skipped] = text.length;
        index = after;
        continue;
      }
    }
    fromCanonical[index] = text.length;
    toCanonical.push(index);
    text += normal.charAt(index);
    cased += /\s/u.test(canonical.charAt(index)) ? ' ' : canonical.charAt(index);
    index += 1;
  }
  fromCanonical[normal.length] = text.length;
  toCanonical.push(normal.length);
  return { text, cased, toCanonical, fromCanonical };
}

export function extractDoseRules(
  sections: readonly DoseSectionInput[],
  options: {
    readonly subject?: readonly (string | null | undefined)[];
    readonly dosageForm?: string | null;
  } = {},
): ExtractedDoseRules {
  const stems = subjectStems(options.subject ?? []);
  const kept: { id: string; checksum: string }[] = [];
  const rules: DoseRule[] = [];
  let divisible = false;
  let clauses = 0;
  let skippedAmounts = 0;
  for (const section of sections) {
    if (section.chunks.length === 0) continue;
    const canonical = canonicalSectionText(section.chunks).text;
    const joined = joinHyphenation(canonical);
    const norm = joined.text;
    if (DIVISIBLE.test(norm)) divisible = true;
    const isDose =
      section.type === 'dosage' ||
      ((section.type === 'other' || section.type === 'treatment') &&
        /способ|режим дозиров|дозиров|рекомендуем\p{L}* доз|прием препарата|приём препарата|применение препарата|как принимать/iu.test(
          section.title,
        ) &&
        section.title.length < 80);
    if (!isDose) continue;
    const toJoined = (span: TextSpan): TextSpan => ({
      start: joined.fromCanonical[span.start] ?? 0,
      end: joined.fromCanonical[span.end] ?? norm.length,
    });
    const headings = headingsOf(lineSpans(canonical).map(toJoined), norm, joined.cased);
    // Routes named on plain lines before the first amount of the section («Внутрь.», «Для приема
    // внутрь»): a route word inside a sentence of prose («ингаляционные анестетики») is no lead.
    const firstAmount = findAmounts(norm.slice(0, 1500))[0];
    const leadEnd = joined.toCanonical[firstAmount?.start ?? 300] ?? 300;
    const leadLines = canonical
      .slice(0, leadEnd)
      .split('\n')
      .map((line) => line.trim())
      .map((line) => normalizeForLimits(line))
      .filter(
        (line) =>
          line.length <= 70 &&
          /^(?:для\s+)?(?:приема\s+)?(?:внутрь|перорально|внутривенно|в\/в|внутримышечно|в\/м|подкожно|наружно|местно|ингаляционно|ректально|вагинально|интравагинально|интраназально|сублингвально|под\s+язык|в\s+конъюнктивальн)/u.test(
            line,
          ),
      );
    const state: SectionState = {
      leadRoute: bitsOf(ROUTES, leadLines.join(' ')),
      seenDose: false,
      sectionTitle: normalizeForLimits(section.title),
      subject: stems,
      dosageForm: options.dosageForm ?? null,
      combination:
        new Set(
          (normalizeForLimits(options.subject?.[0] ?? '').match(/[\p{L}]{5,}/gu) ?? []).map(
            (word) => word.slice(0, 5),
          ),
        ).size >= 2,
    };
    const sectionRules: DoseRule[] = [];
    const back = (offset: number): number => joined.toCanonical[offset] ?? canonical.length;
    for (const original of mergeAbbreviations(canonical, splitSentenceSpans(canonical))) {
      for (const clause of clausesOf(norm, toJoined(original))) {
        clauses += 1;
        const result = readClause(norm, clause, headingAt(headings, clause.start), state);
        if (result.hadAmount && result.rules.length === 0) skippedAmounts += 1;
        for (const rule of result.rules) {
          sectionRules.push({
            ...rule,
            a: back(rule.a),
            b: back(rule.b),
            ...(rule.h ? { h: [back(rule.h[0]), back(rule.h[1])] as const } : {}),
          });
        }
      }
    }
    const index = kept.length;
    kept.push({ id: section.id, checksum: sectionChecksum(canonical) });
    for (const rule of sectionRules) rules.push({ ...rule, s: index });
  }
  const limited = rules.slice(0, MAX_RULES_PER_DOCUMENT);
  return {
    sections: kept,
    rules: limited,
    divisible,
    stats: {
      clauses,
      doseRules: limited.filter((rule) => rule.k === RULE_DOSE).length,
      capRules: limited.filter((rule) => rule.k === RULE_CAP).length,
      durationRules: limited.filter((rule) => rule.k === RULE_DURATION).length,
      skippedAmounts,
    },
  };
}

export { numberValue };
