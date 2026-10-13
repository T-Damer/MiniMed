/**
 * Text-quote anchors in the manner of the W3C Web Annotation `TextQuoteSelector` (exact quote plus
 * the text just before and after it), and the search that finds a quote again in another edition
 * of a document: verbatim, then after folding away typography, then by edit distance, anywhere in
 * the document and not only near the old position.
 *
 * Pure text in, offsets out: no DOM, no storage. Readers feed it their text units (a КР chunk, a
 * text page, a PDF page), so one engine serves HTML, Markdown, plain text and the PDF text layer.
 */

import {
  ALIGN_PATTERN_LIMIT,
  type ApproximateMatch,
  alignPattern,
  candidateWindows,
} from '@/features/anchoring/approximate-search';
import { type FoldedText, foldedString, foldText } from '@/features/anchoring/text-fold';

export interface TextQuoteSelector {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
  /** Last characters of a selection so long that `exact` holds only its beginning. */
  readonly tail?: string;
}

export interface AnchorUnit {
  readonly id: string;
  readonly text: string;
}

export interface AnchorSegment {
  readonly unitId: string;
  /** Offsets inside the unit's text. */
  readonly start: number;
  readonly end: number;
}

/** Where the quote used to be: its unit and offsets, when the old text had them. */
export interface AnchorHint {
  readonly unitId?: string | undefined;
  readonly start?: number | undefined;
}

export type AnchorMethod = 'exact' | 'normalised' | 'fuzzy';
/** `exact` — same text, same place; `moved` — same words elsewhere; `approximate` — reworded. */
export type AnchorMatchStatus = 'exact' | 'moved' | 'approximate';

export interface AnchorMatch {
  readonly status: AnchorMatchStatus;
  readonly method: AnchorMethod;
  /** 0..1 confidence: how close the text is, weighed with how well its surroundings agree. */
  readonly score: number;
  /** The located text, one segment per unit it covers (a reflowed paragraph may span two). */
  readonly segments: readonly AnchorSegment[];
}

export const SELECTOR_EXACT_LIMIT = 2000;
export const SELECTOR_TAIL_LENGTH = 300;
export const SELECTOR_CONTEXT_LENGTH = 80;
/** Characters of context compared when scoring a candidate. */
const CONTEXT_COMPARE_LENGTH = 48;
const MIN_FUZZY_LENGTH = 14;
/** Shortest paragraph-local context compared on its own. */
const LOCAL_CONTEXT_MIN = 10;
const MAX_EXACT_HITS = 300;
const MAX_ENDS_CANDIDATES = 5;

/** The selector of `text[start, end)`; `before` / `after` extend its context into the neighbours. */
export function createQuoteSelector(
  text: string,
  start: number,
  end: number,
  neighbours: { readonly before?: string; readonly after?: string } = {},
): TextQuoteSelector {
  const raw = text.slice(start, end);
  const prefix = `${neighbours.before ?? ''}${text.slice(0, start)}`.slice(
    -SELECTOR_CONTEXT_LENGTH,
  );
  const suffix = `${text.slice(end)}${neighbours.after ?? ''}`.slice(0, SELECTOR_CONTEXT_LENGTH);
  if (raw.length <= SELECTOR_EXACT_LIMIT) return { exact: raw, prefix, suffix };
  return {
    exact: raw.slice(0, SELECTOR_EXACT_LIMIT),
    prefix,
    suffix,
    tail: raw.slice(-SELECTOR_TAIL_LENGTH),
  };
}

/** Units folded and joined by single spaces, with the maps back to each unit's original text. */
export class AnchorDocument {
  readonly units: readonly AnchorUnit[];
  /** All units' folded text, separated by one space. */
  readonly folded: string;
  private readonly foldedUnits: readonly FoldedText[];
  /** Offset of each unit in `folded`; -1 for a unit with no foldable text. */
  private readonly unitStarts: readonly number[];
  private readonly indexById = new Map<string, number>();

  constructor(units: readonly AnchorUnit[]) {
    this.units = units;
    const foldedUnits: FoldedText[] = [];
    const unitStarts: number[] = [];
    const parts: string[] = [];
    let length = 0;
    units.forEach((unit, index) => {
      this.indexById.set(unit.id, index);
      const folded = foldText(unit.text);
      foldedUnits.push(folded);
      if (folded.text.length === 0) {
        unitStarts.push(-1);
        return;
      }
      if (parts.length > 0) {
        parts.push(' ');
        length += 1;
      }
      unitStarts.push(length);
      parts.push(folded.text);
      length += folded.text.length;
    });
    this.foldedUnits = foldedUnits;
    this.unitStarts = unitStarts;
    this.folded = parts.join('');
  }

  unitIndex(id: string): number | undefined {
    return this.indexById.get(id);
  }

  unitText(id: string): string | undefined {
    const index = this.indexById.get(id);
    return index === undefined ? undefined : this.units[index]?.text;
  }

  /** Folded range of the unit that holds folded offset `position`. */
  unitBounds(position: number): { readonly start: number; readonly end: number } {
    let low = 0;
    let high = this.unitStarts.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      // Units without text have no start; step over them towards the next unit that has one.
      let probe = middle;
      while (probe <= high && (this.unitStarts[probe] ?? -1) < 0) probe += 1;
      if (probe > high) {
        high = middle - 1;
        continue;
      }
      if ((this.unitStarts[probe] ?? 0) <= position) {
        found = probe;
        low = probe + 1;
      } else {
        high = middle - 1;
      }
    }
    const start = found < 0 ? 0 : (this.unitStarts[found] ?? 0);
    const end =
      found < 0 ? this.folded.length : start + (this.foldedUnits[found]?.text.length ?? 0);
    return { start, end };
  }

  /** The units covered by folded range `[from, to)`, with original offsets. */
  segmentsFor(from: number, to: number): readonly AnchorSegment[] {
    const segments: AnchorSegment[] = [];
    this.units.forEach((unit, index) => {
      const base = this.unitStarts[index] ?? -1;
      const folded = this.foldedUnits[index];
      if (base < 0 || !folded) return;
      const localFrom = Math.max(from, base) - base;
      const localTo = Math.min(to, base + folded.text.length) - base;
      if (localTo <= localFrom) return;
      segments.push({
        unitId: unit.id,
        start: folded.starts[localFrom] ?? 0,
        end: folded.ends[localTo - 1] ?? 0,
      });
    });
    return segments;
  }
}

/** Distance of two short strings as a similarity in 0..1. */
function similarity(left: string, right: string): number {
  if (left.length === 0 && right.length === 0) return 1;
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j] ?? 0;
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return 1 - (previous[right.length] ?? longest) / longest;
}

interface Candidate {
  readonly from: number;
  readonly to: number;
  readonly errors: number;
  readonly rate: number;
  /** Combined ranking value, higher is better. */
  readonly rank: number;
  readonly context: number;
}

interface Prepared {
  readonly document: AnchorDocument;
  readonly selector: TextQuoteSelector;
  readonly hint: AnchorHint | undefined;
  readonly pattern: string;
  readonly prefix: string;
  readonly suffix: string;
}

function contextScore(prepared: Prepared, from: number, to: number): number {
  const { prefix, suffix, document } = prepared;
  if (prefix.length === 0 && suffix.length === 0) return 0.5;
  const bounds = document.unitBounds(from);
  const parts: number[] = [];
  if (prefix.length > 0) {
    // The quote usually starts a word (a space before it), but a selection may start inside one.
    const spaced = document.folded.slice(
      Math.max(0, from - 1 - prefix.length),
      Math.max(0, from - 1),
    );
    const glued = document.folded.slice(Math.max(0, from - prefix.length), from);
    let value = Math.max(similarity(prefix, spaced), similarity(prefix, glued));
    // Neighbouring units may have been reordered; the paragraph's own words still tell.
    const own = Math.min(prefix.length, Math.max(0, from - bounds.start));
    if (own >= LOCAL_CONTEXT_MIN && own < prefix.length) {
      value = Math.max(
        value,
        similarity(prefix.slice(-own), document.folded.slice(from - own, from)),
      );
    } else if (own >= LOCAL_CONTEXT_MIN) {
      value = Math.max(value, similarity(prefix, document.folded.slice(from - own, from)));
    }
    parts.push(value);
  }
  if (suffix.length > 0) {
    const spaced = document.folded.slice(to + 1, to + 1 + suffix.length);
    const glued = document.folded.slice(to, to + suffix.length);
    let value = Math.max(similarity(suffix, spaced), similarity(suffix, glued));
    const own = Math.min(suffix.length, Math.max(0, bounds.end - to));
    if (own >= LOCAL_CONTEXT_MIN) {
      value = Math.max(
        value,
        similarity(suffix.slice(0, own), document.folded.slice(to, to + own)),
      );
    }
    parts.push(value);
  }
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

/** 1 for the old position, falling off with the distance in units and characters. */
function proximity(prepared: Prepared, from: number): number {
  const { hint, document } = prepared;
  if (!hint?.unitId) return 0.5;
  const hintIndex = document.unitIndex(hint.unitId);
  if (hintIndex === undefined) return 0.3;
  const segment = document.segmentsFor(from, from + 1)[0];
  if (!segment) return 0;
  const index = document.unitIndex(segment.unitId) ?? hintIndex;
  if (index === hintIndex) {
    return hint.start === undefined ? 1 : 1 / (1 + Math.abs(segment.start - hint.start) / 600);
  }
  return 0.6 / (1 + Math.abs(index - hintIndex) / 6);
}

function rankCandidate(
  prepared: Prepared,
  from: number,
  to: number,
  errors: number,
  length: number,
): Candidate {
  const rate = length === 0 ? 1 : errors / length;
  const context = contextScore(prepared, from, to);
  const near = proximity(prepared, from);
  return {
    from,
    to,
    errors,
    rate,
    context,
    rank: context * 0.5 + near * 0.2 + (1 - Math.min(1, rate * 2)) * 0.3,
  };
}

function exactCandidates(prepared: Prepared, pattern: string, after = 0): readonly Candidate[] {
  const found: Candidate[] = [];
  let position = prepared.document.folded.indexOf(pattern, after);
  while (position >= 0 && found.length < MAX_EXACT_HITS) {
    found.push(rankCandidate(prepared, position, position + pattern.length, 0, pattern.length));
    position = prepared.document.folded.indexOf(pattern, position + 1);
  }
  return found;
}

/** Edit distance, as a share of the quote, accepted without / with agreeing context. */
function rateLimits(length: number): { readonly plain: number; readonly withContext: number } {
  return length < 40 ? { plain: 0.15, withContext: 0.22 } : { plain: 0.3, withContext: 0.4 };
}

function fuzzyCandidates(
  prepared: Prepared,
  pattern: string,
  fixedRate?: number,
): readonly Candidate[] {
  if (pattern.length < MIN_FUZZY_LENGTH) return [];
  const limits = rateLimits(pattern.length);
  const ceiling = fixedRate ?? limits.withContext;
  const maxErrors = Math.floor(pattern.length * ceiling);
  if (maxErrors <= 0) return [];
  const found: Candidate[] = [];
  for (const window of candidateWindows(pattern, prepared.document.folded)) {
    const match: ApproximateMatch | null = alignPattern(
      pattern,
      prepared.document.folded,
      window.from,
      window.to,
      maxErrors,
    );
    if (!match || match.end <= match.start) continue;
    const candidate = rankCandidate(prepared, match.start, match.end, match.errors, pattern.length);
    // More rewording is believed only when the words around the quote agree.
    if (fixedRate === undefined && candidate.rate > limits.plain && candidate.context < 0.7)
      continue;
    found.push(candidate);
  }
  return found;
}

function best(candidates: readonly Candidate[]): Candidate | undefined {
  return candidates.reduce<Candidate | undefined>(
    (top, candidate) => (!top || candidate.rank > top.rank ? candidate : top),
    undefined,
  );
}

function bestTwo(
  candidates: readonly Candidate[],
): readonly [Candidate | undefined, Candidate | undefined] {
  const sorted = candidates.toSorted((left, right) => right.rank - left.rank);
  return [sorted[0], sorted[1]];
}

interface QuoteEnds {
  readonly head: string;
  readonly tail: string;
}

/**
 * The text at the two ends of a long (or interrupted) quote, at a few sizes: the shorter the end,
 * the less likely an inserted sentence reaches into it.
 */
function quoteEnds(pattern: string, selector: TextQuoteSelector): readonly QuoteEnds[] {
  const wide = Math.min(260, Math.max(30, Math.floor(pattern.length * 0.35)));
  const tailSource = selector.tail ? foldedString(selector.tail) : '';
  const result: QuoteEnds[] = [];
  for (const size of new Set([wide, 32])) {
    if (pattern.length < size * 2 && tailSource.length === 0) continue;
    let head = pattern.slice(0, size);
    if (size < pattern.length && head.includes(' ')) head = head.slice(0, head.lastIndexOf(' '));
    let tail = tailSource.length > 0 ? tailSource.slice(-size) : pattern.slice(-size);
    if (tail.includes(' ') && tail.length === size) tail = tail.slice(tail.indexOf(' ') + 1);
    if (head.length >= 20 && tail.length >= 20) result.push({ head, tail });
  }
  return result;
}

function locateEndsWith(prepared: Prepared, ends: QuoteEnds): Candidate | undefined {
  const { pattern, selector, document } = prepared;
  const headCandidates = bestN(
    [...exactCandidates(prepared, ends.head), ...fuzzyCandidates(prepared, ends.head, 0.2)],
    MAX_ENDS_CANDIDATES,
  );
  // A long selection keeps only its beginning and end, so its true length is not known.
  const expected = selector.tail ? undefined : pattern.length;
  for (const head of headCandidates) {
    const reach = Math.min(
      document.folded.length,
      head.from + (expected === undefined ? 40000 : Math.max(expected * 3, 600)),
    );
    const exactTail = document.folded.indexOf(ends.tail, head.to);
    let tailEnd = -1;
    let tailErrors = 0;
    if (exactTail >= 0 && exactTail + ends.tail.length <= reach) {
      tailEnd = exactTail + ends.tail.length;
    } else {
      const match = alignPattern(
        ends.tail,
        document.folded,
        head.to,
        reach,
        Math.floor(ends.tail.length * 0.2),
      );
      if (match) {
        tailEnd = match.end;
        tailErrors = match.errors;
      }
    }
    if (tailEnd < 0) continue;
    const length = tailEnd - head.from;
    if (expected !== undefined && length < expected * 0.4) continue;
    // Only the ends are compared, so the share of errors is theirs; the middle is not checked.
    return rankCandidate(
      prepared,
      head.from,
      tailEnd,
      head.errors + tailErrors,
      ends.head.length + ends.tail.length,
    );
  }
  return undefined;
}

function locateEnds(prepared: Prepared): Candidate | undefined {
  for (const ends of quoteEnds(prepared.pattern, prepared.selector)) {
    const found = locateEndsWith(prepared, ends);
    if (found) return found;
  }
  return undefined;
}

function bestN(candidates: readonly Candidate[], count: number): readonly Candidate[] {
  return candidates.toSorted((left, right) => right.rank - left.rank).slice(0, count);
}

function extendByPunctuation(
  unitText: string,
  start: number,
  end: number,
  exact: string,
): { readonly start: number; readonly end: number } {
  let from = start;
  let to = end;
  const lead = /^[^\p{L}\p{N}]*/u.exec(exact)?.[0] ?? '';
  for (const candidate of [lead, lead.trimStart()]) {
    if (
      candidate &&
      from >= candidate.length &&
      unitText.slice(from - candidate.length, from) === candidate
    ) {
      from -= candidate.length;
      break;
    }
  }
  const trail = /[^\p{L}\p{N}]*$/u.exec(exact)?.[0] ?? '';
  for (const candidate of [trail, trail.trimEnd()]) {
    if (candidate && unitText.startsWith(candidate, to)) {
      to += candidate.length;
      break;
    }
  }
  return { start: from, end: to };
}

/**
 * Finds `selector` in `document`. `null` when no place in the document carries the quote closely
 * enough: the caller keeps the old anchor and says so instead of guessing.
 */
export function locateQuote(
  document: AnchorDocument,
  selector: TextQuoteSelector,
  hint?: AnchorHint,
): AnchorMatch | null {
  const pattern = foldedString(selector.exact);
  if (pattern.length === 0) return null;
  const prepared: Prepared = {
    document,
    selector,
    hint,
    pattern,
    prefix: foldedString(selector.prefix).slice(-CONTEXT_COMPARE_LENGTH),
    suffix: foldedString(selector.suffix).slice(0, CONTEXT_COMPARE_LENGTH),
  };

  let method: AnchorMethod = 'normalised';
  let chosen: Candidate | undefined;
  let ambiguous = false;
  const whole = selector.tail ? [] : exactCandidates(prepared, pattern);
  if (whole.length > 0) {
    const [first, second] = bestTwo(whole);
    chosen = first;
    ambiguous =
      second !== undefined &&
      first !== undefined &&
      first.rank - second.rank < 0.06 &&
      first.context < 0.6;
  } else {
    method = 'fuzzy';
    if (pattern.length <= ALIGN_PATTERN_LIMIT && !selector.tail) {
      chosen = best(fuzzyCandidates(prepared, pattern));
    }
    // A rough or short whole-quote alignment may have lost the end of the quote (a sentence was
    // inserted inside it): the two ends then tell the true extent.
    if (pattern.length >= 60 && (!chosen || chosen.rate > 0.12)) {
      const ends = locateEnds(prepared);
      if (
        ends &&
        (!chosen || ends.to - ends.from > chosen.to - chosen.from + pattern.length * 0.1)
      ) {
        chosen = ends;
      }
    }
  }
  if (!chosen) return null;

  const raw = document.segmentsFor(chosen.from, chosen.to);
  if (raw.length === 0) return null;
  // Take the quote's own leading and trailing marks along when the page still has them.
  const segments = raw.map((segment, index) => {
    const unitText = document.unitText(segment.unitId) ?? '';
    if (raw.length > 1 || method === 'fuzzy') return segment;
    const extended = extendByPunctuation(unitText, segment.start, segment.end, selector.exact);
    return index === 0 ? { ...segment, ...extended } : segment;
  });
  const first = segments[0];
  if (!first) return null;
  const unitText = document.unitText(first.unitId) ?? '';
  const verbatim =
    method !== 'fuzzy' &&
    segments.length === 1 &&
    unitText.slice(first.start, first.end) === selector.exact;
  const samePlace =
    segments.length === 1 && hint?.unitId === first.unitId && hint.start === first.start;
  if (verbatim) method = 'exact';

  let status: AnchorMatchStatus;
  if (method === 'fuzzy' || ambiguous) status = 'approximate';
  else if (verbatim && samePlace) status = 'exact';
  else status = 'moved';

  const quality = method === 'fuzzy' ? 1 - Math.min(1, chosen.rate) : 1;
  // Reworded text is never as sure as the same words: its score stays below 0.9.
  const ceiling = method === 'fuzzy' ? 0.9 : 1;
  const score = Math.max(
    0,
    Math.min(ceiling, quality * (0.7 + 0.3 * chosen.context) - (ambiguous ? 0.2 : 0)),
  );
  return { status, method, score, segments };
}

/** The text a segment covers. */
export function segmentText(document: AnchorDocument, segment: AnchorSegment): string {
  return (document.unitText(segment.unitId) ?? '').slice(segment.start, segment.end);
}
