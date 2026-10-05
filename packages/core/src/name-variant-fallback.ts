import type { QueryRewriteKind, SearchResponse } from '@localmed/contracts';
import {
  isCloseToken,
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

function namesCover(names: readonly string[], words: readonly string[]): boolean {
  const nameWords = names.flatMap((name) => normalizeSurfaceText(name).split(/[^0-9a-zа-я]+/u));
  return words.every((word) =>
    nameWords.some(
      (name) => name.startsWith(word) || (word.length >= 5 && isCloseToken(name, word)),
    ),
  );
}

/**
 * True when the response already answers the typed name: an identity hit, a terminology match, or
 * a group among the first few whose title or alias begins with every typed word.
 */
export function responseNamesQuery(
  response: SearchResponse,
  query: string,
  index: QueryDocumentIndex,
): boolean {
  if (response.identities?.length) return true;
  const words = typedWords(query);
  if (words.length === 0) return true;
  return response.groups.slice(0, CHECKED_GROUPS).some((group) => {
    if (group.terminologyMatch) return true;
    const metadata = index.byId.get(group.documentId)?.metadata ?? {};
    const aliases = ['declaredAliases', 'navigationAliases'].flatMap((key) => {
      const value = metadata[key];
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    });
    return namesCover([group.title, ...aliases], words);
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
