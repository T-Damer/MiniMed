import type { TextRange } from '@localmed/contracts';
import {
  buildSnippet,
  isCloseToken,
  MIN_FUZZY_TOKEN_LENGTH,
  normalizeSurfaceText,
  normalizeSurfaceTextWithOffsets,
} from '@localmed/search-lexical';
import { For, type JSX } from 'solid-js';

export interface HighlightedTextProps {
  readonly text: string;
  readonly ranges: readonly TextRange[];
}

interface Segment {
  readonly text: string;
  readonly highlighted: boolean;
}

function segments(text: string, ranges: readonly TextRange[]): readonly Segment[] {
  const valid = ranges
    .filter((range) => range.start >= 0 && range.end > range.start && range.start < text.length)
    .map((range) => ({ start: range.start, end: Math.min(range.end, text.length) }))
    .toSorted((left, right) => left.start - right.start);
  const output: Segment[] = [];
  let cursor = 0;
  for (const range of valid) {
    if (range.start > cursor)
      output.push({ text: text.slice(cursor, range.start), highlighted: false });
    if (range.end > cursor) {
      output.push({
        text: text.slice(Math.max(cursor, range.start), range.end),
        highlighted: true,
      });
      cursor = range.end;
    }
  }
  if (cursor < text.length) output.push({ text: text.slice(cursor), highlighted: false });
  return output;
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

function fuzzyQueryRanges(text: string, query: string): readonly TextRange[] {
  const normalizedWithOffsets = normalizeSurfaceTextWithOffsets(text);
  const normalized = normalizedWithOffsets.text;
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
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

    const wordPattern = /[\p{L}\p{N}-]+/gu;
    for (const match of text.matchAll(wordPattern)) {
      const word = match[0];
      const start = match.index ?? 0;
      const normalizedWord = normalizeSurfaceText(word);
      if (!tokenMatches(queryToken, normalizedWord)) continue;
      ranges.push({ start, end: start + word.length });
    }
  }

  return mergeRanges(ranges);
}

function exactQueryRanges(text: string, query: string): readonly TextRange[] {
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

export function HighlightedText(props: HighlightedTextProps): JSX.Element {
  return (
    <For each={segments(props.text, props.ranges)}>
      {(segment) => (segment.highlighted ? <mark>{segment.text}</mark> : segment.text)}
    </For>
  );
}

export function QueryHighlightedText(props: {
  readonly text: string;
  readonly query: string;
  readonly exact?: boolean | undefined;
  readonly fuzzy?: boolean | undefined;
  readonly matchClass?: string | undefined;
}): JSX.Element {
  const ranges = () => {
    if (props.exact) return exactQueryRanges(props.text, props.query);
    if (props.fuzzy) return fuzzyQueryRanges(props.text, props.query);
    const phrase = props.query.trim();
    if (!phrase) return [];
    const terms = [phrase, ...phrase.split(/[^\p{L}\p{N}-]+/gu).filter((term) => term.length >= 2)];
    return buildSnippet(props.text, terms, Number.MAX_SAFE_INTEGER).ranges;
  };
  const queryKey = () => props.query.trim();
  return (
    <For each={segments(props.text, ranges())}>
      {(segment) =>
        segment.highlighted ? (
          <mark class={props.matchClass} data-overlay-query={queryKey() || undefined}>
            {segment.text}
          </mark>
        ) : (
          segment.text
        )
      }
    </For>
  );
}
