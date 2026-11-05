/**
 * Splits the text of a «Состав» section of a Russian instruction into component names, each with
 * its offsets in the input, so the reader can mark them. Heuristic by design: the texts are OCR
 * or PDF extractions with wrapped lines, inline amounts and nested bracket lists. Every item is
 * a candidate for `lookupCompoundByText`; unknown ones are simply not marked.
 */

export type CompositionRole = 'active' | 'excipient' | 'unknown';

export interface CompositionItem {
  /** The name as written, without amounts and labels. */
  readonly text: string;
  /** Offsets of `text` in the input. */
  readonly start: number;
  readonly end: number;
  readonly role: CompositionRole;
}

const WORD = '[\\p{L}-]*';
const SUBSTANCE = `(?:вещест${WORD}|компонент${WORD}|ингредиент${WORD})`;
const ACTIVE_LABEL = new RegExp(`(?:действующ${WORD}|активн${WORD})\\s+${SUBSTANCE}`, 'giu');
const EXCIPIENT_LABEL = new RegExp(
  `(?:вспомогательн${WORD}|прочи${WORD})\\s+${SUBSTANCE}` +
    `|состав\\s+(?:(?:пленочн|твердой|желатиновой|мягкой|кишечнорастворимой)${WORD}\\s+)?(?:оболочк|капсул|покрыти|ядр)${WORD}` +
    `|наполнител${WORD}`,
  'giu',
);
const END_MARKER = new RegExp(
  '(?<![\\p{L}])(?:внешний\\s+вид|описание|лекарственная\\s+форма|форма\\s+выпуска|категория\\s+отпуска' +
    '|фармакотерапевтическ|содержимое\\s+упаковки|показани|препарат\\s+\\p{L}+\\s+содержит' +
    '|упаковк|по\\s+\\d+\\s*(?:,|или|и|-)?\\s*\\d*\\s*(?:таблет|капсул|мл|шт|доз|ампул|флакон|пакет|суппозитор))',
  'iu',
);
/** A label is followed by «(ядро):», «являются:» or a colon before the list starts. */
const AFTER_LABEL = /^(?:\s*\([^()]*\))*\s*(?:являются|представлены|:|—|–)?\s*:?\s*/u;
const AMOUNT_START =
  /(?<![\p{L}\d])(?:до\s+)?\d+(?:[.,]\d+)?(?:\s*[-–/]\s*\d+(?:[.,]\d+)?)?\s*(?:мг|мкг|г|мл|л|%|ед|ме|ммоль|мэкв|мккат)(?![\p{L}])/iu;

interface Range {
  start: number;
  end: number;
}

function isDecimalComma(text: string, index: number): boolean {
  return /\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '');
}

/**
 * A blank line separates items in table-style extractions («лактозы моногидрат ¶ 124,500 мг ¶
 * гипромеллоза») but only wraps a line in running text («целлюлоза ¶ микрокристаллическая»). It is
 * a break when the next block is an amount alone or the previous block ends with one.
 */
function isItemBreak(text: string, from: number, index: number, to: number): boolean {
  const rest = text.slice(index + 1, to);
  const blank = /^[ \t\r]*\n/u.exec(rest);
  if (!blank) return false;
  const before = text.slice(from, index).trimEnd();
  if (/-$/u.test(before)) return false;
  const after = rest.slice(blank[0].length).trimStart();
  const nextBlock = /^[^\n]*/u.exec(after)?.[0] ?? '';
  const amountOnly = /^[\d\s.,/–-]+(?:мг|мкг|г|мл|л|%|ед|ме|ммоль)?[\s/\d.,мкгл%]*$/iu.test(
    nextBlock,
  );
  const endsWithAmount = /\d\s*(?:мг|мкг|г|мл|л|%|ед|ме|ммоль|мэкв)\s*$/iu.test(before);
  return amountOnly || endsWithAmount;
}

/** Splits `[from, to)` on top-level commas, semicolons, colons and blank lines. */
function splitRanges(text: string, from: number, to: number): { ranges: Range[]; nested: Range[] } {
  const ranges: Range[] = [];
  const nested: Range[] = [];
  let depth = 0;
  let segmentStart = from;
  let groupStart = -1;
  for (let index = from; index < to; index += 1) {
    const char = text[index] as string;
    if (char === '(') {
      if (depth === 0) groupStart = index;
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && groupStart >= 0) {
        const inner = text.slice(groupStart + 1, index);
        if (/[;,]/u.test(inner.replace(/\d,\d/gu, ''))) {
          nested.push({ start: groupStart + 1, end: index });
          // The bracket list is emitted on its own; the item keeps only what precedes it.
          ranges.push({ start: segmentStart, end: groupStart });
          segmentStart = index + 1;
        }
        groupStart = -1;
      }
    } else if (depth === 0) {
      const blankLine = char === '\n' && isItemBreak(text, from, index, to);
      const colon = char === ':';
      if (char === ';' || (char === ',' && !isDecimalComma(text, index)) || blankLine || colon) {
        ranges.push({ start: segmentStart, end: index });
        segmentStart = index + 1;
      }
    }
  }
  ranges.push({ start: segmentStart, end: to });
  return { ranges, nested };
}

function trimRange(text: string, range: Range): Range | undefined {
  let { start, end } = range;
  const edge = /[\s.,;:–—-]/u;
  while (start < end && edge.test(text[start] as string)) start += 1;
  while (end > start && edge.test(text[end - 1] as string)) end -= 1;
  return start < end ? { start, end } : undefined;
}

function cutAmount(text: string, range: Range): Range | undefined {
  const slice = text.slice(range.start, range.end);
  const match = AMOUNT_START.exec(slice);
  const cut = match && /\p{L}/u.test(slice.slice(0, match.index)) ? match.index : slice.length;
  return trimRange(text, { start: range.start, end: range.start + cut });
}

function collect(text: string, from: number, to: number, role: CompositionRole): CompositionItem[] {
  const { ranges, nested } = splitRanges(text, from, to);
  const items: CompositionItem[] = [];
  for (const range of ranges) {
    const trimmed = cutAmount(text, range);
    if (!trimmed) continue;
    const value = text.slice(trimmed.start, trimmed.end);
    if (!/\p{L}{3}/u.test(value) || value.length > 90) continue;
    items.push({ text: value, start: trimmed.start, end: trimmed.end, role });
  }
  for (const inner of nested) items.push(...collect(text, inner.start, inner.end, role));
  return items.sort((a, b) => a.start - b.start);
}

function labelPositions(text: string): { start: number; end: number; role: CompositionRole }[] {
  const labels: { start: number; end: number; role: CompositionRole }[] = [];
  for (const [pattern, role] of [
    [ACTIVE_LABEL, 'active'],
    [EXCIPIENT_LABEL, 'excipient'],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const after = AFTER_LABEL.exec(text.slice(match.index + match[0].length));
      const end = match.index + match[0].length + (after?.[0].length ?? 0);
      labels.push({ start: match.index, end, role });
    }
  }
  labels.sort((a, b) => a.start - b.start);
  // «Прочими ингредиентами (вспомогательными веществами)»: the inner label is part of the outer.
  return labels.filter((label, index) => {
    const previous = labels[index - 1];
    return !previous || label.start >= previous.end;
  });
}

/** Where the composition ends: the first stop word, or the first sentence end after the labels. */
function endOfComposition(text: string, from: number): number {
  const rest = text.slice(from);
  const marker = END_MARKER.exec(rest);
  let end = marker ? from + marker.index : text.length;
  const sentence = /\.(?=\s+[А-ЯЁA-Z])|\.\s*$/u.exec(text.slice(from, end));
  if (sentence) end = from + sentence.index;
  return end;
}

export function splitCompositionItems(text: string): CompositionItem[] {
  const items: CompositionItem[] = [];
  const labels = labelPositions(text);
  labels.forEach((label, index) => {
    const next = labels[index + 1];
    const end = Math.min(endOfComposition(text, label.end), next ? next.start : text.length);
    if (label.end >= end) return;
    items.push(...collect(text, label.end, end, label.role));
  });
  return items;
}
