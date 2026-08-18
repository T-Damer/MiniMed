import type { TextRange } from '@localmed/contracts';
import { For, type JSX } from 'solid-js';

import {
  exactQueryRanges,
  fuzzyQueryRanges,
  legacyQueryRanges,
} from '@/features/library/document-find';

export interface HighlightedTextProps {
  readonly text: string;
  readonly ranges: readonly TextRange[];
}

interface Segment {
  readonly text: string;
  readonly highlighted: boolean;
  readonly start?: number;
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
      const start = Math.max(cursor, range.start);
      output.push({
        text: text.slice(start, range.end),
        highlighted: true,
        start,
      });
      cursor = range.end;
    }
  }
  if (cursor < text.length) output.push({ text: text.slice(cursor), highlighted: false });
  return output;
}

function localRanges(
  ranges: readonly TextRange[],
  offset: number,
  length: number,
): readonly TextRange[] {
  return ranges.flatMap((range) => {
    const start = Math.max(0, range.start - offset);
    const end = Math.min(length, range.end - offset);
    return end > start ? [{ start, end }] : [];
  });
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
  readonly ranges?: readonly TextRange[] | undefined;
  readonly unitId?: string | undefined;
  readonly activeStart?: number | undefined;
  readonly rangeOffset?: number | undefined;
}): JSX.Element {
  const rangeOffset = () => props.rangeOffset ?? 0;
  const ranges = () => {
    if (props.ranges !== undefined) {
      return localRanges(props.ranges, rangeOffset(), props.text.length);
    }
    if (props.exact) return exactQueryRanges(props.text, props.query);
    if (props.fuzzy) return fuzzyQueryRanges(props.text, props.query);
    return legacyQueryRanges(props.text, props.query);
  };
  const queryKey = () => props.query.trim();
  const matchClass = () => props.matchClass ?? '';
  return (
    <For each={segments(props.text, ranges())}>
      {(segment) => {
        if (!segment.highlighted) return segment.text;
        const start = segment.start ?? 0;
        return (
          <mark
            class={matchClass()}
            classList={{
              [`${matchClass()}--current`]:
                props.activeStart !== undefined && start + rangeOffset() === props.activeStart,
            }}
            data-overlay-query={queryKey() || undefined}
            data-document-find-unit={props.unitId}
            data-document-find-start={start + rangeOffset()}
          >
            {segment.text}
          </mark>
        );
      }}
    </For>
  );
}
