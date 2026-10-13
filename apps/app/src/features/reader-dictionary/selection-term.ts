import type {
  CoreIdentityHit,
  LocalMedError,
  QueryCorrection,
  Result,
  SearchResponse,
  SearchResultGroup,
} from '@localmed/contracts';

import { definitionHitHasText } from '@/features/search/definition-preview';

/**
 * Reader dictionary: what a selected word or phrase is looked up as. Pure over text and an injected
 * `search`, so the app's search stack (exact names, name variants and spelling correction in the
 * core) stays the one place that decides what a name matches; this module only turns a selection
 * into the few queries worth asking, nominative first.
 */

/** A selection longer than this is a passage, not a term: the dictionary is not offered. */
export const MAX_SELECTION_WORDS = 6;
export const MAX_SELECTION_CHARACTERS = 80;
/** Searches one selection may cost; the first one that names a dictionary entry ends the loop. */
export const MAX_LOOKUP_QUERIES = 8;
const MIN_SELECTION_LETTERS = 2;
const MIN_STEM_LENGTH = 3;
const FORMS_PER_WORD = 5;

const EDGE_PUNCTUATION =
  /^[\s"'«»“”„‘’()[\]{}<>.,;:!?…–—\-/\\|*•·]+|[\s"'«»“”„‘’()[\]{}<>.,;:!?…–—\-/\\|*•·]+$/gu;

/**
 * The selection as a lookup term: whitespace collapsed, hyphenation at line ends joined, quotes and
 * punctuation around it removed. `undefined` when it is not a word or a short phrase (no letters,
 * a single letter, more than six words or 80 characters).
 */
export function cleanSelection(raw: string): string | undefined {
  const text = raw
    .normalize('NFKC')
    .replace(/­/gu, '')
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/\s+/gu, ' ')
    .replace(EDGE_PUNCTUATION, '');
  if (!text || text.length > MAX_SELECTION_CHARACTERS) return undefined;
  if ((text.match(/\p{L}/gu) ?? []).length < MIN_SELECTION_LETTERS) return undefined;
  if (text.split(' ').length > MAX_SELECTION_WORDS) return undefined;
  return text;
}

const CONSONANT_A_SPELLING = /[кгхжшчщ]$/u;

interface EndingRule {
  readonly suffix: string;
  /** Nominative-singular endings the stem may take, likeliest first. */
  readonly to: (stem: string) => readonly string[];
}

const always =
  (...endings: string[]) =>
  (): readonly string[] =>
    endings;

/**
 * Case endings of Russian medical names and what they stand for in the nominative. Plausible, not
 * exact: every form is only a candidate that the dictionary then confirms or rejects.
 */
const ENDING_RULES: readonly EndingRule[] = [
  { suffix: 'иями', to: always('ия', 'ие') },
  { suffix: 'ями', to: always('я', 'ь', 'е') },
  { suffix: 'ами', to: always('', 'а', 'ы') },
  { suffix: 'иях', to: always('ия', 'ие') },
  { suffix: 'иям', to: always('ия', 'ие') },
  { suffix: 'ией', to: always('ия') },
  { suffix: 'ием', to: always('ие', 'ий') },
  { suffix: 'ого', to: always('ый', 'ой', 'ий') },
  { suffix: 'его', to: always('ий', 'ей') },
  { suffix: 'ому', to: always('ый', 'ой', 'ий') },
  { suffix: 'ему', to: always('ий', 'ей') },
  { suffix: 'ыми', to: always('ый') },
  { suffix: 'ими', to: always('ий', 'ый') },
  { suffix: 'ии', to: always('ия', 'ие', 'ий') },
  { suffix: 'ию', to: always('ия', 'ие') },
  { suffix: 'ых', to: always('ый') },
  { suffix: 'их', to: always('ий', 'ый') },
  { suffix: 'ым', to: always('ый') },
  { suffix: 'им', to: always('ий', 'ый') },
  { suffix: 'ую', to: always('ая') },
  { suffix: 'юю', to: always('яя') },
  {
    suffix: 'ой',
    to: (stem) => (CONSONANT_A_SPELLING.test(stem) ? ['ая', 'а'] : ['ая', 'а', 'я']),
  },
  { suffix: 'ей', to: always('ь', 'я', 'ий', '') },
  { suffix: 'ом', to: always('', 'о') },
  { suffix: 'ем', to: always('е', 'ь', 'й', '') },
  { suffix: 'ов', to: always('', 'ь') },
  { suffix: 'ам', to: always('а', '', 'ь') },
  { suffix: 'ям', to: always('я', 'ь', 'й') },
  { suffix: 'ах', to: always('а', '') },
  { suffix: 'ях', to: always('я', 'ь', 'й') },
  { suffix: 'ти', to: always('ть') },
  { suffix: 'ы', to: always('', 'а') },
  {
    suffix: 'и',
    to: (stem) => (CONSONANT_A_SPELLING.test(stem) ? ['а'] : ['ь', 'я', 'а', '']),
  },
  { suffix: 'у', to: always('', 'а', 'я') },
  { suffix: 'ю', to: always('я', 'ь', 'й') },
  { suffix: 'е', to: always('', 'а', 'я', 'ь', 'о') },
  { suffix: 'а', to: always('', 'ь') },
  { suffix: 'я', to: always('й', 'ь', '') },
];

const SORTED_RULES = ENDING_RULES.toSorted(
  (left, right) => right.suffix.length - left.suffix.length,
);

function foldWord(word: string): string {
  return word.toLowerCase().replaceAll('ё', 'е');
}

/**
 * Likely nominative forms of one inflected Russian word («гипертензии» → «гипертензия»,
 * «диабетом» → «диабет», «сахарного» → «сахарный»), likeliest first, never the word itself. Words
 * that are not Cyrillic, or too short to have a stem, have none.
 */
export function nominativeForms(word: string): readonly string[] {
  const folded = foldWord(word);
  if (!/^[а-я]+$/u.test(folded)) return [];
  const forms: string[] = [];
  for (const rule of SORTED_RULES) {
    if (!folded.endsWith(rule.suffix)) continue;
    const stem = folded.slice(0, folded.length - rule.suffix.length);
    if (stem.length < MIN_STEM_LENGTH) continue;
    for (const ending of rule.to(stem)) {
      const form = stem + ending;
      if (form !== folded && !forms.includes(form)) forms.push(form);
    }
  }
  return forms.slice(0, FORMS_PER_WORD);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function phraseForms(words: readonly string[]): string | undefined {
  const forms = words.map((word) => nominativeForms(word)[0]);
  if (forms.every((form) => form === undefined)) return undefined;
  return words.map((word, index) => forms[index] ?? foldWord(word)).join(' ');
}

/**
 * The queries a selection is looked up as, in order: the text as selected; the same phrase with
 * every word in its likeliest nominative form; then shorter parts of a phrase (so «лечение
 * пневмонии» still reaches «пневмония»), longest first; for one word, its other nominative
 * candidates. At most {@link MAX_LOOKUP_QUERIES}; none for text that is not a term.
 */
export function selectionLookupQueries(raw: string): readonly string[] {
  const text = cleanSelection(raw);
  if (!text) return [];
  const words = text.split(' ');
  const queries: string[] = [text];
  if (words.length === 1) {
    queries.push(...nominativeForms(text));
    return unique(queries).slice(0, MAX_LOOKUP_QUERIES);
  }
  const whole = phraseForms(words);
  if (whole) queries.push(whole);
  for (let length = words.length - 1; length >= 1; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const part = words.slice(start, start + length);
      // A lone function word («при», «и») names nothing and costs a search.
      if (length === 1 && (part[0] ?? '').length < MIN_STEM_LENGTH + 1) continue;
      queries.push(part.join(' '));
      const base = phraseForms(part);
      if (base) queries.push(base);
    }
  }
  return unique(queries).slice(0, MAX_LOOKUP_QUERIES);
}

export type SelectionSearch = (query: string) => Promise<Result<SearchResponse, LocalMedError>>;

export interface SelectionLookup {
  /** The cleaned selection. */
  readonly text: string;
  /** The query that named dictionary entries; the selection itself when nothing did. */
  readonly matched: string;
  readonly identities: readonly CoreIdentityHit[];
  /** Documents found for the selection as typed (or the first query that found any). */
  readonly groups: readonly SearchResultGroup[];
  /** Set when the core corrected a misspelt word of the query that produced `groups`. */
  readonly correction?: QueryCorrection;
}

/** An entry of an installed or known dictionary that has text of its own (not a bare name). */
function hasDefinition(identities: readonly CoreIdentityHit[]): boolean {
  return identities.some((hit) => hit.target.type === 'definition' && definitionHitHasText(hit));
}

/**
 * Looks a selection up: each query of {@link selectionLookupQueries} is searched until one names
 * a dictionary entry with a definition. A name that only a document or a bare dictionary name
 * carries («Пневмонии» as a recommendation title) is kept while the nominative candidates are still
 * tried, and stands if none does better. Without any entry, the documents found for the selection
 * stand in. Rejects when every search failed (the failure is the answer, not an empty result).
 */
export async function resolveSelectionTerm(
  raw: string,
  search: SelectionSearch,
): Promise<SelectionLookup | undefined> {
  const text = cleanSelection(raw);
  if (!text) return undefined;
  let named: SelectionLookup | undefined;
  let fallback: SearchResponse | undefined;
  let fallbackQuery = text;
  let lastError: LocalMedError | undefined;
  let answered = false;
  for (const query of selectionLookupQueries(text)) {
    const result = await search(query);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    answered = true;
    const identities = result.value.identities ?? [];
    if (identities.length > 0) {
      const found: SelectionLookup = {
        text,
        matched: query,
        identities,
        groups: result.value.groups,
        ...(result.value.queryCorrection ? { correction: result.value.queryCorrection } : {}),
      };
      if (hasDefinition(identities)) return found;
      named ??= found;
      continue;
    }
    if (!fallback || (fallback.groups.length === 0 && result.value.groups.length > 0)) {
      fallback = result.value;
      fallbackQuery = query;
    }
  }
  if (named) return named;
  if (!answered && lastError) throw new Error(lastError.message);
  return {
    text,
    matched: fallbackQuery === text || !fallback?.groups.length ? text : fallbackQuery,
    identities: [],
    groups: fallback?.groups ?? [],
    ...(fallback?.queryCorrection ? { correction: fallback.queryCorrection } : {}),
  };
}
