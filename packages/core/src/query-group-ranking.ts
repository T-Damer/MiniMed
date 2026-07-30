import type { SearchResultGroup } from '@localmed/contracts';
import { normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

const GENERIC_QUERY_TERMS = new Set([
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

function compactReference(value: string): string {
  return normalizeSurfaceText(value).replace(/[^0-9a-zа-я]+/gu, '');
}

function legalReferences(value: string): ReadonlySet<string> {
  const normalized = normalizeSurfaceText(value);
  const references = new Set<string>();
  for (const match of normalized.matchAll(
    /(?:^|[^0-9a-zа-я])(\d{2,4}\s*[-–—]?\s*(?:фз|н))(?=$|[^0-9a-zа-я])/gu,
  )) {
    const reference = match[1];
    if (reference) references.add(compactReference(reference));
  }
  return references;
}

function titleCoverage(query: string, title: string): number {
  const queryTerms = new Set(
    tokenize(query).filter((term) => term.length >= 4 && !GENERIC_QUERY_TERMS.has(term)),
  );
  const titleTerms = tokenize(title);
  const matchedTitleTerms = new Set<string>();
  for (const queryTerm of queryTerms) {
    const titleTerm = titleTerms.find(
      (candidate) => candidate.startsWith(queryTerm) || queryTerm.startsWith(candidate),
    );
    if (titleTerm) matchedTitleTerms.add(titleTerm);
  }
  return Math.min(0.5, matchedTitleTerms.size * 0.12);
}

function subjectPhraseBoost(query: string, title: string): number {
  const normalizedQuery = normalizeSurfaceText(query);
  const normalizedTitle = normalizeSurfaceText(title);
  const pairs: readonly [RegExp, RegExp, number][] = [
    [/групп[а-я]*\s+здоров/u, /групп[а-я]*\s+здоров/u, 0.55],
    [/инвалид/u, /инвалид/u, 0.55],
    [/профилактическ[а-я]*\s+(?:медицинск[а-я]*\s+)?осмотр/u, /профилактическ/u, 0.4],
    [/санатор/u, /санатор/u, 0.4],
    [/туберкул[а-я]*.*групп|групп[а-я]*.*туберкул/u, /туберкул/u, 0.4],
    [/перв[а-я]*\s+помощ/u, /перв[а-я]*\s+помощ/u, 0.4],
    [/педиатр/u, /педиатр/u, 0.35],
  ];
  return pairs.reduce(
    (boost, [queryPattern, titlePattern, value]) =>
      queryPattern.test(normalizedQuery) && titlePattern.test(normalizedTitle)
        ? Math.max(boost, value)
        : boost,
    0,
  );
}

export function queryGroupRelevanceBoost(query: string, title: string): number {
  const queryReferences = legalReferences(query);
  const titleReferences = legalReferences(title);
  const referenceBoost = [...queryReferences].some((reference) => titleReferences.has(reference))
    ? 1
    : 0;
  return referenceBoost + titleCoverage(query, title) + subjectPhraseBoost(query, title);
}

export function rankSearchGroupsByQuery(
  groups: readonly SearchResultGroup[],
  query: string,
): readonly SearchResultGroup[] {
  return groups
    .map((group, index) => ({
      group,
      index,
      score: group.bestScore + queryGroupRelevanceBoost(query, group.title),
    }))
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.group);
}
