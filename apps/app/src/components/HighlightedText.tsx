import type { TextRange } from '@localmed/contracts';
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

export function HighlightedText(props: HighlightedTextProps): JSX.Element {
  return (
    <For each={segments(props.text, props.ranges)}>
      {(segment) => (segment.highlighted ? <mark>{segment.text}</mark> : segment.text)}
    </For>
  );
}
