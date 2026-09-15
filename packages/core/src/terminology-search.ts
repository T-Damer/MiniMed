import {
  type SearchFilters,
  type SearchResultGroup,
  type TerminologySearchProjection,
  TerminologySearchProjectionSchema,
} from '@localmed/contracts';
import {
  buildLookupQueryPlan,
  findNormalizedPhraseIndex,
  type LexicalQueryBranchPlan,
  normalizeSurfaceText,
  searchSubjectText,
} from '@localmed/search-lexical';
import type { SearchDocumentDescriptor } from '@localmed/storage';

interface TermDocument {
  readonly documentId: string;
  readonly term: TerminologySearchProjection;
}
export interface TerminologyMatch {
  readonly documents: readonly TermDocument[];
  readonly related: readonly TermDocument[];
  readonly conceptIds: ReadonlySet<string>;
  readonly names: readonly string[];
}

function scopedIds(ids: readonly string[], filters: SearchFilters): string[] {
  const requested = filters.documentIds?.length ? new Set(filters.documentIds) : null;
  return ids.filter((id) => !requested || requested.has(id));
}

/** A source-labelled name index, not a diagnostic model or a synonym/equivalence assertion. */
export class TerminologySearchIndex {
  private readonly names = new Map<string, TermDocument[]>();
  private readonly concepts = new Map<string, TermDocument[]>();
  private readonly documents = new Map<string, TermDocument>();

  constructor(documents: readonly SearchDocumentDescriptor[]) {
    for (const document of documents) {
      if (!document.metadata['terminology']) continue;
      const parsed = TerminologySearchProjectionSchema.safeParse(document.metadata['terminology']);
      if (!parsed.success) continue; // Malformed optional metadata never establishes a concept match.
      const entry = { documentId: document.id, term: parsed.data };
      this.documents.set(document.id, entry);
      const concept = this.concepts.get(entry.term.conceptId) ?? [];
      concept.push(entry);
      this.concepts.set(entry.term.conceptId, concept);
      for (const name of new Set(entry.term.names.map(normalizeSurfaceText))) {
        const matches = this.names.get(name) ?? [];
        matches.push(entry);
        this.names.set(name, matches);
      }
    }
  }

  match(query: string): TerminologyMatch | undefined {
    const matches = this.names.get(searchSubjectText(query));
    if (!matches?.length) return undefined;
    const conceptIds = new Set(matches.map((entry) => entry.term.conceptId));
    const documents = matches.filter((entry) => !this.isSuperseded(entry.documentId));
    const relatedIds = new Set(matches.flatMap((entry) => entry.term.relatedConceptIds));
    const related = [...relatedIds]
      .filter((id) => !conceptIds.has(id))
      .sort()
      .flatMap((id) => this.concepts.get(id) ?? [])
      .filter((entry) => !this.isSuperseded(entry.documentId));
    return {
      documents,
      related,
      conceptIds,
      names: [...new Set(matches.flatMap((entry) => entry.term.names))],
    };
  }

  isSuperseded(documentId: string): boolean {
    const source = this.documents.get(documentId)?.term;
    if (!source?.discovery) return false;
    const target = this.documents.get(source.targetDocumentId)?.term;
    return Boolean(
      target &&
        !target.discovery &&
        target.conceptId === source.conceptId &&
        target.edition === source.edition,
    );
  }

  searches(
    match: TerminologyMatch,
    filters: SearchFilters,
  ): readonly {
    readonly branch: LexicalQueryBranchPlan;
    readonly filters: SearchFilters;
  }[] {
    const definitions = scopedIds(
      match.documents.map((entry) => entry.documentId),
      filters,
    );
    const related = scopedIds(
      match.related.map((entry) => entry.documentId),
      filters,
    ).slice(0, 12);
    const searches: { branch: LexicalQueryBranchPlan; filters: SearchFilters }[] = [];
    const add = (
      id: string,
      label: string,
      names: readonly string[],
      documentIds: string[],
      weight: number,
    ) => {
      if (!documentIds.length) return;
      const branch = buildLookupQueryPlan(names.slice(0, 12).join(' '), []).branches[0];
      if (!branch) return;
      searches.push({
        branch: { ...branch, id, label, weight },
        filters: { ...filters, documentIds },
      });
    };
    add('terminology-name', 'Медицинский термин', match.names, definitions, 1);
    const sourceBranch = buildLookupQueryPlan(match.names.slice(0, 12).join(' '), []).branches[0];
    if (sourceBranch)
      searches.push({
        branch: {
          ...sourceBranch,
          id: 'terminology-mentions',
          label: 'Названия термина в источниках',
          weight: 0.7,
        },
        filters,
      });
    add(
      'terminology-related',
      'Смежные понятия MeSH (не клинический вывод)',
      match.related
        .filter((entry) => related.includes(entry.documentId))
        .flatMap((entry) => entry.term.names.slice(0, 1)),
      related,
      0.15,
    );
    return searches;
  }

  rank(
    groups: readonly SearchResultGroup[],
    match?: TerminologyMatch,
  ): readonly SearchResultGroup[] {
    const visible = groups.filter((group) => !this.isSuperseded(group.documentId));
    if (!match) return visible;
    const exact = new Set(match.documents.map((entry) => entry.documentId));
    const related = new Set(match.related.map((entry) => entry.documentId));
    const phrases = match.names.map(normalizeSurfaceText).filter(Boolean);
    return visible
      .map((group, index) => {
        const mention =
          !this.documents.has(group.documentId) &&
          group.results.some(
            (result) =>
              result.terminologyConceptIds?.some((id) => match.conceptIds.has(id)) ||
              phrases.some(
                (phrase) =>
                  findNormalizedPhraseIndex(normalizeSurfaceText(result.snippet), phrase) >= 0,
              ),
          );
        const tier = exact.has(group.documentId)
          ? 3
          : mention
            ? 2
            : related.has(group.documentId)
              ? 1
              : 0;
        return {
          group: tier
            ? {
                ...group,
                terminologyMatch:
                  tier === 3
                    ? ('term' as const)
                    : tier === 2
                      ? ('term-mention' as const)
                      : ('related-term' as const),
              }
            : group,
          tier,
          index,
        };
      })
      .sort((left, right) => right.tier - left.tier || left.index - right.index)
      .map((entry) => entry.group);
  }
}
