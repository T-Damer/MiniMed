/**
 * Numbers, units, frequencies and durations of a dose sentence (RX1). Syntactic only: the patterns
 * read what the instruction prints, in the instruction's own units, and never decide what a dose
 * should be. Every function works on the length-preserving normal form of `normalizeForLimits`
 * (lower case, «ё» as «е», dashes as «-», whitespace as spaces) so offsets found here point at the
 * same characters of the section's canonical text.
 */
import { DOSE_UNITS, type DoseUnit, PIECE_KINDS, type PieceKind } from '@localmed/contracts';

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  одна: 1,
  одну: 1,
  одной: 1,
  один: 1,
  одного: 1,
  одно: 1,
  одному: 1,
  две: 2,
  два: 2,
  двух: 2,
  три: 3,
  трех: 3,
  четыре: 4,
  четырех: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
  десять: 10,
  десяти: 10,
  двенадцать: 12,
  двенадцати: 12,
  половина: 0.5,
  половину: 0.5,
  половине: 0.5,
  половины: 0.5,
  полторы: 1.5,
  полтора: 1.5,
};

const WORD_SOURCE = Object.keys(WORD_NUMBERS)
  .toSorted((left, right) => right.length - left.length)
  .join('|');

/** Digits with an optional decimal part or a simple fraction, a unicode fraction, or a number word. */
export const NUMBER_SOURCE = `(?:\\d{1,3}(?: \\d{3})+(?!\\d)|\\d+(?:[.,]\\d+)?(?:(?: \\d)?\\/(?:2|3|4|8)(?!\\d))?|[½¼¾⅓]|(?<![\\p{L}\\d])(?:${WORD_SOURCE})(?![\\p{L}\\d]))`;

const UNICODE_FRACTIONS: Readonly<Record<string, number>> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
};

/** The value of a number as `NUMBER_SOURCE` matches it; null when it is not a number. */
export function numberValue(source: string): number | null {
  const text = source.trim();
  const fraction = UNICODE_FRACTIONS[text];
  if (fraction !== undefined) return fraction;
  const word = WORD_NUMBERS[text];
  if (word !== undefined) return word;
  const mixed = /^(\d+) (\d)\/(\d)$/u.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const simple = /^(\d+)\/(\d)$/u.exec(text);
  if (simple) {
    const numerator = Number(simple[1]);
    const denominator = Number(simple[2]);
    return numerator < denominator ? numerator / denominator : null;
  }
  const thousands = /^\d{1,3}(?: \d{3})+$/u.test(text) ? text.replaceAll(' ', '') : text;
  const value = Number(thousands.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

interface UnitSpec {
  readonly unit: DoseUnit;
  /** Multiplier from the printed unit to the base unit (mg, ml, ...). */
  readonly factor: number;
  readonly piece?: PieceKind;
  /** The plain word «доза»: also the noun of a sentence («одна доза 750 мг»). */
  readonly doseWord?: true;
  readonly source: string;
}

const SPECS: readonly UnitSpec[] = [
  { unit: 'mg', factor: 0.001, source: 'мкг|микрограмм\\p{L}*' },
  { unit: 'mg', factor: 1, source: 'мг|миллиграмм\\p{L}*' },
  { unit: 'mg', factor: 1000, source: 'г(?![\\p{L}\\d])|грамм\\p{L}*' },
  { unit: 'ml', factor: 1, source: 'мл|миллилитр\\p{L}*' },
  { unit: 'ml', factor: 1000, source: 'л(?![\\p{L}\\d])|литр\\p{L}*' },
  { unit: 'IU', factor: 1_000_000, source: 'млн\\.?\\s*ме' },
  { unit: 'IU', factor: 1000, source: 'тыс\\.?\\s*ме' },
  { unit: 'IU', factor: 1, source: 'ме(?![\\p{L}\\d])' },
  { unit: 'U', factor: 1_000_000, source: 'млн\\.?\\s*ед' },
  { unit: 'U', factor: 1000, source: 'тыс\\.?\\s*ед' },
  { unit: 'U', factor: 1, source: 'ед(?![\\p{L}\\d])' },
  { unit: 'mmol', factor: 1, source: 'ммоль' },
  { unit: 'drop', factor: 1, source: 'капл\\p{L}*|капель|кап(?![\\p{L}\\d])\\.?' },
  { unit: 'dose', factor: 1, doseWord: true, source: 'доз(?:а|ы|у|е|ами|ой)?(?![\\p{L}\\d])' },
  { unit: 'dose', factor: 1, source: 'нажати\\p{L}*|впрыскива\\p{L}*|вдох\\p{L}*|ингаляци\\p{L}*' },
  {
    unit: 'piece',
    factor: 1,
    piece: 'tablet',
    source: 'таблет\\p{L}*|табл(?![\\p{L}\\d])\\.?|драже',
  },
  { unit: 'piece', factor: 1, piece: 'capsule', source: 'капсул\\p{L}*|капс(?![\\p{L}\\d])\\.?' },
  { unit: 'piece', factor: 1, piece: 'lozenge', source: 'пастилк\\p{L}*|леденц\\p{L}*' },
  { unit: 'piece', factor: 1, piece: 'suppository', source: 'свеч\\p{L}*|суппозитор\\p{L}*' },
  {
    unit: 'piece',
    factor: 1,
    piece: 'sachet',
    source: 'саше|пакетик\\p{L}*|пакет(?:а|ов)?(?![\\p{L}\\d])',
  },
  { unit: 'piece', factor: 1, piece: 'ampoule', source: 'ампул\\p{L}*' },
  { unit: 'piece', factor: 1, piece: 'vial', source: 'флакон\\p{L}*' },
  { unit: 'piece', factor: 1, piece: 'patch', source: 'пластыр\\p{L}*' },
  { unit: 'piece', factor: 1, piece: 'measure', source: 'мерн\\p{L}*\\s+ложк\\p{L}*' },
  { unit: 'piece', factor: 1, piece: 'cap', source: 'мерн\\p{L}*\\s+колпач\\p{L}*' },
  { unit: 'piece', factor: 1, piece: 'cup', source: 'мерн\\p{L}*\\s+стакан\\p{L}*' },
  {
    unit: 'piece',
    factor: 1,
    piece: 'teaspoon',
    source: 'чайн\\p{L}*\\s+ложк\\p{L}*|ч\\.\\s?л\\.',
  },
  {
    unit: 'piece',
    factor: 1,
    piece: 'tablespoon',
    source: 'столов\\p{L}*\\s+ложк\\p{L}*|ст\\.\\s?л\\.',
  },
  { unit: 'piece', factor: 1, piece: 'dessertspoon', source: 'десертн\\p{L}*\\s+ложк\\p{L}*' },
];

export const UNIT_SOURCE = SPECS.map((spec, index) => `(?<u${index}>${spec.source})`).join('|');

export interface UnitMatch {
  readonly unit: DoseUnit;
  readonly factor: number;
  readonly piece: PieceKind | null;
  readonly doseWord: boolean;
}

/** Which unit alternative matched (`u0`, `u1`, ... groups of `UNIT_SOURCE`). */
export function unitOfGroups(
  groups: Readonly<Record<string, string | undefined>>,
): UnitMatch | null {
  for (let index = 0; index < SPECS.length; index += 1) {
    if (groups[`u${index}`] !== undefined) {
      const spec = SPECS[index] as UnitSpec;
      return {
        unit: spec.unit,
        factor: spec.factor,
        piece: spec.piece ?? null,
        doseWord: spec.doseWord === true,
      };
    }
  }
  return null;
}

export function unitIndex(unit: DoseUnit): number {
  return DOSE_UNITS.indexOf(unit);
}

export function pieceKindIndex(kind: PieceKind): number {
  return PIECE_KINDS.indexOf(kind);
}

const RANGE_JOINER = '(?:\\s*-\\s*|\\s+или\\s+|\\s+до\\s+)';

export interface AmountMatch {
  readonly start: number;
  readonly end: number;
  readonly lo: number;
  readonly hi: number | null;
  readonly unit: DoseUnit;
  readonly piece: PieceKind | null;
  /** 1 per kilogram of body mass, 2 per square metre of body surface, 0 absolute. */
  readonly per: 0 | 1 | 2;
  /** The amount is followed by «в сутки», «/сут» or the like. */
  readonly daily: boolean;
  /** «мг/мл», «мкг/мин», «мг/ч»: a concentration or a rate, not a dose. */
  readonly rate: boolean;
  /** «до 3 г»: an upper limit. */
  readonly upTo: boolean;
  readonly inParentheses: boolean;
  /** The text between a leading «по» and the number was «по» itself. */
  readonly byWord: boolean;
}

const AMOUNT = new RegExp(
  `(?<![\\p{L}\\d.,/])(?<pre>(?:до|по|от)\\s+)?(?<n1>${NUMBER_SOURCE})(?:${RANGE_JOINER}(?<n2>${NUMBER_SOURCE}))?\\s*(?:-?\\s*)?(?:${UNIT_SOURCE})(?![\\p{L}\\d])`,
  'gu',
);

const PER_KG =
  /^(?:\s*\/\s*(?:1\s*)?кг|\s+\p{L}+\s*\/\s*(?:1\s*)?кг|\s+(?:[\p{L}\d%.,-]+\s+){0,3}?на\s+(?:(?:1|каждый|каждого|один|единицу)\s+)?(?:кг|килограмм\p{L}*)|\s*\/\s*килограмм)(?:\s+(?:массы\s+(?:\p{L}+\s+)?тела|веса(?:\s+тела)?|тела|веса))?/u;
/** «на … кг» that PER_KG did not understand: the amount is per kilogram in some other wording. */
const PER_KG_UNREAD =
  /^(?:\s+на\s+(?:[\p{L}\d]+\s+){0,2}?(?:кг|килограмм)|\s*,?\s*(?:из|в)\s+расчете\s+на|\s*\/\s*м(?![\p{L}\d²]))/u;
const PER_M2 =
  /^(?:\s*\/\s*(?:кв\.?\s*м|м\s?[2²])|\s+на\s+(?:(?:1|каждый)\s+)?(?:кв\.?\s*м|квадратн\p{L}*\s+метр\p{L}*|м\s?[2²])(?:\s+(?:поверхности\s+(?:Вашего\s+)?тела))?)/u;
const TIME_SUFFIX =
  /^(?:\s*\/\s*(?<t>сут\p{L}*|день|дн|ч(?![\p{L}\d])|час\p{L}*|мин\p{L}*)|\s+(?:в|за)\s+(?<t2>сутки|сут(?![\p{L}\d])|день|час|минуту|мин(?![\p{L}\d])))/u;
const CONCENTRATION =
  /^(?:\s*\/\s*\d*\s*(?:мл|дл|л(?![\p{L}\d])|доз|таблет|капс|г(?![\p{L}\d])|мг|мкг|см)|\s+[\p{L}]+\s*\/\s*(?:мл|л(?![\p{L}\d]))|\s*\+\s*\d)/u;

/** The amounts (number + unit) of a normalized text, with what follows each. */
export function findAmounts(source: string): readonly AmountMatch[] {
  const found: AmountMatch[] = [];
  // «30–50 750 мг» in a table row is a range of clearance and a dose, not 30–50750: keep the groups apart.
  const text = source.replace(/(\d\s*-\s*\d{1,3}) (\d{3})(?![\d])(?<!\d 000)/gu, '$1\u00a0$2');
  for (const match of text.matchAll(AMOUNT)) {
    const groups = match.groups ?? {};
    const unit = unitOfGroups(groups);
    const lo0 = numberValue(groups['n1'] ?? '');
    if (!unit || lo0 === null) continue;
    const second = groups['n2'] === undefined ? null : numberValue(groups['n2']);
    if (groups['n2'] !== undefined && second === null) continue;
    if (second !== null && second <= lo0) continue;
    // «одна доза 750 мг»: «доза» followed by a number is the noun, not a counted dose.
    if (unit.doseWord && /^\s*[-–—:]?\s*\d/u.test(text.slice(match.index + match[0].length)))
      continue;
    let end = match.index + match[0].length;
    let per: 0 | 1 | 2 = 0;
    let daily = false;
    let rate = false;
    const after = text.slice(end);
    const kg = PER_KG.exec(after);
    const m2 = kg ? null : PER_M2.exec(after);
    const basis = kg ?? m2;
    if (basis) {
      per = kg ? 1 : 2;
      end += basis[0].length;
    } else if (CONCENTRATION.test(after) || PER_KG_UNREAD.test(after)) {
      // A concentration, or a per-kilogram dose written in a wording the parser does not read: not a dose.
      rate = true;
    }
    const tail = TIME_SUFFIX.exec(text.slice(end));
    if (tail) {
      const word = tail.groups?.['t'] ?? tail.groups?.['t2'] ?? '';
      if (/^(?:сут|день|дн)/u.test(word)) {
        daily = true;
        end += tail[0].length;
      } else {
        rate = true;
      }
    }
    const factor = unit.factor;
    let lo = lo0 * factor;
    let hi: number | null = second === null ? null : second * factor;
    let start = match.index;
    // «500 тыс. - 1 млн МЕ»: the lower end of the range carries its own multiplier.
    const lead = /(\d+(?:[.,]\d+)?)\s*(тыс|млн)\.?\s*-\s*$/u.exec(
      text.slice(Math.max(0, match.index - 18), match.index),
    );
    if (lead && hi === null) {
      const low = numberValue(lead[1] ?? '');
      const absolute = low === null ? null : low * (lead[2] === 'млн' ? 1_000_000 : 1000);
      if (absolute !== null && absolute < lo) {
        hi = lo;
        lo = absolute;
        start = match.index - lead[0].length;
      }
    }
    const before = text.slice(0, start);
    const opens = (before.match(/\(/gu) ?? []).length;
    const closes = (before.match(/\)/gu) ?? []).length;
    const pre = (groups['pre'] ?? '').trim();
    found.push({
      start,
      end,
      lo,
      hi,
      unit: unit.unit,
      piece: unit.piece,
      per,
      daily,
      rate,
      upTo: pre === 'до' && second === null,
      inParentheses: opens > closes,
      byWord: pre === 'по',
    });
  }
  return mergeRanges(text, found);
}

/** «от 250 мг до 500 мг», «750 мг- 1 г»: a range that writes its unit twice is one amount. */
function mergeRanges(text: string, amounts: readonly AmountMatch[]): readonly AmountMatch[] {
  const merged: AmountMatch[] = [];
  for (const amount of amounts) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.unit === amount.unit &&
      previous.piece === amount.piece &&
      previous.hi === null &&
      amount.hi === null &&
      previous.per === amount.per &&
      amount.lo > previous.lo &&
      !previous.upTo &&
      (amount.upTo
        ? /^\s*$/u.test(text.slice(previous.end, amount.start))
        : /^\s*(?:-|до|или)\s*$/u.test(text.slice(previous.end, amount.start)))
    ) {
      merged[merged.length - 1] = {
        ...previous,
        end: amount.end,
        hi: amount.lo,
        daily: amount.daily,
        rate: previous.rate || amount.rate,
      };
      continue;
    }
    merged.push(amount);
  }
  return merged;
}

export interface FrequencyMatch {
  readonly start: number;
  readonly end: number;
  /** Intakes per `period` days. */
  readonly lo: number;
  readonly hi: number;
  readonly period: number;
  readonly upTo: boolean;
}

const FREQUENCY_NUMBER = `(?<f1>${NUMBER_SOURCE})(?:(?:\\s*-\\s*|\\s+или\\s+)(?<f2>${NUMBER_SOURCE}))?`;
const TIMES_PER = new RegExp(
  `(?<![\\p{L}\\d.,])(?<pre>до\\s+)?${FREQUENCY_NUMBER}\\s*-?\\s*(?:раз(?:а|ов)?|р\\.?)\\s*(?:в|\\/|за)\\s*(?:(?<c>\\d+)\\s*)?(?<per>сутки|сут(?![\\p{L}\\d])|день|дн\\p{L}*|недел\\p{L}*|нед(?![\\p{L}\\d])|месяц\\p{L}*|мес(?![\\p{L}\\d])|час\\p{L}*)`,
  'gu',
);
const TIMES_WORD = new RegExp(
  `(?<![\\p{L}\\d])(?<w>однократно(?=\\s+(?:(?:в|за)\\s+(?:сутки|день|сут(?![\\p{L}\\d]))|перед\\s+сном|утром|вечером|на\\s+ночь))|двукратно|трехкратно|четырехкратно|(?<k>${NUMBER_SOURCE})-?кратн\\p{L}*(?=\\s+(?:прием|введени|в\\s+(?:сутки|день)|ежедневн)))(?![\\p{L}\\d])`,
  'gu',
);
const EVERY_HOURS = new RegExp(
  `(?<![\\p{L}\\d])(?:кажд\\p{L}*|через)\\s+(?:(?<h1>${NUMBER_SOURCE})(?:\\s*-\\s*(?<h2>${NUMBER_SOURCE}))?\\s*(?:-?\\s*х\\s+)?(?<hu>час\\p{L}*|ч(?![\\p{L}\\d])\\.?|недел\\p{L}*|месяц\\p{L}*|дн\\p{L}*)(?!\\s+(?:после|от|с\\s+момента|до|перед|посл))|(?<one>день|сутки|неделю|месяц))`,
  'gu',
);
const IN_INTAKES = new RegExp(
  `(?<![\\p{L}\\d])(?:в|на)\\s+${FREQUENCY_NUMBER}\\s*(?:приема?|приемов|введени\\p{L}*|разовых)(?![\\p{L}])`,
  'gu',
);
const MORNING_EVENING = /(?<![\p{L}])утром\s+и\s+(?:вечером|на\s+ночь)(?![\p{L}])/gu;

/** The frequencies a text states, in reading order. */
export function findFrequencies(text: string): readonly FrequencyMatch[] {
  const found: FrequencyMatch[] = [];
  const taken: [number, number][] = [];
  const overlaps = (start: number, end: number): boolean =>
    taken.some(([from, to]) => start < to && end > from);
  const add = (item: FrequencyMatch): void => {
    taken.push([item.start, item.end]);
    found.push(item);
  };
  for (const match of text.matchAll(TIMES_PER)) {
    const groups = match.groups ?? {};
    const lo = numberValue(groups['f1'] ?? '');
    const hi = groups['f2'] === undefined ? lo : numberValue(groups['f2']);
    if (lo === null || hi === null || hi < lo) continue;
    const per = groups['per'] ?? '';
    const count = groups['c'] === undefined ? 1 : Number(groups['c']);
    let period = 1;
    if (/^недел|^нед/u.test(per)) period = 7 * count;
    else if (/^мес/u.test(per)) period = 30 * count;
    else if (/^(?:дн|день)/u.test(per) && groups['c'] !== undefined) period = count;
    else if (/^час/u.test(per)) {
      // «2 раза в час» is a rate, not a prescription.
      continue;
    }
    add({
      start: match.index,
      end: match.index + match[0].length,
      lo,
      hi,
      period,
      upTo: groups['pre'] !== undefined,
    });
  }
  for (const match of text.matchAll(EVERY_HOURS)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const groups = match.groups ?? {};
    if (groups['one'] !== undefined) {
      const word = groups['one'];
      const period = /^(?:день|сутки)$/u.test(word)
        ? 1
        : /^недел/u.test(word)
          ? 7
          : /^месяц/u.test(word)
            ? 30
            : 0;
      if (period === 0) continue;
      const everyOther = /^через/u.test(match[0]) && period === 1;
      add({ start, end, lo: 1, hi: 1, period: everyOther ? 2 : period, upTo: false });
      continue;
    }
    const first = numberValue(groups['h1'] ?? '');
    const second = groups['h2'] === undefined ? first : numberValue(groups['h2']);
    const unit = groups['hu'] ?? '';
    if (first === null || second === null || first <= 0 || second < first) continue;
    if (/^(?:час|ч)/u.test(unit)) {
      // Every 6–8 hours is 3–4 intakes a day.
      add({ start, end, lo: 24 / second, hi: 24 / first, period: 1, upTo: false });
    } else if (first === second && Number.isInteger(first) && !/^через/u.test(match[0])) {
      // «каждые 2 недели»: one intake per 14 days.
      const days = /^недел/u.test(unit) ? 7 : /^месяц/u.test(unit) ? 30 : 1;
      add({ start, end, lo: 1, hi: 1, period: first * days, upTo: false });
    }
  }
  for (const match of text.matchAll(IN_INTAKES)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const groups = match.groups ?? {};
    const lo = numberValue(groups['f1'] ?? '');
    const hi = groups['f2'] === undefined ? lo : numberValue(groups['f2']);
    if (lo === null || hi === null || hi < lo) continue;
    // «на одно введение», «в 1 прием»: one administration, not a frequency.
    if (lo === 1 && hi === 1) continue;
    add({ start, end, lo, hi, period: 1, upTo: false });
  }
  for (const match of text.matchAll(TIMES_WORD)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const word = match.groups?.['w'] ?? '';
    const count =
      word === 'однократно'
        ? 1
        : word === 'двукратно'
          ? 2
          : word === 'трехкратно'
            ? 3
            : word === 'четырехкратно'
              ? 4
              : numberValue(match.groups?.['k'] ?? '');
    if (count === null || count <= 0) continue;
    add({ start, end, lo: count, hi: count, period: 1, upTo: false });
  }
  for (const match of text.matchAll(MORNING_EVENING)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    add({ start, end, lo: 2, hi: 2, period: 1, upTo: false });
  }
  return found.toSorted((left, right) => left.start - right.start);
}

export interface DurationMatch {
  readonly start: number;
  readonly end: number;
  readonly lo: number;
  readonly hi: number;
  /** «не более 14 дней», «до 7 дней». */
  readonly atMost: boolean;
}

const DAYS_PER_UNIT: Readonly<Record<string, number>> = {
  дн: 1,
  сут: 1,
  недел: 7,
  нед: 7,
  месяц: 30,
  мес: 30,
  год: 365,
};

const DURATION_CUE =
  '(?:в\\s+течение|на\\s+протяжении|на\\s+срок|курс\\p{L}*(?:\\s+(?:лечения|терапии|приема))?|длительност\\p{L}*(?:\\s+(?:курса|лечения|терапии|приема))*|продолжительност\\p{L}*(?:\\s+(?:курса|лечения|терапии|приема))*|(?:лечение|терапия|прием)\\s+продолжа\\p{L}+|(?:составляет|составляют)|не\\s+(?:должн\\p{L}*\\s+)?превышать|не\\s+более|не\\s+дольше|не\\s+свыше)';
const DURATION = new RegExp(
  `(?<![\\p{L}\\d])(?<cue>${DURATION_CUE})[^.;\\d]{0,28}?(?<![\\p{L}\\d.,])(?<d1>${NUMBER_SOURCE})(?:\\s*-\\s*(?<d2>${NUMBER_SOURCE}))?(?:\\s*-?\\s*(?:х|ти|ми|и))?\\s*(?<u>дн\\p{L}*|сут\\p{L}*|недел\\p{L}*|нед(?![\\p{L}\\d])\\.?|месяц\\p{L}*|мес(?![\\p{L}\\d])\\.?|год(?:а|ов)?(?![\\p{L}\\d]))`,
  'gu',
);

/** Lengths of treatment a text states. */
export function findDurations(text: string): readonly DurationMatch[] {
  const found: DurationMatch[] = [];
  for (const match of text.matchAll(DURATION)) {
    const groups = match.groups ?? {};
    const first = numberValue(groups['d1'] ?? '');
    const second = groups['d2'] === undefined ? first : numberValue(groups['d2']);
    const unitText = groups['u'] ?? '';
    const key = Object.keys(DAYS_PER_UNIT).find((prefix) => unitText.startsWith(prefix));
    if (first === null || second === null || key === undefined || second < first) continue;
    const factor = DAYS_PER_UNIT[key] ?? 1;
    const cue = groups['cue'] ?? '';
    // «в течение первых 3 недель курса» is a stage of the course, not its length.
    if (
      /(?:^|\s)перв\p{L}*(?:\s|$)/u.test(
        match[0].slice(cue.length, match[0].indexOf(groups['d1'] ?? '', cue.length)),
      )
    ) {
      continue;
    }
    const bare = cue === 'составляет' || cue === 'составляют';
    // «составляет 5 дней» is a duration only next to a treatment word.
    if (
      bare &&
      !/(?:лечен|терап|курс|прием|применени|назнач)/u.test(
        text.slice(Math.max(0, match.index - 60), match.index),
      )
    )
      continue;
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      lo: first * factor,
      hi: second * factor,
      atMost:
        /максимальн\p{L}*\s*$/u.test(text.slice(Math.max(0, match.index - 20), match.index)) ||
        /^(?:не\s+(?:должн\p{L}*\s+)?превышать|не\s+более|не\s+дольше|не\s+свыше)$/u.test(
          cue.trim(),
        ) ||
        /(?:^|\s)не\s+(?:должн\p{L}*\s+)?(?:превышать|более|дольше|свыше)(?:\s|$)/u.test(
          match[0].slice(cue.length, match[0].indexOf(groups['d1'] ?? '', cue.length)),
        ) ||
        /(?:^|\s)до\s*$/u.test(
          match[0].slice(cue.length, match[0].indexOf(groups['d1'] ?? '', cue.length)),
        ),
    });
  }
  return found;
}
