/**
 * Name normalizer shared by the compound-facts loader, the composition splitter and the build
 * tools (`tools/compounds/`). Russian instruction texts give the same substance in different
 * shapes: genitive and inverted («лактозы моногидрат», «кремния диоксид коллоидный»), with
 * grades («повидон К 30», «макрогол-3350»), E-numbers («титана диоксид (Е 171)») and synonyms in
 * brackets. The key is lowercase, ё→е, letters only, grades and numbers dropped, every token cut
 * to a light stem and the tokens sorted, so «магния стеарат» and «стеарат магния» collide on
 * purpose. Keys are only compared against the alias table built from reviewed entries.
 */

const STOP_TOKENS = new Set([
  'и',
  'или',
  'в',
  'во',
  'для',
  'на',
  'с',
  'со',
  'из',
  'по',
  'до',
  'при',
  'тип',
  'типа',
  'марка',
  'марки',
  'сорт',
  'сорта',
  'класс',
  'grade',
  'type',
  'usp',
  'nf',
  'ph',
  'eur',
  'bp',
  'jp',
  'мг',
  'мкг',
  'мл',
  'г',
]);

/** Stems of qualifiers of a solution or a pH adjustment, which are not part of the name. */
const STOP_STEMS = new Set(['раствор', 'рн', 'разведенн', 'концентрированн', 'медицинск', 'окол']);

/** Longest first: the first matching suffix is cut when at least three letters remain. */
const SUFFIXES = [
  'ыми',
  'ими',
  'ого',
  'его',
  'ому',
  'ему',
  'ами',
  'ями',
  'ией',
  'ых',
  'их',
  'ой',
  'ей',
  'ом',
  'ем',
  'ам',
  'ям',
  'ов',
  'ев',
  'ый',
  'ий',
  'ая',
  'яя',
  'ое',
  'ее',
  'ую',
  'юю',
  'ые',
  'ие',
  'ия',
  'ию',
  'ы',
  'и',
  'а',
  'я',
  'у',
  'ю',
  'е',
  'о',
  'ь',
  'й',
] as const;

const E_NUMBER = /\(?(?<![\p{L}\d])[еe]\s?-?\s?\d{3,4}[a-z]?(?:\([ivx]+\))?\)?/giu;
const E_NUMBER_ONLY = /^\s*\(?[еe]\s?-?\s?\d{3,4}[a-z]?(?:\([ivx]+\))?\)?\s*$/iu;
const AMOUNT = /\d+(?:[.,]\d+)?\s*(?:мг|мкг|г|мл|л|%|ед|ме|ммоль|мэкв|мккат)(?![\p{L}])/giu;

export function stemToken(token: string): string {
  for (const suffix of SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

/** E-numbers found in a text, uppercase without spaces: «Е 171» → «E171». */
export function extractENumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(E_NUMBER)) {
    const digits = /\d{3,4}[a-z]?/iu.exec(match[0]);
    if (digits) found.push(`E${digits[0].toUpperCase()}`);
  }
  return found;
}

/** Joins words that a PDF line break cut with a hyphen: «микрокристалличес-\nкая». */
export function joinHyphenBreaks(text: string): string {
  return text.replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, '$1$2');
}

/** Drops «(…)» groups; nested ones too. */
export function stripParentheticals(text: string): string {
  let result = text;
  let previous: string;
  do {
    previous = result;
    result = result.replace(/\([^()]*\)/gu, ' ');
  } while (result !== previous);
  return result.replace(/[()]/gu, ' ');
}

/** The normalized key of a compound name; the empty string when nothing name-like is left. */
export function normalizeCompoundName(text: string): string {
  let value = joinHyphenBreaks(text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е'));
  value = stripParentheticals(value);
  value = value.replace(E_NUMBER, ' ').replace(AMOUNT, ' ');
  // Grades: «к 30», «к-90», «тип а», «85f23987».
  value = value.replace(/(?<![\p{L}])[a-zа-я][\s-]?\d+(?![\p{L}\d])/gu, ' ');
  value = value.replace(/(?<![\p{L}])тип[ауе]?\s+[a-zа-я\d]+(?![\p{L}\d])/gu, ' ');
  const tokens: string[] = [];
  for (const raw of value.split(/[^\p{L}\d]+/u)) {
    if (!raw || /\d/u.test(raw) || STOP_TOKENS.has(raw)) continue;
    if (/^[ivx]+$/u.test(raw)) continue;
    if (raw.length < 2) continue;
    const stem = stemToken(raw);
    if (!STOP_STEMS.has(stem)) tokens.push(stem);
  }
  return tokens.sort().join(' ');
}

const HYDRATION_STEMS = new Set([
  'безводн',
  'гидрат',
  'моногидрат',
  'дигидрат',
  'тригидрат',
  'тетрагидрат',
  'пентагидрат',
  'гексагидрат',
  'гептагидрат',
  'октагидрат',
  'декагидрат',
  'додекагидрат',
  'гемигидрат',
  'полугидрат',
  'сесквигидрат',
]);

const SALT_STEMS = new Set([
  'гидрохлорид',
  'дигидрохлорид',
  'гидробромид',
  'бромид',
  'гидросульфат',
  'сульфат',
  'малеат',
  'тартрат',
  'битартрат',
  'фумарат',
  'цитрат',
  'мезилат',
  'безилат',
  'тозилат',
  'ацетат',
  'фосфат',
  'сукцинат',
  'нитрат',
  'лактат',
  'глюконат',
  'натр',
  'кал',
  'кальц',
  'магн',
]);

function withoutStems(key: string, stems: ReadonlySet<string>): string {
  return key
    .split(' ')
    .filter((token) => !stems.has(token))
    .join(' ');
}

/** The key without hydration words: «лактоз моногидрат» and «лактоз безводн» both give «лактоз». */
export function dropHydration(key: string): string {
  return withoutStems(key, HYDRATION_STEMS);
}

/** The key without salt and counter-ion words, for matching an active by its base name. */
export function dropSalt(key: string): string {
  return withoutStems(dropHydration(key), SALT_STEMS);
}

/** The brackets of a name as extra spellings: «гипромеллоза (гидроксипропилметилцеллюлоза)». */
export function parentheticalAlternatives(text: string): string[] {
  const alternatives: string[] = [];
  for (const match of text.matchAll(/\(([^()]*)\)/gu)) {
    const inner = match[1]?.trim();
    if (inner && !E_NUMBER_ONLY.test(inner)) alternatives.push(inner);
  }
  return alternatives;
}
