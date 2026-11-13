import type { DocumentLinkAlternative } from '@/features/library/document-medication-links';

export interface SearchMeaning {
  readonly phrase: string;
  readonly alternatives: readonly DocumentLinkAlternative[];
}

/**
 * The meanings of a query worth asking about above the results: each phrase keeps only the
 * documents the result list does not show already, and a phrase left with fewer than two is no
 * choice to make (owner 2026-11-13: a drug must appear once, not as a chip and again as a result).
 */
export function meaningsBeyondResults(
  meanings: readonly SearchMeaning[],
  resultDocumentIds: readonly string[],
): readonly SearchMeaning[] {
  const shown = new Set(resultDocumentIds);
  return meanings.flatMap((meaning) => {
    const alternatives = meaning.alternatives.filter(
      (alternative) => !shown.has(alternative.documentId),
    );
    return alternatives.length > 1 ? [{ ...meaning, alternatives }] : [];
  });
}

/** «КВЕТИАПИН-АЛИУМ» and «Кветиапин Алиум» name the same thing: case, «ё», signs and spaces aside. */
function titleKey(title: string): string {
  return title
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/gu, ' ')
    .trim();
}

/**
 * The documents whose titles carry the query words and that the result list does not show
 * (SRCHDRUG1, owner 2026-11-13). Measured on 25 queries: for drug names every title match was a
 * result already, so nothing is added; for a disease a narrower reference article («Пневмония у
 * детей») may be named by its title only. A document counts as shown when its id or its title is in
 * the list (a catalog pointer and the card it stands for share the title, not the id).
 */
export function titleMatchesBeyondResults<T extends { readonly id: string }>(
  matches: readonly T[],
  titleOf: (document: T) => string,
  results: readonly { readonly documentId: string; readonly title: string }[],
): readonly T[] {
  const ids = new Set(results.map((group) => group.documentId));
  const titles = new Set(results.map((group) => titleKey(group.title)));
  return matches.filter(
    (document) => !ids.has(document.id) && !titles.has(titleKey(titleOf(document))),
  );
}
