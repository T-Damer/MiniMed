import type {
  SearchFilters,
  SearchResponse,
  SearchResult,
  SearchResultGroup,
} from '@localmed/contracts';
import {
  type AtcDirectoryEntry,
  type AtcQuery,
  findAtcEntries,
  parseAtcQueries,
} from '@localmed/search-lexical';

import type { QueryDocumentIndex } from './query-document-index';
import { collapseGroupsByTargetDocument } from './query-group-ranking';

/**
 * Where the codes of the drugs come from (ATC5). The core does not read ЕСКЛП metadata or any asset
 * itself: the application hands it the directory, so the main search finds a drug by its ATC code
 * with or without the module that holds the drug installed. Entries carry the substance card id
 * (`esklp.mnn.<slug>`), its name and every code it is found under; see `AtcDirectoryEntry`.
 */
export interface DrugCodeDirectory {
  entries(): Promise<readonly AtcDirectoryEntry[]>;
}

/** Matched-branch label of a result found by its code. */
export const ATC_BRANCH_LABEL = 'Код АТХ';

/** Reads the first passage of each document id (its identity text); ids the filters exclude are dropped. */
export type ReadIdentityResults = (ids: ReadonlySet<string>) => Promise<readonly SearchResult[]>;

function atcDocumentId(
  entry: AtcDirectoryEntry,
  index: QueryDocumentIndex,
  filters: SearchFilters,
): string | undefined {
  const allowed = filters.documentIds;
  return index
    .documentIdsForTarget(entry.id)
    .find((id) => !allowed?.length || allowed.includes(id));
}

/** The code the typed text was read as and the drugs it names. */
export interface AtcDrugSearch {
  readonly query: AtcQuery;
  readonly groups: readonly SearchResultGroup[];
}

/**
 * The drugs a typed ATC code or prefix names, as result groups: the exact level first, then by
 * name, at most `limit`. Null for a query that is no code, or a code no mounted drug carries. A text
 * with several readings (`parseAtcQueries`) is answered by the first reading that names a drug.
 */
export async function atcDrugGroups(input: {
  readonly query: string;
  readonly directory: DrugCodeDirectory;
  readonly index: QueryDocumentIndex;
  readonly filters: SearchFilters;
  readonly limit: number;
  readonly readResults: ReadIdentityResults;
}): Promise<AtcDrugSearch | null> {
  const queries = parseAtcQueries(input.query);
  if (queries.length === 0) return null;
  const entries = await input.directory.entries();
  for (const query of queries) {
    const found: { documentId: string; code: string; registryCode: string | null }[] = [];
    for (const match of findAtcEntries(query, entries)) {
      const documentId = atcDocumentId(match.entry, input.index, input.filters);
      if (documentId === undefined) continue;
      found.push({ documentId, code: match.code, registryCode: match.registryCode });
      if (found.length >= input.limit) break;
    }
    if (found.length === 0) continue;
    const groups = await groupsOf(found, input.readResults);
    if (groups.length > 0) return { query, groups };
  }
  return null;
}

async function groupsOf(
  found: readonly { documentId: string; code: string; registryCode: string | null }[],
  readResults: ReadIdentityResults,
): Promise<readonly SearchResultGroup[]> {
  const results = await readResults(new Set(found.map((entry) => entry.documentId)));
  const resultsByDocument = new Map<string, SearchResult[]>();
  for (const result of results) {
    const list = resultsByDocument.get(result.documentId) ?? [];
    list.push({ ...result, matchedBranches: [ATC_BRANCH_LABEL] });
    resultsByDocument.set(result.documentId, list);
  }
  return found.flatMap((entry, position): SearchResultGroup[] => {
    const documentResults = resultsByDocument.get(entry.documentId);
    const first = documentResults?.[0];
    if (!documentResults || !first) return [];
    return [
      {
        documentId: entry.documentId,
        title: first.title,
        // Above any text hit, in the order of the match.
        bestScore: 1 + (found.length - position) / found.length,
        categories: [...new Set(documentResults.map((result) => result.category))],
        atcMatch: {
          code: entry.code,
          ...(entry.registryCode ? { registryCode: entry.registryCode } : {}),
        },
        results: documentResults,
      },
    ];
  });
}

/**
 * The response with the drugs of the typed code in front of the text hits. An МКБ-10 card named by
 * the same letters and digits (`M05`, `N18`) stays first: the code is a diagnosis as often as a
 * drug group. A drug the text search found too is listed once, as the code's group.
 */
export function withAtcGroups(input: {
  readonly response: SearchResponse;
  readonly found: AtcDrugSearch | null;
  readonly query: string;
  readonly index: QueryDocumentIndex;
  readonly limit: number;
}): SearchResponse {
  const { response, found, index } = input;
  if (!found) return response;
  const { groups, query: parsed } = found;
  const icdCards = new Set(index.exactIcdCardIds(input.query));
  const isIcdCard = (group: SearchResultGroup): boolean =>
    icdCards.has(group.documentId) ||
    icdCards.has(String(index.byId.get(group.documentId)?.metadata['targetDocumentId'] ?? ''));
  const leading = response.groups.filter(isIcdCard);
  const rest = response.groups.filter((group) => !isIcdCard(group));
  const merged = collapseGroupsByTargetDocument([...leading, ...groups, ...rest], index.byId).slice(
    0,
    input.limit,
  );
  return {
    ...response,
    groups: merged,
    // A code typed with the Russian layout on («о05»): say which code the results are for.
    ...(parsed.reading === 'layout' && !response.queryRewrite
      ? { queryRewrite: { kind: 'layout' as const, query: parsed.code } }
      : {}),
  };
}
