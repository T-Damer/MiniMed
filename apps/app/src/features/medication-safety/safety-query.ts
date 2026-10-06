/**
 * Reads a search query that asks whether a drug may be used in pregnancy, during breastfeeding or
 * in a child («ибупрофен при беременности», «X разрешён ли во время ГВ», «X ребёнку 3 лет», «с
 * какого возраста X») into a drug name and what is asked about it (SAFE1). Deterministic and
 * syntactic: cue words and number phrases are taken out of the query, the words that frame a
 * question («разрешён ли», «можно», «во время») are dropped and what is left is the name, as typed.
 * The name is then looked up with the ordinary drug search; a query whose rest is not a drug name
 * finds no card. Nothing here knows a drug or a symptom.
 */
import { formatAgeDays, normalizeForLimits, parseTypedAge } from './age-limits';

export type SafetyIntent = 'pregnancy' | 'lactation' | 'age';

/** An age the doctor typed: exact («3 года») or an upper bound («до 5 лет»). */
export interface TypedAge {
  readonly days: number;
  readonly kind: 'exact' | 'upTo';
  /** As the doctor wrote it, for the screen: «3 года». */
  readonly text: string;
}

export interface SafetyQuery {
  /** The drug name as typed, without the question words. */
  readonly name: string;
  readonly intents: readonly SafetyIntent[];
  readonly age: TypedAge | null;
  /** Trimester, when the query names one. */
  readonly trimester: 1 | 2 | 3 | null;
}

const MAX_QUERY_LENGTH = 160;
const MAX_NAME_WORDS = 4;
const START = '(?<![\\p{L}\\d])';
const END = '(?![\\p{L}\\d])';

const LACTATION = new RegExp(
  `${START}(?:гв|(?:при|во\\s+время|в\\s+период)?\\s*грудн\\p{L}*\\s+вскармлив\\p{L}*|(?:при|во\\s+время)\\s+кормлени\\p{L}*(?:\\s+грудью)?|кормлени\\p{L}*\\s+грудью|корм\\p{L}*\\s+грудью|кормящ\\p{L}*(?:\\s+(?:маме|мамам|мам\\p{L}*|женщин\\p{L}*|мать|матер\\p{L}*))?|лактаци\\p{L}*)${END}`,
  'gu',
);
const PREGNANCY = new RegExp(
  `${START}(?:(?:при|во\\s+время|в\\s+период)\\s+)?(?:беремен\\p{L}*|(?:в\\s+)?(?:положени\\p{L}*\\s+)?триместр\\p{L}*)${END}`,
  'gu',
);
const TRIMESTER = new RegExp(
  `${START}(?:(?<a>[123]|i{1,3}|перв\\p{L}*|втор\\p{L}*|трет\\p{L}*)(?:-?(?:й|го|м|ом))?\\s+триместр\\p{L}*|триместр\\p{L}*\\s+(?<b>[123]|i{1,3}))${END}`,
  'u',
);
const TRIMESTER_ALL = new RegExp(TRIMESTER.source, 'gu');
const CHILD_WORDS = new RegExp(
  `${START}(?:(?:для\\s+)?ребенк\\p{L}*|ребят\\p{L}*|детям|(?:для\\s+)?дет(?:ей|и|ьми)|(?:для\\s+)?малыш\\p{L}*|новорожден\\p{L}*|грудничк\\p{L}*|младенц\\p{L}*|подростк\\p{L}*|школьник\\p{L}*|дошкольник\\p{L}*)${END}`,
  'gu',
);
const AGE_PHRASES = new RegExp(
  `${START}(?:с\\s+какого\\s+(?:возраст\\p{L}*|года|лет|месяца)|с\\s+скольки\\s+(?:лет|месяцев)|до\\s+скольки\\s+лет|с\\s+какого\\s+возраст\\p{L}*\\s+можно|возрастн\\p{L}*\\s+ограничени\\p{L}*|возраст\\p{L}*\\s+ограничени\\p{L}*|(?:в\\s+)?(?:каком|какого)\\s+возраст\\p{L}*|возраст)${END}`,
  'gu',
);
const WORD_NUMBER =
  'одн\\p{L}*|двух|два|две|трех|три|четырех|четыре|пяти|пять|шести|шесть|семи|семь|восьми|восемь|девяти|девять|десяти|десять|двенадцати|двенадцать|тринадцати|четырнадцати|пятнадцати|шестнадцати|семнадцати|восемнадцати|полутора|полугода|полгода';
const AGE_AMOUNT = new RegExp(
  `${START}(?:(?<up>до|младше|моложе|менее)\\s+)?(?<n>\\d+(?:[.,]\\d+)?|${WORD_NUMBER})(?:-?(?:ти|х|ми))?\\s*(?<unit>лет|года|год|г|месяц\\p{L}*|мес|недел\\p{L}*|нед)${END}`,
  'u',
);
/** Words that frame the question and are not part of a drug name. */
const FRAME_WORDS = new Set([
  'разрешен',
  'разрешена',
  'разрешено',
  'разрешены',
  'ли',
  'можно',
  'нельзя',
  'нужно',
  'надо',
  'допустим',
  'допустимо',
  'допустима',
  'безопасен',
  'безопасно',
  'безопасна',
  'безопасны',
  'противопоказан',
  'противопоказано',
  'показан',
  'во',
  'в',
  'во время',
  'время',
  'период',
  'при',
  'на',
  'у',
  'для',
  'как',
  'с',
  'со',
  'до',
  'от',
  'из',
  'по',
  'к',
  'ко',
  'и',
  'а',
  'или',
  'же',
  'принимать',
  'принять',
  'прием',
  'приема',
  'пить',
  'выпить',
  'давать',
  'дать',
  'дают',
  'применять',
  'применение',
  'применения',
  'использовать',
  'использование',
  'назначать',
  'назначают',
  'назначение',
  'колоть',
  'вводить',
  'какого',
  'какой',
  'какие',
  'ограничения',
  'ограничение',
  'возрастные',
  'возрастное',
  'мне',
  'вам',
  'маме',
  'мама',
  'мамам',
  'мамы',
  'женщине',
  'женщинам',
  'женщины',
  'пациентке',
  'пациенткам',
  'пациентам',
  'пациенту',
  'лекарство',
  'препарат',
  'препараты',
  'средство',
  'такой',
  'такое',
  'ли',
  'что',
  'это',
  'есть',
  'будет',
  'лет',
  'года',
  'год',
  'месяцев',
  'месяца',
  'мес',
  'возраст',
  'возраста',
]);

function trimesterOf(text: string): 1 | 2 | 3 | null {
  const match = TRIMESTER.exec(text);
  const value = (match?.groups?.['a'] ?? match?.groups?.['b'] ?? '').toLowerCase();
  if (value === '') return null;
  if (value === '1' || value === 'i' || value.startsWith('перв')) return 1;
  if (value === '2' || value === 'ii' || value.startsWith('втор')) return 2;
  if (value === '3' || value === 'iii' || value.startsWith('трет')) return 3;
  return null;
}

function replaceSpans(text: string, patterns: readonly RegExp[]): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, (match) => ' '.repeat(match.length));
  }
  return result;
}

function typedAge(normalized: string): TypedAge | null {
  const match = AGE_AMOUNT.exec(normalized);
  if (!match?.groups) return null;
  const unit = match.groups['unit'] ?? '';
  const amountText = `${match.groups['n'] ?? ''} ${unit === 'г' ? 'лет' : unit}`;
  const days = parseTypedAge(amountText);
  if (days === null) return null;
  return {
    days,
    kind: match.groups['up'] ? 'upTo' : 'exact',
    text: formatAgeDays(days),
  };
}

/**
 * The question in a query, or null when the query asks nothing about pregnancy, lactation or a
 * child's age, or when nothing that could be a drug name is left.
 */
export function parseSafetyQuery(raw: string): SafetyQuery | null {
  const original = raw.replace(/\s+/gu, ' ').trim();
  if (original.length < 4 || original.length > MAX_QUERY_LENGTH) return null;
  const normalized = normalizeForLimits(original);

  const intents: SafetyIntent[] = [];
  const hasLactation = new RegExp(LACTATION.source, 'u').test(normalized);
  const hasPregnancy = new RegExp(PREGNANCY.source, 'u').test(normalized);
  const age = typedAge(normalized);
  const childWord = new RegExp(CHILD_WORDS.source, 'u').test(normalized);
  const agePhrase = new RegExp(AGE_PHRASES.source, 'u').test(normalized);
  // A bare number of years is not a question about age: «диабет 2 года». A child word, «возраст»
  // or «с какого возраста» makes it one.
  const asksAge = childWord || agePhrase;
  if (hasPregnancy) intents.push('pregnancy');
  if (hasLactation) intents.push('lactation');
  if (asksAge) intents.push('age');
  if (intents.length === 0) return null;

  let rest = replaceSpans(normalized, [
    TRIMESTER_ALL,
    PREGNANCY,
    LACTATION,
    CHILD_WORDS,
    AGE_PHRASES,
  ]);
  if (age) {
    rest = rest.replace(new RegExp(AGE_AMOUNT.source, 'u'), (match) => ' '.repeat(match.length));
  }
  // `rest` has the length of `original`: read the name from the original spelling.
  const words: string[] = [];
  const pattern = /[\p{L}\p{N}][\p{L}\p{N}.+-]*/gu;
  for (const match of rest.matchAll(pattern)) {
    const word = match[0].replace(/^[.+-]+|[.+-]+$/gu, '');
    if (word.length === 0 || FRAME_WORDS.has(word)) continue;
    if (/^\d+$/u.test(word)) continue;
    words.push(
      original.slice(match.index, match.index + match[0].length).replace(/^[.+-]+|[.+-]+$/gu, ''),
    );
  }
  const name = words.join(' ').trim();
  if (words.length === 0 || words.length > MAX_NAME_WORDS || !/[\p{L}]{2}/u.test(name)) return null;
  return {
    name,
    intents,
    age: asksAge ? age : null,
    trimester: hasPregnancy ? trimesterOf(normalized) : null,
  };
}
