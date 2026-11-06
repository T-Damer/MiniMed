import type { MedicalDocumentSummary } from '@localmed/contracts';

import { displayDocumentTitle } from '@/features/library/document-display';

/**
 * Keyword → documents, built on the device from the titles the app already holds (no download,
 * nothing stored). A submitted query shows the documents whose names carry its words at once,
 * while the full-text search over every installed database still runs (owner 2026-11-06: «Везде»
 * took ~3 s with nothing on screen). Compact: one sorted word list and one array of document
 * numbers per word, ≈1–2 MB for 57 000 titles (`stats`).
 */
export interface TitleIndexStats {
  readonly documents: number;
  readonly words: number;
  readonly postings: number;
  /** Approximate memory: word characters (UTF-16) + 4 bytes per posting and per word offset. */
  readonly bytes: number;
  readonly buildMs: number;
}

export interface TitleIndex {
  /** Documents whose title holds every query word (a word may be the start of a title word). */
  lookup(
    query: string,
    limit: number,
    accept?: (document: MedicalDocumentSummary) => boolean,
  ): readonly MedicalDocumentSummary[];
  readonly stats: TitleIndexStats;
}

const WORD = /[\p{L}\p{N}]+/gu;
/** Shorter query words match too much to be instant answers («в», «и»). */
const MIN_QUERY_WORD = 3;
/** A query of more words is a sentence: the full-text search answers it. */
const MAX_QUERY_WORDS = 3;

function fold(text: string): string {
  return text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function titleWords(text: string): readonly string[] {
  return fold(text).match(WORD) ?? [];
}

function lowerBound(words: readonly string[], value: string): number {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((words[middle] ?? '') < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function buildTitleIndex(documents: readonly MedicalDocumentSummary[]): TitleIndex {
  const startedAt = performance.now();
  const titles = documents.map((document) => fold(displayDocumentTitle(document)).trim());
  // A module pointer whose document is installed is the same answer twice: the document stays.
  const ids = new Set(documents.map((document) => document.id));
  const installedPointer = documents.map((document) => {
    const target = document.metadata?.['targetDocumentId'];
    return typeof target === 'string' && ids.has(target);
  });
  const byWord = new Map<string, number[]>();
  titles.forEach((title, index) => {
    for (const word of new Set(title.match(WORD) ?? [])) {
      if (word.length < 2) continue;
      const list = byWord.get(word);
      if (list) list.push(index);
      else byWord.set(word, [index]);
    }
  });
  const words = [...byWord.keys()].toSorted();
  const offsets = new Uint32Array(words.length + 1);
  let total = 0;
  words.forEach((word, index) => {
    offsets[index] = total;
    total += byWord.get(word)?.length ?? 0;
  });
  offsets[words.length] = total;
  const postings = new Uint32Array(total);
  words.forEach((word, index) => {
    postings.set(byWord.get(word) ?? [], offsets[index] ?? 0);
  });
  let characters = 0;
  for (const word of words) characters += word.length;

  /** Documents with a title word that starts with `prefix`. */
  const matching = (prefix: string): Set<number> => {
    const found = new Set<number>();
    for (let index = lowerBound(words, prefix); index < words.length; index += 1) {
      if (!(words[index] ?? '').startsWith(prefix)) break;
      const end = offsets[index + 1] ?? 0;
      for (let at = offsets[index] ?? 0; at < end; at += 1) found.add(postings[at] ?? 0);
    }
    return found;
  };

  return {
    stats: {
      documents: documents.length,
      words: words.length,
      postings: total,
      bytes: characters * 2 + total * 4 + offsets.length * 4,
      buildMs: Math.round(performance.now() - startedAt),
    },
    lookup(query, limit, accept) {
      const queryWords = [...new Set(titleWords(query))];
      if (
        queryWords.length === 0 ||
        queryWords.length > MAX_QUERY_WORDS ||
        queryWords.some((word) => word.length < MIN_QUERY_WORD)
      ) {
        return [];
      }
      let candidates: Set<number> | undefined;
      for (const word of queryWords.toSorted((left, right) => right.length - left.length)) {
        const found = matching(word);
        candidates = candidates
          ? new Set([...candidates].filter((index) => found.has(index)))
          : found;
        if (candidates.size === 0) return [];
      }
      const phrase = queryWords.join(' ');
      const rank = (index: number): number => {
        const title = titles[index] ?? '';
        const words: readonly string[] = title.match(WORD) ?? [];
        if (words.join(' ') === phrase) return 0;
        if (title.startsWith(phrase)) return 1;
        if (queryWords.every((word) => words.includes(word))) return 2;
        return 3;
      };
      return [...(candidates ?? [])]
        .map((index) => ({ index, rank: rank(index) }))
        .filter(({ index }) => {
          const document = documents[index];
          return (
            document !== undefined && !installedPointer[index] && (!accept || accept(document))
          );
        })
        .toSorted(
          (left, right) =>
            left.rank - right.rank ||
            (titles[left.index]?.length ?? 0) - (titles[right.index]?.length ?? 0) ||
            left.index - right.index,
        )
        .slice(0, limit)
        .map(({ index }) => documents[index] as MedicalDocumentSummary);
    },
  };
}

const built = new WeakMap<readonly MedicalDocumentSummary[], TitleIndex>();

/** One index per document list: the search screens share it. */
export function titleIndexFor(documents: readonly MedicalDocumentSummary[]): TitleIndex {
  let index = built.get(documents);
  if (!index) {
    index = buildTitleIndex(documents);
    built.set(documents, index);
  }
  return index;
}
