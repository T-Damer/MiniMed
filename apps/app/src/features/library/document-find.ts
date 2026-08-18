import type { TextRange } from '@localmed/contracts';
import {
  buildSnippet,
  isCloseToken,
  MIN_FUZZY_TOKEN_LENGTH,
  normalizeSurfaceText,
  normalizeSurfaceTextWithOffsets,
} from '@localmed/search-lexical';

export const DOCUMENT_FIND_DEBOUNCE_MS = 250;
export const DOCUMENT_FIND_DISMISS_EVENT = 'document-find-dismiss';

export type DocumentFindMode = 'exact' | 'similar';

export interface DocumentFindUnit {
  readonly id: string;
  readonly text: string;
}

export interface DocumentFindMatch {
  readonly unitId: string;
  readonly start: number;
  readonly end: number;
}

function mergeRanges(ranges: readonly TextRange[]): readonly TextRange[] {
  const sorted = ranges.toSorted((left, right) => left.start - right.start);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function queryTokens(query: string): readonly string[] {
  return normalizeSurfaceText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function tokenMatches(queryToken: string, hayToken: string): boolean {
  if (hayToken.includes(queryToken) || (queryToken.length >= 3 && queryToken.includes(hayToken))) {
    return true;
  }
  if (queryToken.length < MIN_FUZZY_TOKEN_LENGTH && hayToken.length < MIN_FUZZY_TOKEN_LENGTH) {
    return queryToken === hayToken;
  }
  return isCloseToken(queryToken, hayToken);
}

export function fuzzyQueryRanges(text: string, query: string): readonly TextRange[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const normalizedWithOffsets = normalizeSurfaceTextWithOffsets(text);
  const normalized = normalizedWithOffsets.text;
  const ranges: TextRange[] = [];

  for (const queryToken of tokens) {
    let cursor = 0;
    while (cursor < normalized.length) {
      const index = normalized.indexOf(queryToken, cursor);
      if (index < 0) break;
      const firstOffset = normalizedWithOffsets.offsets[index];
      const lastOffset = normalizedWithOffsets.offsets[index + queryToken.length - 1];
      if (firstOffset && lastOffset) {
        ranges.push({ start: firstOffset.start, end: lastOffset.end });
      }
      cursor = index + queryToken.length;
    }
  }

  const wordPattern = /[\p{L}\p{N}-]+/gu;
  for (const match of text.matchAll(wordPattern)) {
    const word = match[0];
    const start = match.index ?? 0;
    const normalizedWord = normalizeSurfaceText(word);
    if (!tokens.some((queryToken) => tokenMatches(queryToken, normalizedWord))) continue;
    ranges.push({ start, end: start + word.length });
  }

  return mergeRanges(ranges);
}

export function exactQueryRanges(text: string, query: string): readonly TextRange[] {
  const normalizedText = text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const normalizedQuery = query.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
  if (!normalizedQuery) return [];
  const ranges: TextRange[] = [];
  let cursor = 0;
  while (cursor < normalizedText.length) {
    const start = normalizedText.indexOf(normalizedQuery, cursor);
    if (start < 0) break;
    ranges.push({ start, end: start + normalizedQuery.length });
    cursor = start + normalizedQuery.length;
  }
  return ranges;
}

export function findRangesInText(
  text: string,
  query: string,
  mode: DocumentFindMode,
): readonly TextRange[] {
  if (mode === 'exact') return exactQueryRanges(text, query);
  return fuzzyQueryRanges(text, query);
}

export function findInUnits(
  units: readonly DocumentFindUnit[],
  query: string,
  mode: DocumentFindMode,
): readonly DocumentFindMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const matches: DocumentFindMatch[] = [];
  for (const unit of units) {
    const ranges = findRangesInText(unit.text, trimmed, mode);
    for (const range of ranges) {
      matches.push({ unitId: unit.id, start: range.start, end: range.end });
    }
  }
  return matches;
}

export function stepDocumentFindIndex(index: number, count: number, delta: number): number {
  if (count === 0) return 0;
  const next = (index + delta) % count;
  return next < 0 ? next + count : next;
}

export function rangesForFindUnit(
  rangesByUnit: ReadonlyMap<string, readonly TextRange[]>,
  unitId: string,
  query: string,
): readonly TextRange[] | undefined {
  if (!query.trim()) return undefined;
  return rangesByUnit.get(unitId) ?? [];
}

export function dismissOpenDocumentFind(root: ParentNode): boolean {
  const open = root.querySelector('.document-find--open');
  if (!open) return false;
  open.dispatchEvent(new Event(DOCUMENT_FIND_DISMISS_EVENT));
  return true;
}

export function legacyQueryRanges(text: string, query: string): readonly TextRange[] {
  const phrase = query.trim();
  if (!phrase) return [];
  const terms = [phrase, ...phrase.split(/[^\p{L}\p{N}-]+/gu).filter((term) => term.length >= 2)];
  return buildSnippet(text, terms, Number.MAX_SAFE_INTEGER).ranges;
}
