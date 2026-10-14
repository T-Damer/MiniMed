import type { SearchResponse, SearchResultGroup } from '@localmed/contracts';
import { hasWordPrefix, normalizeSurfaceText } from '@localmed/search-lexical';

import type { QueryDocumentIndex } from './query-document-index';

const MIN_QUERY_WORD = 3;

function targetOf(group: SearchResultGroup, index: QueryDocumentIndex): string {
  const metadata = index.byId.get(group.documentId)?.metadata;
  const target = metadata?.['targetDocumentId'];
  return typeof target === 'string' ? target : group.documentId;
}

function isMedication(group: SearchResultGroup, index: QueryDocumentIndex): boolean {
  const metadata = index.byId.get(group.documentId)?.metadata;
  return group.documentKind === 'medication' || metadata?.['catalogFamily'] === 'medication';
}

/** True when the title carries a word that one of the typed words begins (the typed words name it). */
function titleNamesQuery(title: string, queryWords: readonly string[]): boolean {
  const normalized = normalizeSurfaceText(title);
  return queryWords.some((word) => hasWordPrefix(normalized, word));
}

/**
 * SRCH1 (QA 10-14: the «Препараты» scope returned homeopathic mixtures first for common queries):
 * homeopathic preparations — the mixtures with Latin component names — are cards whose only link
 * to the query is a component word («ртуть» in «РТУТЬ РАСТВОРИМАЯ ПО ГАННЕМАНУ»). When the query
 * also names an ordinary drug (a card that is not homeopathic and carries the typed word in its
 * title), the homeopathic cards go behind every ordinary drug card. They stay in the list and keep
 * their order; groups of other kinds do not move. Without an ordinary card that names the query
 * nothing changes, so «аконит» still lists its homeopathic cards first.
 */
export function demoteHomeopathicGroups(input: {
  readonly response: SearchResponse;
  /** Card ids (`esklp.mnn.<slug>`) of the homeopathic preparations. */
  readonly homeopathic: ReadonlySet<string>;
  readonly index: QueryDocumentIndex;
  readonly query: string;
}): SearchResponse {
  const { response, homeopathic, index } = input;
  if (homeopathic.size === 0) return response;
  const queryWords = (normalizeSurfaceText(input.query).match(/[0-9a-zа-я]+/gu) ?? []).filter(
    (word) => word.length >= MIN_QUERY_WORD,
  );
  if (queryWords.length === 0) return response;
  const slots: number[] = [];
  const medications: { group: SearchResultGroup; homeopathic: boolean }[] = [];
  response.groups.forEach((group, position) => {
    if (!isMedication(group, index)) return;
    slots.push(position);
    medications.push({ group, homeopathic: homeopathic.has(targetOf(group, index)) });
  });
  const ordinaryNamesQuery = medications.some(
    (entry) => !entry.homeopathic && titleNamesQuery(entry.group.title, queryWords),
  );
  const firstHomeopathic = medications.findIndex((entry) => entry.homeopathic);
  const lastOrdinary = medications.findLastIndex((entry) => !entry.homeopathic);
  if (!ordinaryNamesQuery || firstHomeopathic < 0 || firstHomeopathic > lastOrdinary) {
    return response;
  }
  const reordered = [
    ...medications.filter((entry) => !entry.homeopathic),
    ...medications.filter((entry) => entry.homeopathic),
  ];
  const groups = [...response.groups];
  slots.forEach((slot, position) => {
    const entry = reordered[position];
    if (entry) groups[slot] = entry.group;
  });
  return { ...response, groups };
}
