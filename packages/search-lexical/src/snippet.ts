import type { TextRange } from '@localmed/contracts';

import { stripKnownHtmlMarkup } from './html-markup';
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
  const readableText = stripKnownHtmlMarkup(originalText).replaceAll('**', '');
  const normalizedWithOffsets = normalizeSurfaceTextWithOffsets(readableText);
  const normalized = normalizedWithOffsets.text;
  const occurrences = terms.flatMap((term) => {
    const normalizedTerm = normalizeSurfaceText(term);
    if (normalizedTerm.length < 2) return [];
    const matches: {
      normalizedTerm: string;
      start: number;
      end: number;
      isExactKnownFieldValue: boolean;
      knownFieldStart: number | null;
    }[] = [];
    let offset = 0;
    while (offset < normalized.length) {
      const position = normalized.indexOf(normalizedTerm, offset);
      if (position < 0) break;
      const firstOffset = normalizedWithOffsets.offsets[position];
      const lastOffset = normalizedWithOffsets.offsets[position + normalizedTerm.length - 1];
      if (firstOffset && lastOffset) {
        const before = readableText.slice(0, firstOffset.start);
        const after = readableText.slice(lastOffset.end).replace(/^[ \t\r]+/u, '');
        const fieldMatch = /(?:^|[\s;])(?:тн|торговое\s+наименование)\s*:\s*$/iu.exec(before);
        const isExactKnownFieldValue =
          fieldMatch !== null && (after.length === 0 || /^[.;,\n]/u.test(after));
        matches.push({
          normalizedTerm,
          start: firstOffset.start,
          end: lastOffset.end,
          isExactKnownFieldValue,
          knownFieldStart: isExactKnownFieldValue ? fieldMatch.index : null,
        });
      }
      offset = position + normalizedTerm.length;
    }
    return matches;
  });
  const candidateStarts = new Set<number>([0]);
  for (const occurrence of occurrences) {
    candidateStarts.add(Math.max(0, occurrence.start - Math.floor(maxLength / 3)));
    candidateStarts.add(Math.max(0, occurrence.end - maxLength));
    candidateStarts.add(occurrence.start);
    if (occurrence.knownFieldStart !== null) candidateStarts.add(occurrence.knownFieldStart);
  }
  let start = 0;
  let bestTermCount = -1;
  let bestExactKnownFieldValueCount = -1;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const candidateStart of candidateStarts) {
    const boundedStart = Math.min(candidateStart, readableText.length);
    const candidateEnd = Math.min(readableText.length, boundedStart + maxLength);
    const inside = occurrences.filter(
      (occurrence) => occurrence.start >= boundedStart && occurrence.end <= candidateEnd,
    );
    const termCount = new Set(inside.map((occurrence) => occurrence.normalizedTerm)).size;
    const exactKnownFieldValueCount = inside.filter(
      (occurrence) => occurrence.isExactKnownFieldValue,
    ).length;
    const span =
      inside.length > 0
        ? Math.max(...inside.map((occurrence) => occurrence.end)) -
          Math.min(...inside.map((occurrence) => occurrence.start))
        : Number.POSITIVE_INFINITY;
    if (
      termCount > bestTermCount ||
      (termCount === bestTermCount &&
        (exactKnownFieldValueCount > bestExactKnownFieldValueCount ||
          (exactKnownFieldValueCount === bestExactKnownFieldValueCount &&
            (span < bestSpan || (span === bestSpan && boundedStart < start)))))
    ) {
      start = boundedStart;
      bestTermCount = termCount;
      bestExactKnownFieldValueCount = exactKnownFieldValueCount;
      bestSpan = span;
    }
  }
  const end = Math.min(readableText.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < readableText.length ? '…' : '';
  const body = readableText.slice(start, end);
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
