import type { TextRange } from '@localmed/contracts';

import { normalizeSurfaceText, normalizeSurfaceTextWithOffsets } from './normalize';

export interface SnippetResult {
  readonly text: string;
  readonly ranges: readonly TextRange[];
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

export function buildSnippet(
  originalText: string,
  terms: readonly string[],
  maxLength = 360,
): SnippetResult {
  const normalizedWithOffsets = normalizeSurfaceTextWithOffsets(originalText);
  const normalized = normalizedWithOffsets.text;
  const candidatePositions = terms
    .map((term) => {
      const position = normalized.indexOf(normalizeSurfaceText(term));
      return position >= 0 ? (normalizedWithOffsets.offsets[position]?.start ?? 0) : -1;
    })
    .filter((position) => position >= 0);
  const firstPosition = candidatePositions.length > 0 ? Math.min(...candidatePositions) : 0;
  const start = Math.max(0, firstPosition - Math.floor(maxLength / 3));
  const end = Math.min(originalText.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < originalText.length ? '…' : '';
  const body = originalText.slice(start, end);
  const text = `${prefix}${body}${suffix}`;
  const bodyOffset = prefix.length;
  const normalizedBodyWithOffsets = normalizeSurfaceTextWithOffsets(body);
  const normalizedBody = normalizedBodyWithOffsets.text;
  const ranges: TextRange[] = [];

  for (const term of terms) {
    const normalizedTerm = normalizeSurfaceText(term);
    if (normalizedTerm.length < 2) continue;
    let offset = 0;
    while (offset < normalizedBody.length) {
      const index = normalizedBody.indexOf(normalizedTerm, offset);
      if (index < 0) break;
      const firstOffset = normalizedBodyWithOffsets.offsets[index];
      const lastOffset = normalizedBodyWithOffsets.offsets[index + normalizedTerm.length - 1];
      if (firstOffset && lastOffset) {
        ranges.push({
          start: bodyOffset + firstOffset.start,
          end: bodyOffset + lastOffset.end,
        });
      }
      offset = index + normalizedTerm.length;
    }
  }

  return { text, ranges: mergeRanges(ranges) };
}
