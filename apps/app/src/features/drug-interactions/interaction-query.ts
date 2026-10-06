/**
 * Reads a search query that asks about drugs taken together («варфарин взаимодействие с
 * ибупрофеном, аспирином», «совместимость X и Y», «нурофен и алкоголь») into the names the
 * interaction tool opens with (INT1). Deterministic and syntactic: a cue word («взаимодействие»,
 * «совместимость», …) plus separators («с», «и», «+», запятая). The names stay as typed; the tool
 * looks each of them up with the ordinary drug search. A query that does not match returns null
 * and the ordinary search runs unchanged.
 */

export interface InteractionQuery {
  /** The drug names as the doctor typed them, at most `MAX_QUERY_NAMES`. */
  readonly names: readonly string[];
}

export const MAX_QUERY_NAMES = 10;
const MAX_QUERY_LENGTH = 200;
const MAX_NAME_LENGTH = 60;

/** Word starts that say «these drugs are asked about together». */
const CUE_WORDS =
  '(?<![а-яё])(?:взаимодейств[а-яё]*|совместим[а-яё]*|совместн[а-яё]*|сочетани[а-яё]*|сочетаем[а-яё]*)';
const CUE = new RegExp(CUE_WORDS, 'giu');
const HAS_CUE = new RegExp(CUE_WORDS, 'iu');
/** Words that frame a question about interactions and are not drug names. */
const FRAME_WORDS = new Set([
  'между',
  'лекарственное',
  'лекарственные',
  'лекарственных',
  'лекарственный',
  'препаратов',
  'препараты',
  'препарата',
  'лекарств',
  'лекарства',
  'средств',
  'применение',
  'применения',
  'прием',
  'приём',
  'приема',
  'приёма',
  'назначение',
  'при',
  'и',
  'с',
  'со',
  'ли',
  'можно',
  'есть',
  'у',
  'по',
  'для',
  'также',
]);
const SEPARATOR = /\s*(?:,|;|\+|\/)\s*|\s+(?:и|с|со|плюс|или|вместе\s+с)\s+/giu;
/** Alcohol is a substance the instructions name; it needs no cue («нурофен и алкоголь»). */
const ALCOHOL = '(?:алкогол[а-яё]*|этанол[а-яё]*|спиртн[а-яё]+(?:\\s+напитк[а-яё]*)?)';
const ALCOHOL_QUERY = new RegExp(
  `^(?:(?<drug>.+?)\\s+(?:и|с|со|\\+)\\s+${ALCOHOL}|${ALCOHOL}\\s+(?:и|с|со|\\+)\\s+(?<other>.+?))$`,
  'iu',
);
export const ALCOHOL_QUERY_NAME = 'алкоголь';

function cleanName(value: string): string {
  return value
    .replace(/[«»"“”„()[\]]/gu, ' ')
    .replace(/^[\s.:–—-]+|[\s.:–—-]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isNameLike(value: string): boolean {
  if (value.length < 2 || value.length > MAX_NAME_LENGTH) return false;
  if (!/[a-zа-яё]{2}/iu.test(value)) return false;
  return !FRAME_WORDS.has(value.toLocaleLowerCase('ru-RU'));
}

/** A leading or trailing frame word is not part of a name: «между варфарином» → «варфарином». */
function stripFrameWords(value: string): string {
  const words = value.split(' ');
  while (words.length > 0 && FRAME_WORDS.has((words[0] ?? '').toLocaleLowerCase('ru-RU'))) {
    words.shift();
  }
  while (
    words.length > 0 &&
    FRAME_WORDS.has((words[words.length - 1] ?? '').toLocaleLowerCase('ru-RU'))
  ) {
    words.pop();
  }
  return words.join(' ');
}

function uniqueNames(candidates: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of candidates) {
    const cleaned = stripFrameWords(cleanName(candidate));
    const key = cleaned.toLocaleLowerCase('ru-RU');
    if (!isNameLike(cleaned) || seen.has(key)) continue;
    seen.add(key);
    names.push(cleaned);
    if (names.length >= MAX_QUERY_NAMES) break;
  }
  return names;
}

export function parseInteractionQuery(raw: string): InteractionQuery | null {
  const text = raw.replace(/\s+/gu, ' ').trim();
  if (text.length === 0 || text.length > MAX_QUERY_LENGTH) return null;

  if (HAS_CUE.test(text)) {
    const names = uniqueNames(text.replace(CUE, ' ').split(SEPARATOR));
    return names.length > 0 ? { names } : null;
  }

  const alcohol = ALCOHOL_QUERY.exec(text);
  const other = alcohol?.groups?.['drug'] ?? alcohol?.groups?.['other'];
  if (other) {
    const names = uniqueNames([...other.split(SEPARATOR), ALCOHOL_QUERY_NAME]);
    return names.length >= 2 ? { names } : null;
  }
  return null;
}
