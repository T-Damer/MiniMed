/**
 * Age and weight limits named in a sentence of an official instruction (SAFE1). Deterministic and
 * syntactic: an operator word («до», «младше», «с», «старше», «не достигших»), a number written in
 * digits or words and a unit («лет», «месяцев», «кг»), inside a sentence that is about age («детский
 * возраст», «у детей», «в возрасте»). It reads offsets, never rewrites text: a limit is the exact
 * range of the sentence it was found in. Nothing here decides whether a child may take a drug; the
 * limits are only what the instruction says, in the instruction's words.
 */

export type LimitOperator = 'below' | 'from' | 'range';
export type LimitDimension = 'age' | 'weight';

/** Days in a year, as the instruction texts count: 3 years and 36 months are the same age. */
const DAYS_PER_YEAR = 365.25;
const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
/** Limits above this age are about adults and the elderly («старше 65 лет»), not about children. */
export const CHILD_AGE_LIMIT_DAYS = Math.round(18 * DAYS_PER_YEAR);
/** Weight is kept in tenths of a kilogram. */
export const WEIGHT_SCALE = 10;
const MAX_CHILD_WEIGHT_KG = 100;

export interface AmountLimit {
  readonly dimension: LimitDimension;
  readonly operator: LimitOperator;
  /** Lower bound (`from`, `range`), days for age and tenths of kg for weight. */
  readonly lower: number | null;
  /** Upper bound (`below`, `range`). */
  readonly upper: number | null;
  /** Range of the matched words in the text that was scanned. */
  readonly start: number;
  readonly end: number;
}

export type AgeCategory = 'newborn' | 'premature' | 'infant' | 'children';
export const AGE_CATEGORIES: readonly AgeCategory[] = [
  'newborn',
  'premature',
  'infant',
  'children',
];

export interface CategoryLimit {
  readonly category: AgeCategory;
  readonly start: number;
  readonly end: number;
}

/** Length-preserving normal form: lower case, «ё» as «е», every dash as «-», every space as «␠». */
export function normalizeForLimits(text: string): string {
  let result = '';
  for (const character of text) {
    if (/\s/u.test(character)) {
      result += ' '.repeat(character.length);
      continue;
    }
    if (/[‐‑‒–—−]/u.test(character)) {
      result += '-';
      continue;
    }
    const lower = character.toLowerCase();
    result += lower.length === character.length ? lower.replace('ё', 'е') : character;
  }
  return result;
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  одного: 1,
  одному: 1,
  один: 1,
  одна: 1,
  одной: 1,
  двух: 2,
  два: 2,
  две: 2,
  трех: 3,
  три: 3,
  четырех: 4,
  четыре: 4,
  пяти: 5,
  пять: 5,
  шести: 6,
  шесть: 6,
  семи: 7,
  семь: 7,
  восьми: 8,
  восемь: 8,
  девяти: 9,
  девять: 9,
  десяти: 10,
  десять: 10,
  одиннадцати: 11,
  одиннадцать: 11,
  двенадцати: 12,
  двенадцать: 12,
  тринадцати: 13,
  тринадцать: 13,
  четырнадцати: 14,
  четырнадцать: 14,
  пятнадцати: 15,
  пятнадцать: 15,
  шестнадцати: 16,
  шестнадцать: 16,
  семнадцати: 17,
  семнадцать: 17,
  восемнадцати: 18,
  восемнадцать: 18,
  двадцати: 20,
  двадцать: 20,
  тридцати: 30,
  тридцать: 30,
  сорока: 40,
  сорок: 40,
  полугода: 0.5,
  полгода: 0.5,
  полутора: 1.5,
};

const NOT_LETTER_BEFORE = '(?<![\\p{L}\\d])';
const NOT_LETTER_AFTER = '(?![\\p{L}\\d])';
const WORD_NUMBER_SOURCE = Object.keys(WORD_NUMBERS)
  .toSorted((left, right) => right.length - left.length)
  .join('|');
/** `3`, `0,5`, `трех`, `3-х`, `12-ти`: a number, with the inflection suffix some texts add. */
const NUMBER_SOURCE = `(?:\\d+(?:[.,]\\d+)?|${WORD_NUMBER_SOURCE})(?:-(?:ти|х|ми|и))?`;

type UnitKind = 'year' | 'month' | 'week' | 'day' | 'kg';

const UNIT_PATTERNS: readonly { readonly kind: UnitKind; readonly source: string }[] = [
  { kind: 'year', source: '-?летн\\p{L}*|лет|года|год|годам|годов|годах' },
  { kind: 'month', source: 'месяц\\p{L}*|мес(?![\\p{L}\\d])\\.?' },
  { kind: 'week', source: 'недел\\p{L}*|нед(?![\\p{L}\\d])\\.?' },
  { kind: 'day', source: 'дн(?:ей|я|ям|и)|день|суток|сутки|сут(?![\\p{L}\\d])\\.?' },
  { kind: 'kg', source: 'кг(?![/\\p{L}\\d])' },
];
const UNIT_SOURCE = UNIT_PATTERNS.map((unit) => `(?<${unit.kind}>${unit.source})`).join('|');
const AMOUNT_SOURCE = `(?<n>${NUMBER_SOURCE})\\s*(?:${UNIT_SOURCE})${NOT_LETTER_AFTER}`;

const BELOW_OPERATORS = [
  'до\\s+достижения(?:\\s+возраста)?',
  'не\\s+достигш\\p{L}*(?:\\s+возраста)?',
  'не\\s+достигл\\p{L}*(?:\\s+возраста)?',
  'не\\s+старше',
  'до',
  'менее',
  'меньше',
  'младше',
  'моложе',
  'ниже',
  '<',
];
const FROM_OPERATORS = [
  'не\\s+менее',
  'не\\s+младше',
  'не\\s+моложе',
  'старше',
  'свыше',
  'более',
  'выше',
  'после',
  'от',
  'с',
  '>',
  '≥',
];
const OPERATOR_SOURCE = [...BELOW_OPERATORS, ...FROM_OPERATORS]
  .toSorted((left, right) => right.length - left.length)
  .join('|');

function parseNumber(source: string): number | null {
  const bare = source.replace(/-(?:ти|х|ми|и)$/u, '');
  const word = WORD_NUMBERS[bare];
  if (word !== undefined) return word;
  const value = Number(bare.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function toBound(value: number, kind: UnitKind): number {
  switch (kind) {
    case 'year':
      return Math.round(value * DAYS_PER_YEAR);
    case 'month':
      return Math.round(value * DAYS_PER_MONTH);
    case 'week':
      return Math.round(value * 7);
    case 'day':
      return Math.round(value);
    case 'kg':
      return Math.round(value * WEIGHT_SCALE);
  }
}

function unitKindOf(groups: Readonly<Record<string, string | undefined>>): UnitKind | null {
  for (const unit of UNIT_PATTERNS) if (groups[unit.kind] !== undefined) return unit.kind;
  return null;
}

function isBelowOperator(operator: string): boolean {
  const squeezed = operator.replace(/\s+/gu, ' ');
  return BELOW_OPERATORS.some((source) =>
    new RegExp(`^(?:${source.replaceAll('\\s+', ' ')})$`, 'u').test(squeezed),
  );
}

/** Words that make a sentence one about age. */
const AGE_CONTEXT =
  /возраст|детск|(?<![\p{L}])дет(?:ей|ям|ьми|ях|и)(?![\p{L}])|ребен|новорожд|подрост|младен|недоношен|педиатр|несовершеннолет|грудн\p{L}*\s+(?:возраст|дет)/u;
/** Words that make a number of months, weeks or days a length of treatment rather than an age. */
const DURATION_CUE =
  /в\s+течение|курс|длительност|продолжительност|продолжа|терапи|лечени|не\s+более|не\s+дольше/u;
const SENTENCE_END = /[.!?]\s+/gu;
const CONTEXT_WINDOW = 110;
const SHORT_UNIT_CONTEXT_WINDOW = 48;

function contextBefore(text: string, position: number, window: number): string {
  let from = Math.max(0, position - window);
  const head = text.slice(from, position);
  let cut = -1;
  for (const match of head.matchAll(SENTENCE_END)) cut = match.index + match[0].length;
  if (cut >= 0) from += cut;
  return text.slice(from, position);
}

/** «гестационный возраст менее 38 недель», «костный возраст»: an age that is not the patient's. */
const OTHER_AGE =
  /(?:гестацион|костн|постконцепт|постнатальн|постменструальн|физиологическ)\p{L}*\s+(?:возраст|срок)\p{L}*\s*$/u;

function hasAgeContext(text: string, position: number, kind: UnitKind): boolean {
  if (OTHER_AGE.test(contextBefore(text, position, 48))) return false;
  if (kind === 'year') return AGE_CONTEXT.test(contextBefore(text, position, CONTEXT_WINDOW));
  const near = contextBefore(text, position, SHORT_UNIT_CONTEXT_WINDOW);
  const context = AGE_CONTEXT.exec(near);
  if (!context) return false;
  // A word of treatment length between the age word and the number makes it a duration; one
  // before it («Дополнительная терапия для детей в возрасте от 1 месяца») does not.
  return !DURATION_CUE.test(near.slice(context.index + context[0].length));
}

/** «снижение массы тела менее 5 кг», «на каждый кг тела свыше 10 кг»: a change or a formula, not a group. */
const NOT_A_WEIGHT_GROUP =
  /снижени|похуден|потер|набор\s+масс|прибавк|кажд\p{L}*\s+кг|на\s+1\s*кг/u;

function hasWeightContext(text: string, position: number): boolean {
  const near = contextBefore(text, position, 60);
  return /масс|вес/u.test(near) && !NOT_A_WEIGHT_GROUP.test(near);
}

function amountOf(
  numberSource: string | undefined,
  kind: UnitKind | null,
): { value: number; kind: UnitKind } | null {
  if (numberSource === undefined || kind === null) return null;
  const value = parseNumber(numberSource);
  return value === null ? null : { value, kind };
}

function overlaps(taken: readonly (readonly [number, number])[], start: number, end: number) {
  return taken.some(([from, to]) => start < to && end > from);
}

const RANGE_WITH_WORDS = new RegExp(
  `${NOT_LETTER_BEFORE}(?:от|с)\\s+(?<n1>${NUMBER_SOURCE})(?:\\s*(?:${UNIT_SOURCE.replaceAll(
    /\(\?<(\w+)>/gu,
    '(?<a$1>',
  )}))?(?:\\s*\\([^)]{1,30}\\))?(?:\\s+и\\s+(?:более|старше))?\\s+до\\s+${AMOUNT_SOURCE}`,
  'gu',
);
const RANGE_WITH_DASH = new RegExp(
  `${NOT_LETTER_BEFORE}(?<n1>\\d+(?:[.,]\\d+)?)\\s*-\\s*${AMOUNT_SOURCE}`,
  'gu',
);
const SINGLE = new RegExp(
  `${NOT_LETTER_BEFORE}(?<op>${OPERATOR_SOURCE})\\s*(?:(?:возраста|возрасте|жизни|массе\\s+тела|массой\\s+тела)\\s+)?${AMOUNT_SOURCE}`,
  'gu',
);
const POSTFIX = new RegExp(
  `${NOT_LETTER_BEFORE}${AMOUNT_SOURCE}\\s+и\\s+(?<post>старше|более|выше|младше|моложе|менее|ниже)${NOT_LETTER_AFTER}`,
  'gu',
);
/** «до года», «с года»: a year without a number. */
const BARE_YEAR = new RegExp(
  `${NOT_LETTER_BEFORE}(?<op>${OPERATOR_SOURCE})\\s+года${NOT_LETTER_AFTER}`,
  'gu',
);
/** The `a`-prefixed unit groups of the range pattern: the unit written after the first number. */
const FIRST_UNIT_KINDS: readonly UnitKind[] = ['year', 'month', 'week', 'day', 'kg'];

function firstUnitKind(groups: Readonly<Record<string, string | undefined>>): UnitKind | null {
  for (const kind of FIRST_UNIT_KINDS) if (groups[`a${kind}`] !== undefined) return kind;
  return null;
}

function limit(
  dimension: LimitDimension,
  operator: LimitOperator,
  lower: number | null,
  upper: number | null,
  start: number,
  end: number,
): AmountLimit {
  return { dimension, operator, lower, upper, start, end };
}

/**
 * The age and weight limits in `text`, in reading order. `text` is a sentence (or any piece of an
 * instruction); offsets refer to `text` itself. Limits above the child range are dropped: «старше 65
 * лет» is about the elderly.
 */
export function extractAmountLimits(text: string): readonly AmountLimit[] {
  const t = normalizeForLimits(text);
  const found: AmountLimit[] = [];
  const taken: [number, number][] = [];
  const add = (item: AmountLimit): void => {
    taken.push([item.start, item.end]);
    found.push(item);
  };
  const accept = (
    dimension: LimitDimension,
    kind: UnitKind,
    position: number,
    operator: string | null,
  ): boolean => {
    if (dimension === 'weight') return hasWeightContext(t, position);
    // «До достижения возраста 1 мес» names the age itself.
    if (operator !== null && /^до\s+достижения/u.test(operator)) return true;
    if (
      operator !== null &&
      /^(?:старше|моложе|младше|не\s+достиг|не\s+старше|до\s+достижения)/u.test(operator)
    ) {
      return kind === 'year' || hasAgeContext(t, position, kind);
    }
    return hasAgeContext(t, position, kind);
  };

  for (const match of t.matchAll(RANGE_WITH_WORDS)) {
    const groups = match.groups ?? {};
    const second = amountOf(groups['n'], unitKindOf(groups));
    const firstNumber = parseNumber(groups['n1'] ?? '');
    const first = firstUnitKind(groups);
    if (!second || firstNumber === null) continue;
    const dimension: LimitDimension = second.kind === 'kg' ? 'weight' : 'age';
    const start = match.index;
    const end = start + match[0].length;
    if (!accept(dimension, second.kind, start, null)) continue;
    add(
      limit(
        dimension,
        'range',
        toBound(firstNumber, first ?? second.kind),
        toBound(second.value, second.kind),
        start,
        end,
      ),
    );
  }
  for (const match of t.matchAll(RANGE_WITH_DASH)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(taken, start, end)) continue;
    const groups = match.groups ?? {};
    const second = amountOf(groups['n'], unitKindOf(groups));
    const firstNumber = parseNumber(groups['n1'] ?? '');
    if (!second || firstNumber === null || firstNumber >= second.value) continue;
    const dimension: LimitDimension = second.kind === 'kg' ? 'weight' : 'age';
    if (!accept(dimension, second.kind, start, null)) continue;
    add(
      limit(
        dimension,
        'range',
        toBound(firstNumber, second.kind),
        toBound(second.value, second.kind),
        start,
        end,
      ),
    );
  }
  for (const match of t.matchAll(SINGLE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(taken, start, end)) continue;
    const groups = match.groups ?? {};
    const amount = amountOf(groups['n'], unitKindOf(groups));
    const operator = groups['op'];
    if (!amount || operator === undefined) continue;
    const dimension: LimitDimension = amount.kind === 'kg' ? 'weight' : 'age';
    if (!accept(dimension, amount.kind, start, operator)) continue;
    const bound = toBound(amount.value, amount.kind);
    add(
      isBelowOperator(operator)
        ? limit(dimension, 'below', null, bound, start, end)
        : limit(dimension, 'from', bound, null, start, end),
    );
  }
  for (const match of t.matchAll(POSTFIX)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(taken, start, end)) continue;
    const groups = match.groups ?? {};
    const amount = amountOf(groups['n'], unitKindOf(groups));
    if (!amount) continue;
    const dimension: LimitDimension = amount.kind === 'kg' ? 'weight' : 'age';
    if (!accept(dimension, amount.kind, start, 'старше')) continue;
    const bound = toBound(amount.value, amount.kind);
    const below = /^(?:младше|моложе|менее|ниже)/u.test(groups['post'] ?? '');
    add(
      below
        ? limit(dimension, 'below', null, bound, start, end)
        : limit(dimension, 'from', bound, null, start, end),
    );
  }
  for (const match of t.matchAll(BARE_YEAR)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(taken, start, end)) continue;
    if (!hasAgeContext(t, start, 'year')) continue;
    const operator = match.groups?.['op'] ?? '';
    const bound = toBound(1, 'year');
    add(
      isBelowOperator(operator)
        ? limit('age', 'below', null, bound, start, end)
        : limit('age', 'from', bound, null, start, end),
    );
  }

  return found
    .filter((item) => {
      if (item.dimension === 'weight') {
        const bound = item.upper ?? item.lower ?? 0;
        return bound <= MAX_CHILD_WEIGHT_KG * WEIGHT_SCALE;
      }
      const smallest = item.lower ?? item.upper ?? 0;
      // «до 65 лет» / «старше 65 лет»: not about children.
      return smallest <= CHILD_AGE_LIMIT_DAYS;
    })
    .toSorted((left, right) => left.start - right.start);
}

const NEGATIVE_CUE =
  /противопоказ|не\s+применя|не\s+рекоменд|не\s+назнач|не\s+установлен|не\s+изуч|не\s+проводил|не\s+проводи|отсутству|не\s+следует\s+(?:применя|назнач|давать|использ)|нельзя|запрещ|не\s+показан|не\s+допуска|только\s+по\s+назначению|с\s+осторожностью|не\s+использ|не\s+доказан|не\s+определен|не\s+оценива|нет\s+(?:данных|опыта)/u;
const CATEGORY_PATTERNS: readonly { readonly category: AgeCategory; readonly source: string }[] = [
  { category: 'newborn', source: 'новорожд\\p{L}*' },
  { category: 'premature', source: 'недоношен\\p{L}*' },
  {
    category: 'infant',
    source:
      'грудн\\p{L}*\\s+(?:возраст\\p{L}*|дет\\p{L}*)|дет\\p{L}*\\s+грудного\\s+возраста|грудничк\\p{L}*|младенц\\p{L}*|дет\\p{L}*\\s+первого\\s+года',
  },
  {
    category: 'children',
    source:
      'детск\\p{L}*\\s+возраст\\p{L}*|(?<![\\p{L}])дет(?:ей|ям|ьми|ях|и)(?![\\p{L}])|педиатрическ\\p{L}*\\s+(?:пациент|популяц)\\p{L}*',
  },
];

/**
 * Age groups named without a number («новорожденным», «детский возраст», «недоношенным детям»),
 * kept only when the sentence says in the same breath that the drug is not used, not recommended,
 * not studied or restricted for them. A sentence that already holds a numeric age limit has none.
 */
export function extractCategoryLimits(text: string): readonly CategoryLimit[] {
  const t = normalizeForLimits(text);
  if (!NEGATIVE_CUE.test(t)) return [];
  const found: CategoryLimit[] = [];
  const taken: [number, number][] = [];
  for (const { category, source } of CATEGORY_PATTERNS) {
    for (const match of t.matchAll(new RegExp(`${NOT_LETTER_BEFORE}(?:${source})`, 'gu'))) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(taken, start, end)) continue;
      taken.push([start, end]);
      found.push({ category, start, end });
    }
  }
  return found.toSorted((left, right) => left.start - right.start);
}

/* ------------------------------------------------------------------------------------------ */
/* Wording                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function pluralRu(count: number, one: string, few: string, many: string): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return many;
  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function numberText(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 10) / 10).replace('.', ',');
}

export type GrammaticalCase = 'nominative' | 'genitive';

function unitWord(
  count: number,
  forms: readonly [
    one: string,
    few: string,
    many: string,
    genitiveOne: string,
    genitiveMany: string,
  ],
  grammaticalCase: GrammaticalCase,
): string {
  if (grammaticalCase === 'nominative') return pluralRu(count, forms[0], forms[1], forms[2]);
  const tail = count % 100;
  return count % 10 === 1 && tail !== 11 ? forms[3] : forms[4];
}

/**
 * An age in days as the instruction would write it: «3 года», «6 месяцев», «2 недели»; with
 * `genitive` the form after «до», «с», «от»: «12 лет», «1 года», «6 месяцев».
 */
export function formatAgeDays(
  days: number,
  grammaticalCase: GrammaticalCase = 'nominative',
): string {
  if (days === 0) return grammaticalCase === 'genitive' ? 'рождения' : '0 дней';
  const years = days / DAYS_PER_YEAR;
  if (days >= Math.round(DAYS_PER_YEAR) - 1 && Math.abs(years - Math.round(years)) < 0.03) {
    const count = Math.round(years);
    return `${count} ${unitWord(count, ['год', 'года', 'лет', 'года', 'лет'], grammaticalCase)}`;
  }
  if (days % 7 === 0 && days >= 7 && days <= 56) {
    const count = days / 7;
    return `${count} ${unitWord(count, ['неделя', 'недели', 'недель', 'недели', 'недель'], grammaticalCase)}`;
  }
  const months = days / DAYS_PER_MONTH;
  if (days >= 28 && Math.abs(months - Math.round(months)) < 0.1) {
    const count = Math.round(months);
    return `${count} ${unitWord(count, ['месяц', 'месяца', 'месяцев', 'месяца', 'месяцев'], grammaticalCase)}`;
  }
  return `${days} ${unitWord(days, ['день', 'дня', 'дней', 'дня', 'дней'], grammaticalCase)}`;
}

export function formatWeightTenths(tenths: number): string {
  return `${numberText(tenths / WEIGHT_SCALE)} кг`;
}

/** Age typed by the doctor: «3 года», «6 мес»; null when the text is not an age. */
export function parseTypedAge(text: string): number | null {
  const t = normalizeForLimits(text).trim();
  const match = new RegExp(`^(?<n>${NUMBER_SOURCE})\\s*(?:${UNIT_SOURCE})$`, 'u').exec(t);
  const amount = amountOf(match?.groups?.['n'], match?.groups ? unitKindOf(match.groups) : null);
  if (!amount || amount.kind === 'kg') return null;
  return toBound(amount.value, amount.kind);
}

/**
 * Whether the words at `[start, end)` are an item of a list («…; беременность; детский возраст;
 * пожилой возраст.»): flanked by list separators or the ends of the text.
 */
export function isListItem(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).trimEnd().slice(-1);
  const after = text.slice(end).trimStart().charAt(0);
  const opens = before === '' || /[;,•\-–—:·*(]/u.test(before);
  const closes = after === '' || /[;,.)]/u.test(after);
  return opens && closes;
}
