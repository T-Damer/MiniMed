/**
 * Reads a search query that asks to compare drugs («ибупрофен или парацетамол», «нурофен vs
 * пенталгин», «сравнить X и Y», «чем отличается X от Y», «разница между X и Y») into the names the
 * comparison tool opens with (CMP1). Deterministic and syntactic: a cue phrase, or a plain «или» /
 * «vs» between names, and separators («и», «с», «от», запятая). The names stay as typed; they are
 * looked up with the ordinary drug search, and a query whose parts are not drugs
 * («менингит или энцефалит») finds no card there. Nothing here knows a drug or a symptom.
 */

export interface ComparisonQuery {
  /** The drug names as the doctor typed them, 2 to `MAX_COMPARED_NAMES`. */
  readonly names: readonly string[];
  /** `explicit`: a cue phrase («сравнить», «чем отличается», «разница»); `bare`: only «или» / «vs». */
  readonly cue: 'explicit' | 'bare';
}

export const MAX_COMPARED_NAMES = 4;
const MAX_QUERY_LENGTH = 140;
const MAX_NAME_LENGTH = 48;
const MAX_NAME_WORDS_EXPLICIT = 4;
const MAX_NAME_WORDS_BARE = 3;

const WORD_START = '(?<![а-яёa-z0-9])';
const WORD_END = '(?![а-яёa-z0-9])';

/** Phrases that ask for a comparison; they are not part of a name. */
const CUE = new RegExp(
  `${WORD_START}(?:сравни(?:ть|те)?|сравнени[еяй]|сравнительн\\p{L}*(?:\\s+анализ\\p{L}*)?|сопоставь(?:те)?|сопоставить|сопоставление|отлича(?:ется|ются|ет|ют)|отличи[еяй]|различи[еяй]|разниц[аыуе]|(?:что|какой|какая|какое|какие|кто)\\s+лучше|что\\s+выбрать|чем\\s+лучше|в\\s+ч[её]м\\s+(?:разниц[аыуе]|отличи[еяй]))${WORD_END}`,
  'giu',
);
const BARE_SEPARATOR = /\s+(?:или|vs\.?|versus)\s+|\s+(?:или|vs\.?|versus)$/giu;
const SEPARATOR = /\s*[,;/+]\s*|\s+(?:или|vs\.?|versus|и|с|со|от|плюс)\s+/giu;
/** Words around a name that frame the question. */
const FRAME_WORDS = new Set([
  'чем',
  'чём',
  'в',
  'во',
  'между',
  'от',
  'и',
  'с',
  'со',
  'или',
  'что',
  'как',
  'они',
  'оба',
  'обоих',
  'лучше',
  'выбрать',
  'для',
  'при',
  'препарат',
  'препараты',
  'препаратов',
  'лекарство',
  'лекарства',
  'средство',
  'средства',
  'их',
  'ли',
  'есть',
  'да',
  'же',
  'по',
  'на',
  'к',
  'ко',
  'это',
  'эти',
  'этих',
  'свойствам',
  'параметрам',
  'таблицей',
  'таблица',
]);

function cleanName(value: string): string {
  return value
    .replace(/[«»"“”„()[\]?!:]/gu, ' ')
    .replace(/^[\s.:–—-]+|[\s.:–—-]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripFrameWords(value: string): string {
  const words = value.split(' ').filter((word) => word !== '');
  const isFrame = (word: string | undefined): boolean =>
    word !== undefined && FRAME_WORDS.has(word.toLocaleLowerCase('ru-RU'));
  while (words.length > 0 && isFrame(words[0])) words.shift();
  while (words.length > 0 && isFrame(words[words.length - 1])) words.pop();
  return words.join(' ');
}

function uniqueNames(parts: readonly string[], maxWords: number): readonly string[] | null {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of parts) {
    const name = stripFrameWords(cleanName(part));
    if (name === '') continue;
    const words = name.split(' ');
    if (
      name.length < 2 ||
      name.length > MAX_NAME_LENGTH ||
      words.length > maxWords ||
      !/[a-zа-яё]{2}/iu.test(name)
    ) {
      return null;
    }
    const key = name.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.length >= 2 && names.length <= MAX_COMPARED_NAMES ? names : null;
}

export function parseComparisonQuery(raw: string): ComparisonQuery | null {
  const text = raw.replace(/\s+/gu, ' ').trim();
  if (text.length < 5 || text.length > MAX_QUERY_LENGTH) return null;

  if (new RegExp(CUE.source, 'iu').test(text)) {
    const names = uniqueNames(text.replace(CUE, ' ').split(SEPARATOR), MAX_NAME_WORDS_EXPLICIT);
    return names ? { names, cue: 'explicit' } : null;
  }

  if (new RegExp(BARE_SEPARATOR.source, 'iu').test(text)) {
    const names = uniqueNames(text.split(BARE_SEPARATOR), MAX_NAME_WORDS_BARE);
    return names ? { names, cue: 'bare' } : null;
  }
  return null;
}
