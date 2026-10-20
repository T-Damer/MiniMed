// Which typed words of a query name its subject and which only name a form, a strength, the
// audience or the kind of answer wanted («таблетки», «ребёнка», «лекарство», «инструкция»).
// Lookup ranking, the lookup title branch and group filtering share these definitions.
import { lightStemRussian, normalizeSurfaceText, tokenize } from './normalize';

const stemToken = lightStemRussian;

export const GENERIC_QUERY_TERMS = new Set([
  'какой',
  'какая',
  'какие',
  'который',
  'пациент',
  'ребенок',
  'ребёнок',
  'взрослый',
  'нужно',
  'можно',
  'приказ',
  'закон',
]);

export const TITLE_FORM_STEMS = new Set([
  'таблетк',
  'порошк',
  'раствор',
  'капсул',
  'сироп',
  'суппозитор',
  'маз',
  'гел',
  'крем',
  'капл',
  'спре',
  'инъекц',
  'приготовлен',
  'прием',
  'внутрь',
  'назальн',
  'наружн',
  'глазн',
  'ректальн',
  'лиофилизат',
  'суспенз',
  'гранул',
  'пастил',
  'шипуч',
  'пленк',
  'покрыт',
  'оболочк',
  'действующ',
  'веществ',
  'доз',
  'внутримышечн',
  'внутривенн',
  'мг',
  'мл',
  'шт',
]);

export function isFormOrStrengthToken(token: string): boolean {
  if (/^\d/.test(token) || token.length <= 2) return true;
  const stem = stemToken(token);
  if (TITLE_FORM_STEMS.has(stem)) return true;
  for (const formStem of TITLE_FORM_STEMS) {
    if (stem.startsWith(formStem) || formStem.startsWith(stem)) return true;
  }
  return false;
}

export const PATIENT_CONTEXT_STEMS = new Set(
  [
    'ребенок',
    'ребенк',
    'дети',
    'детский',
    'взрослый',
    'мужчина',
    'женщина',
    'мужской',
    'женский',
  ].map(stemToken),
);

export const TITLE_CONTEXT_STEMS = new Set(
  [
    ...[...GENERIC_QUERY_TERMS],
    ...PATIENT_CONTEXT_STEMS,
    'вес',
    'год',
    'лет',
    'первый',
    'второй',
    'третий',
    'заболевание',
    'инфекция',
    'мочевой',
    'мочевых',
    'путь',
    'путей',
  ].map(stemToken),
);

export function isTitleQueryTerm(term: string): boolean {
  return term.length >= 3 && !TITLE_CONTEXT_STEMS.has(stemToken(term));
}

/**
 * Words that name the kind of answer wanted, not its subject: «лекарство от кашля», «инструкция»,
 * «регистрационная запись». A document that shares only these with a query is not an answer.
 */
export const LOOKUP_META_STEMS = [
  'лекарств',
  'препарат',
  'средств',
  'лечен',
  'терапи',
  'инструкц',
  'регистрац',
  'запис',
  'удостовер',
  'показан',
  'противопоказ',
  'побочн',
  'дозировк',
  'применен',
  'информац',
  'описан',
  'справк',
  'официальн',
  'аннотац',
];

/** A typed word that only names the kind of answer wanted («инструкция», «официальная»). */
export function isLookupMetaToken(token: string): boolean {
  const stem = stemToken(token);
  return LOOKUP_META_STEMS.some((meta) => stem.startsWith(meta));
}

/**
 * Words that only dress up the kind of answer («официальная инструкция»): they say nothing about the
 * subject and, being common in leaflet text, would pull in documents that merely mention them.
 */
const LOOKUP_DECORATIVE_STEMS = ['официальн'];

/**
 * The query without its decorative qualifier words, when a subject word remains
 * («Ибупрофен: официальная инструкция» → «Ибупрофен: инструкция»); otherwise unchanged.
 */
export function withoutLookupDecorations(query: string): string {
  const words = query.split(/\s+/u);
  const kept = words.filter((word) => {
    const stem = stemToken(normalizeSurfaceText(word).replace(/[^0-9a-zа-я-]/gu, ''));
    return !LOOKUP_DECORATIVE_STEMS.some((decorative) => stem.startsWith(decorative));
  });
  if (kept.length === words.length) return query;
  const rest = kept.join(' ');
  return tokenize(normalizeSurfaceText(rest)).some(isLookupSubjectToken) ? rest : query;
}

/** A typed word of a lookup query that names its subject (not a form, strength, audience or meta word). */
export function isLookupSubjectToken(token: string): boolean {
  if (token.length < 3 || /^\d/u.test(token)) return false;
  if (!isTitleQueryTerm(token) || isFormOrStrengthToken(token)) return false;
  return !isLookupMetaToken(token);
}

const CHILD_AUDIENCE_TOKEN =
  /^(?:ребен|ребён|детск|дети$|детей$|детям$|детьми$|детях$|младен|груднич|новорожд|подрост|малыш)/u;
const ADULT_AUDIENCE_TOKEN = /^взросл/u;

/** The audience a typed word names («у ребёнка», «детей», «взрослого»), if it names one. */
export function audienceOfToken(token: string): 'children' | 'adults' | undefined {
  if (CHILD_AUDIENCE_TOKEN.test(token)) return 'children';
  if (ADULT_AUDIENCE_TOKEN.test(token)) return 'adults';
  return undefined;
}
