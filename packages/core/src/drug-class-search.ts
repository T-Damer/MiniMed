import type {
  SearchDrugClass,
  SearchFilters,
  SearchResponse,
  SearchResultGroup,
} from '@localmed/contracts';
import { type AtcDirectoryEntry, matchAtcEntry } from '@localmed/search-lexical';

import {
  atcResultGroups,
  type DrugClassMatch,
  type DrugCodeDirectory,
  type ReadIdentityResults,
} from './atc-drug-search';
import type { QueryDocumentIndex } from './query-document-index';
import { collapseGroupsByTargetDocument } from './query-group-ranking';

/** The most drugs of a class that lead the results; the class card links to the rest. */
export const MAX_CLASS_DRUGS = 12;

export interface DrugClassSearch {
  readonly drugClass: SearchDrugClass;
  readonly groups: readonly SearchResultGroup[];
}

interface ClassDrug {
  readonly entry: AtcDirectoryEntry;
  readonly code: string;
  readonly registryCode: string | null;
}

/** A combination («ВАЛСАРТАН+САКУБИТРИЛ») is listed after the single substances of the class. */
function isCombination(entry: AtcDirectoryEntry): boolean {
  return entry.name.includes('+');
}

/**
 * The drugs under the class's ATC groups, once each: the code a drug is found under is the first
 * group (in the class's own order) whose code it carries. Single substances before combinations,
 * commoner before rarer (registrations), then by name.
 */
export function drugsOfClass(
  match: DrugClassMatch,
  entries: readonly AtcDirectoryEntry[],
): {
  readonly drugs: readonly ClassDrug[];
  readonly counts: ReadonlyMap<string, number>;
} {
  const counts = new Map<string, number>();
  const byId = new Map<string, ClassDrug>();
  for (const group of match.groups) {
    let count = 0;
    for (const entry of entries) {
      const found = matchAtcEntry({ code: group.code }, entry);
      if (!found) continue;
      count += 1;
      if (!byId.has(entry.id)) {
        byId.set(entry.id, { entry, code: found.code, registryCode: found.registryCode });
      }
    }
    counts.set(group.code, count);
  }
  const drugs = [...byId.values()].toSorted(
    (left, right) =>
      Number(isCombination(left.entry)) - Number(isCombination(right.entry)) ||
      (right.entry.weight ?? 0) - (left.entry.weight ?? 0) ||
      left.entry.name.localeCompare(right.entry.name, 'ru') ||
      left.entry.id.localeCompare(right.entry.id),
  );
  return { drugs, counts };
}

/**
 * SRCH1 (owner decision 2026-10-14): a query that names a drug class as a whole returns the class
 * first (the card the response's \`drugClass\` describes), then the drugs of the class as result
 * groups, then the usual documents. Null when the query names no class or no drug of it is
 * available.
 */
export async function drugClassSearch(input: {
  readonly query: string;
  readonly directory: DrugCodeDirectory;
  readonly index: QueryDocumentIndex;
  readonly filters: SearchFilters;
  readonly readResults: ReadIdentityResults;
}): Promise<DrugClassSearch | null> {
  if (!input.directory.classOf) return null;
  const match = await input.directory.classOf(input.query);
  if (!match || match.groups.length === 0) return null;
  // Only drugs the corpus holds (a card, or the pointer to its module) count and are listed.
  const allowed = input.filters.documentIds;
  const documentIds = new Map<string, string>();
  const held = (await input.directory.entries()).filter((entry) => {
    const documentId = input.index
      .documentIdsForTarget(entry.id)
      .find((id) => !allowed?.length || allowed.includes(id));
    if (documentId !== undefined) documentIds.set(entry.id, documentId);
    return documentId !== undefined;
  });
  const { drugs, counts } = drugsOfClass(match, held);
  if (drugs.length === 0) return null;
  const available = drugs.flatMap((drug) => {
    const documentId = documentIds.get(drug.entry.id);
    return documentId === undefined ? [] : [{ documentId, ...drug }];
  });
  const found = available.slice(0, MAX_CLASS_DRUGS).map((drug) => ({
    documentId: drug.documentId,
    code: drug.code,
    registryCode: drug.registryCode,
  }));
  const groups = await atcResultGroups(found, input.readResults);
  if (groups.length === 0) return null;
  return {
    drugClass: {
      label: match.label,
      groups: match.groups.map((group) => ({
        code: group.code,
        name: group.name,
        drugCount: counts.get(group.code) ?? 0,
      })),
      drugCount: drugs.length,
      listed: groups.length,
    },
    groups,
  };
}

/** The response with the class's drugs in front of the text hits (a drug the text found too is listed once). */
export function withDrugClassGroups(input: {
  readonly response: SearchResponse;
  readonly found: DrugClassSearch | null;
  readonly index: QueryDocumentIndex;
  readonly limit: number;
}): SearchResponse {
  const { response, found, index } = input;
  if (!found) return response;
  // The class's drugs do not use up the caller's limit: the documents behind them still count.
  const merged = collapseGroupsByTargetDocument(
    [...found.groups, ...response.groups],
    index.byId,
  ).slice(0, input.limit + found.groups.length);
  return { ...response, groups: merged, drugClass: found.drugClass };
}
