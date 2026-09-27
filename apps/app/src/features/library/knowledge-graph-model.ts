import type { MedicalDocumentSummary } from '@localmed/contracts';

/** Documents shown by default; the whole section is an explicit action. */
export const DEFAULT_GRAPH_DOCUMENT_LIMIT = 300;

export const OTHER_DOCUMENTS_DOMAIN = '__other_documents__';

export function graphDomains(document: MedicalDocumentSummary): readonly string[] {
  return document.specialties.length ? document.specialties : [OTHER_DOCUMENTS_DOMAIN];
}

export interface GraphSelection {
  readonly documents: readonly MedicalDocumentSummary[];
  /** Documents available in the current scope, for «показано N из M». */
  readonly total: number;
  /** True when the selection is centred on the current search results. */
  readonly focused: boolean;
}

/** Takes documents from each domain in turn so every area of the scope stays represented. */
function roundRobinByDomain(
  documents: readonly MedicalDocumentSummary[],
  domains: readonly string[],
  limit: number,
  taken: Set<string>,
  result: MedicalDocumentSummary[],
): void {
  const queues = new Map<string, MedicalDocumentSummary[]>(domains.map((domain) => [domain, []]));
  for (const document of documents) {
    if (taken.has(document.id)) continue;
    for (const domain of graphDomains(document)) {
      const queue = queues.get(domain);
      if (queue) {
        queue.push(document);
        break;
      }
    }
  }
  const cursors = new Map<string, number>();
  let progressed = true;
  while (result.length < limit && progressed) {
    progressed = false;
    for (const domain of domains) {
      if (result.length >= limit) break;
      const queue = queues.get(domain) ?? [];
      let cursor = cursors.get(domain) ?? 0;
      while (cursor < queue.length && taken.has(queue[cursor]?.id ?? '')) cursor += 1;
      const next = queue[cursor];
      cursors.set(domain, cursor + 1);
      if (!next) continue;
      taken.add(next.id);
      result.push(next);
      progressed = true;
    }
  }
}

/**
 * The neighbourhood shown by default: the current results plus their first-level neighbours
 * (documents sharing an area), or an area-balanced sample of the scope when nothing is searched.
 */
export function selectGraphNeighborhood(
  documents: readonly MedicalDocumentSummary[],
  options: { readonly focusIds?: ReadonlySet<string>; readonly limit?: number } = {},
): GraphSelection {
  const limit = Math.max(1, options.limit ?? DEFAULT_GRAPH_DOCUMENT_LIMIT);
  const focusIds = options.focusIds ?? new Set<string>();
  const focus = documents.filter((document) => focusIds.has(document.id));
  if (documents.length <= limit && focus.length === 0)
    return { documents, total: documents.length, focused: false };
  const taken = new Set<string>();
  const result: MedicalDocumentSummary[] = [];
  for (const document of focus.slice(0, limit)) {
    taken.add(document.id);
    result.push(document);
  }
  const domainOrder = [
    ...new Set((focus.length ? focus : documents).flatMap((document) => graphDomains(document))),
  ];
  roundRobinByDomain(documents, domainOrder, limit, taken, result);
  return { documents: result, total: documents.length, focused: focus.length > 0 };
}
