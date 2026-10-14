import type {
  QueryCorrection,
  QueryRewriteKind,
  QueryWordCorrection,
  SearchResponse,
} from '@localmed/contracts';
import {
  correctWord,
  isCloseToken,
  MEDICATION_SPELLING_LABEL,
  type NameVocabulary,
  nameQueryVariants,
  normalizeSurfaceText,
  searchSubjectText,
  swapKeyboardLayout,
} from '@localmed/search-lexical';

import type { QueryDocumentIndex } from './query-document-index';

/**
 * Keyboard-layout, transliteration and Latin-name fallback for name queries (roadmap item 3, S3).
 *
 * It runs only when the typed query found no title or alias that names what was typed among the
 * first groups, so a query that already matches is never touched. A candidate rewrite («vtnajhvby»
 * → «метформин», «nurofen» → «нурофен», Latin `nameLat` → the drug's title) is searched only when
 * every word of it looks like a name of the mounted corpus, and replaces the result only when its
 * own first groups name it.
 */
const CHECKED_GROUPS = 5;
const MAX_SEARCHED_VARIANTS = 3;
const MIN_CHECKED_WORD = 4;
const WORD = /[a-zа-я]{2,}/gu;

export interface NameVariantCandidate {
  readonly kind: QueryRewriteKind;
  readonly query: string;
}

/** Words the group's title or aliases must cover; digits and one-letter words are not names. */
function typedWords(query: string): readonly string[] {
  return normalizeSurfaceText(searchSubjectText(query)).match(WORD) ?? [];
}

function namesCover(names: readonly string[], words: readonly string[], exact: boolean): boolean {
  const nameWords = names.flatMap((name) => normalizeSurfaceText(name).split(/[^0-9a-zа-я]+/u));
  return words.every((word) =>
    nameWords.some(
      (name) => name.startsWith(word) || (!exact && word.length >= 5 && isCloseToken(name, word)),
    ),
  );
}

/**
 * True when the response already answers the typed name: an identity hit, a terminology match, or
 * a group among the first few whose title or alias begins with every typed word — or, unless
 * `exact`, a word close to it («внеплания» for «пневмания»).
 */
export function responseNamesQuery(
  response: SearchResponse,
  query: string,
  index: QueryDocumentIndex,
  exact = false,
): boolean {
  if (response.identities?.length) return true;
  const words = typedWords(query);
  if (words.length === 0) return true;
  // A title, short title or alias equal to the query is a name whatever the group's title says.
  const exactIds = index.exactIdentityIds(query);
  return response.groups.slice(0, CHECKED_GROUPS).some((group) => {
    if (exactIds.has(group.documentId)) return true;
    if (group.terminologyMatch) return true;
    const metadata = index.byId.get(group.documentId)?.metadata ?? {};
    const aliases = ['declaredAliases', 'navigationAliases'].flatMap((key) => {
      const value = metadata[key];
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    });
    return namesCover([group.title, ...aliases], words, exact);
  });
}

/** Rewrites worth a search: name-shaped, and every word resembles a name the corpus holds. */
export function nameVariantCandidates(
  query: string,
  index: QueryDocumentIndex,
): readonly NameVariantCandidate[] {
  // A rewrite must itself be a name-length word («пцд» from «PTSD» is not a name).
  const plausible = (variant: string) =>
    (variant.match(WORD) ?? []).some((word) => word.length >= MIN_CHECKED_WORD) &&
    (variant.match(WORD) ?? [])
      .filter((word) => word.length >= MIN_CHECKED_WORD)
      .every((word) => index.hasNameWordPrefix(word));
  // A declared Latin name matches as typed or after the layout swap («ьуеащкьшт» → «metformin»).
  const swapped = swapKeyboardLayout(query);
  const latinNames = [query, ...(swapped ? [swapped] : [])].flatMap((typed) =>
    index
      .titlesForLatinName(typed)
      .map((title): NameVariantCandidate => ({ kind: 'latin-name', query: title })),
  );
  return [
    ...latinNames,
    ...nameQueryVariants(query)
      .filter((variant) => plausible(variant.query))
      .map((variant): NameVariantCandidate => ({ kind: variant.kind, query: variant.query })),
  ].slice(0, MAX_SEARCHED_VARIANTS);
}

const LETTER_WORD = /[a-zа-я]+/gu;
const SHORT_LATIN_WORD = /^[a-z]{1,6}$/u;

/**
 * The typed query with every misspelt word corrected to the closest beginning of a title or alias
 * word of the mounted corpus (roadmap item 19, `correctWord`), or null when no word needs or allows
 * a correction. A word that begins some name is left as typed; digits and short words are never
 * touched. The caller searches the corrected query only after the typed one named nothing.
 */
export function spellingCorrection(
  query: string,
  vocabulary: NameVocabulary,
): QueryCorrection | null {
  const normalized = normalizeSurfaceText(query);
  const corrections: QueryWordCorrection[] = [];
  let corrected = '';
  let cursor = 0;
  for (const match of normalized.matchAll(LETTER_WORD)) {
    const word = match[0];
    const before = normalized[match.index - 1];
    const after = normalized[match.index + word.length];
    // «b12», «4-5» and similar tokens are codes and numbers, not names.
    if (/[0-9]/u.test(`${before ?? ''}${after ?? ''}`)) continue;
    // A short Latin word is a term, a code or a stray word of pasted code («alert», «script»), not a
    // slip of a name: one edit away from a rare Latin name («Apert») it would find nonsense.
    if (SHORT_LATIN_WORD.test(word)) continue;
    const found = correctWord(word, vocabulary);
    if (!found) continue;
    corrected += normalized.slice(cursor, match.index) + found.corrected;
    cursor = match.index + word.length;
    corrections.push({
      original: word,
      corrected: found.corrected,
      score: Math.max(0, 1 - found.cost / word.length),
    });
  }
  if (corrections.length === 0) return null;
  return { correctedQuery: corrected + normalized.slice(cursor), corrections };
}

/**
 * The correction to show when the typed query found drugs only through the medication spelling
 * branch («обакавир» → «Абакавир»): the spelling correction of the query, when each corrected word
 * begins a word of a drug name that branch matched. Null when no such branch answered or the two
 * disagree, so the box never shows a correction the results do not follow.
 */
export function drugSpellingCorrection(
  response: SearchResponse,
  query: string,
  vocabulary: NameVocabulary,
): QueryCorrection | null {
  const prefix = `${MEDICATION_SPELLING_LABEL}: `;
  const spelledNames = response.groups
    .slice(0, CHECKED_GROUPS)
    .flatMap((group) => group.results.flatMap((result) => result.matchedBranches))
    .filter((branch) => branch.startsWith(prefix))
    .flatMap((branch) => normalizeSurfaceText(branch.slice(prefix.length)).split(/[^0-9a-zа-я]+/u));
  if (spelledNames.length === 0) return null;
  const correction = spellingCorrection(query, vocabulary);
  if (!correction) return null;
  return correction.corrections.every((item) =>
    spelledNames.some((name) => name.startsWith(item.corrected)),
  )
    ? correction
    : null;
}
