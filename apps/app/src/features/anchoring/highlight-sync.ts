/**
 * Keeps a document's highlights attached to its text when the text changes.
 *
 * Opening a document (a КР edition, a user file replaced by a newer one, a re-extracted PDF) runs
 * `syncHighlights` over the text units the reader shows:
 *
 * - a highlight whose saved quote still sits at its saved place is left alone (its text-quote
 *   selector only gains the surrounding context if a record from before selectors lacks it);
 * - one whose text moved is re-anchored by its selector (`locateQuote`: verbatim, folded, fuzzy,
 *   anywhere in the document) and saved with a status — `moved` or `approximate`;
 * - one the new text no longer contains is kept as `missing` with its old position, never dropped;
 * - highlights of earlier editions of the same document (`predecessors`, nearest first) are carried
 *   into this one as separate records that remember where they came from; the old edition keeps
 *   its own, untouched.
 *
 * Pure: records and text in, records to save out.
 */

import {
  AnchorDocument,
  type AnchorMatch,
  type AnchorUnit,
  createQuoteSelector,
  locateQuote,
  segmentText,
  type TextQuoteSelector,
} from '@/features/anchoring/text-anchor';
import {
  HIGHLIGHT_QUOTE_LIMIT,
  highlightQuoteMatches,
} from '@/features/library/highlight-popup-placement';
import type { HighlightSegment, UserDocumentHighlight } from '@/state/user-library-highlights';
import { upgradeHighlight } from '@/state/user-library-highlights';

export interface HighlightSyncInput {
  readonly documentId: string;
  /** This document's own records, tombstones included. */
  readonly records: readonly UserDocumentHighlight[];
  /** Earlier editions' records, nearest edition first. */
  readonly predecessors?: readonly {
    readonly documentId: string;
    readonly records: readonly UserDocumentHighlight[];
  }[];
  readonly units: readonly AnchorUnit[];
  /** Fingerprint of `units`; a `missing` highlight is not searched for again until it changes. */
  readonly revision: string;
  readonly newId?: () => string;
}

export interface HighlightSyncResult {
  /** Records to save: changed own records and new carried copies. */
  readonly upserts: readonly UserDocumentHighlight[];
  readonly counts: Readonly<
    Record<'verified' | 'moved' | 'approximate' | 'missing' | 'carried', number>
  >;
}

/** The pieces a highlight covers now: the primary position, then any further ones. */
export function highlightSegments(record: UserDocumentHighlight): readonly HighlightSegment[] {
  return [
    { pageAnchor: record.pageAnchor, start: record.start, end: record.end },
    ...(record.more ?? []),
  ];
}

/** A cheap fingerprint of a document's text (FNV-1a over unit ids and text). */
export function unitsRevision(units: readonly AnchorUnit[]): string {
  let hash = 0x811c9dc5;
  let length = 0;
  for (const unit of units) {
    const text = `${unit.id}\u0001${unit.text}\u0002`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    length += text.length;
  }
  return `${(hash >>> 0).toString(16)}-${length.toString(16)}`;
}

function isTextHighlight(record: UserDocumentHighlight): boolean {
  return record.cfiRange === undefined;
}

function textOf(units: ReadonlyMap<string, string>, anchor: string): string | undefined {
  return units.get(anchor);
}

/** Whether the saved quote still describes the text at the saved place. */
function sitsAtSavedPlace(
  record: UserDocumentHighlight,
  units: ReadonlyMap<string, string>,
): boolean {
  const primary = textOf(units, record.pageAnchor);
  if (primary === undefined || record.end > primary.length) return false;
  if (!highlightQuoteMatches(primary, record.start, record.end, record.quote)) return false;
  return (record.more ?? []).every((segment) => {
    const text = textOf(units, segment.pageAnchor);
    return text !== undefined && segment.end <= text.length;
  });
}

function selectorOf(record: UserDocumentHighlight): TextQuoteSelector {
  return record.selector ?? { exact: record.quote, prefix: '', suffix: '' };
}

/** The selector gains its surrounding context from the text it is verified in. */
function withContext(
  record: UserDocumentHighlight,
  units: readonly AnchorUnit[],
  index: ReadonlyMap<string, number>,
): UserDocumentHighlight {
  const selector = selectorOf(record);
  if (selector.prefix.length > 0 || selector.suffix.length > 0 || record.more) return record;
  const position = index.get(record.pageAnchor);
  const unit = position === undefined ? undefined : units[position];
  if (!unit) return record;
  if (unit.text.slice(record.start, record.end).length === 0) return record;
  const fresh = createQuoteSelector(unit.text, record.start, record.end, {
    before: units[(position ?? 0) - 1]?.text.slice(-60) ?? '',
    after: units[(position ?? 0) + 1]?.text.slice(0, 60) ?? '',
  });
  // Keep the quote exactly as it was saved; only the context is new.
  return { ...record, selector: { ...selector, prefix: fresh.prefix, suffix: fresh.suffix } };
}

interface Placement {
  readonly status: 'exact' | 'moved' | 'approximate';
  readonly fields: Pick<
    UserDocumentHighlight,
    'pageAnchor' | 'start' | 'end' | 'quote' | 'more' | 'anchorMethod' | 'anchorScore'
  >;
}

function placement(document: AnchorDocument, match: AnchorMatch): Placement | null {
  const [first, ...rest] = match.segments;
  if (!first) return null;
  const quote = segmentText(document, first).slice(0, HIGHLIGHT_QUOTE_LIMIT);
  return {
    status: match.status,
    fields: {
      pageAnchor: first.unitId,
      start: first.start,
      end: first.end,
      quote,
      ...(rest.length > 0
        ? {
            more: rest.map((segment) => ({
              pageAnchor: segment.unitId,
              start: segment.start,
              end: segment.end,
            })),
          }
        : {}),
      anchorMethod: match.method,
      anchorScore: Math.round(match.score * 1000) / 1000,
    },
  };
}

function withoutMore(record: UserDocumentHighlight): UserDocumentHighlight {
  const { more: _more, ...rest } = record;
  return rest;
}

export function syncHighlights(input: HighlightSyncInput): HighlightSyncResult {
  const counts = { verified: 0, moved: 0, approximate: 0, missing: 0, carried: 0 };
  // Without any text there is nothing to judge a highlight by: leave every record as it is.
  if (!input.units.some((unit) => unit.text.length > 0)) return { upserts: [], counts };
  const newId = input.newId ?? ((): string => `hl-${crypto.randomUUID()}`);
  const unitText = new Map(input.units.map((unit) => [unit.id, unit.text] as const));
  const unitIndex = new Map(input.units.map((unit, index) => [unit.id, index] as const));
  let document: AnchorDocument | undefined;
  const anchorDocument = (): AnchorDocument => {
    document ??= new AnchorDocument(input.units);
    return document;
  };
  const upserts: UserDocumentHighlight[] = [];

  const settle = (
    record: UserDocumentHighlight,
    carriedFrom?: UserDocumentHighlight['carriedFrom'],
  ): UserDocumentHighlight => {
    const match = locateQuote(anchorDocument(), selectorOf(record), {
      unitId: record.pageAnchor,
      start: record.start,
    });
    const placed = match ? placement(anchorDocument(), match) : null;
    const base: UserDocumentHighlight = {
      ...withoutMore(record),
      ...(carriedFrom ? { carriedFrom } : {}),
      anchoredRevision: input.revision,
    };
    if (!placed) return { ...base, anchorStatus: 'missing' };
    const { anchorMethod: _method, anchorScore: _score, ...clean } = base;
    return { ...clean, ...placed.fields, anchorStatus: placed.status };
  };

  // 1. The document's own highlights.
  const ownRoots = new Set<string>();
  for (const stored of input.records) {
    if (stored.carriedFrom) ownRoots.add(stored.carriedFrom.rootId);
    ownRoots.add(stored.id);
    if (stored.dismissed || !isTextHighlight(stored)) continue;
    const record = upgradeHighlight(stored);
    if (sitsAtSavedPlace(record, unitText)) {
      counts.verified += 1;
      const completed = withContext(record, input.units, unitIndex);
      // A record that was `missing` and now fits again (the text came back) is exact once more.
      const revived =
        completed.anchorStatus === 'missing'
          ? { ...completed, anchorStatus: 'exact' as const }
          : completed;
      if (revived !== stored) upserts.push(revived);
      continue;
    }
    if (record.anchorStatus === 'missing' && record.anchoredRevision === input.revision) {
      counts.missing += 1;
      continue;
    }
    const settled = settle(record);
    if (settled.anchorStatus === 'missing') counts.missing += 1;
    else if (settled.anchorStatus === 'moved') counts.moved += 1;
    else counts.approximate += 1;
    upserts.push(settled);
  }

  // 2. Highlights of earlier editions, carried into this one once each.
  const roots = new Map<string, UserDocumentHighlight>();
  for (const predecessor of input.predecessors ?? []) {
    for (const stored of predecessor.records) {
      if (stored.dismissed || !isTextHighlight(stored)) continue;
      const record = upgradeHighlight(stored);
      const rootId = record.carriedFrom?.rootId ?? record.id;
      if (ownRoots.has(rootId)) continue;
      const known = roots.get(rootId);
      if (!known || (known.anchorStatus === 'missing' && record.anchorStatus !== 'missing')) {
        roots.set(rootId, record);
      }
    }
  }
  for (const [rootId, source] of roots) {
    const copy = settle(
      {
        ...source,
        id: newId(),
        documentId: input.documentId,
        origin: source.origin ?? {
          documentId: source.documentId,
          pageAnchor: source.pageAnchor,
          start: source.start,
          end: source.end,
          at: source.createdAt,
        },
      },
      { documentId: source.documentId, highlightId: source.id, rootId },
    );
    counts.carried += 1;
    if (copy.anchorStatus === 'missing') counts.missing += 1;
    upserts.push(copy);
  }
  return { upserts, counts };
}
