import { describe, expect, it } from 'vitest';

import {
  highlightSegments,
  syncHighlights,
  unitsRevision,
} from '@/features/anchoring/highlight-sync';
import { type AnchorUnit, createQuoteSelector } from '@/features/anchoring/text-anchor';
import { type UserDocumentHighlight, upgradeHighlight } from '@/state/user-library-highlights';

const EDITION_A: readonly AnchorUnit[] = [
  {
    id: 'a1',
    text: 'Бронхиальная астма — гетерогенное заболевание, характеризующееся хроническим воспалением дыхательных путей.',
  },
  {
    id: 'a2',
    text: 'Базисная терапия включает ингаляционные глюкокортикостероиды, которые назначаются ежедневно независимо от наличия симптомов.',
  },
  {
    id: 'a3',
    text: 'При обострении рекомендуется ингаляция короткодействующего бета-2-агониста через небулайзер или спейсер каждые 20 минут в течение первого часа.',
  },
];

const BASIC = 'ингаляционные глюкокортикостероиды, которые назначаются ежедневно';
const EXACERBATION = 'ингаляция короткодействующего бета-2-агониста через небулайзер или спейсер';

let counter = 0;
const newId = (): string => {
  counter += 1;
  return `hl-test-${String(counter)}`;
};

function highlight(
  units: readonly AnchorUnit[],
  documentId: string,
  unitId: string,
  phrase: string,
  extra: Partial<UserDocumentHighlight> = {},
): UserDocumentHighlight {
  const text = units.find((unit) => unit.id === unitId)?.text ?? '';
  const start = text.indexOf(phrase);
  if (start < 0) throw new Error(`not found: ${phrase}`);
  return upgradeHighlight({
    id: newId(),
    documentId,
    pageAnchor: unitId,
    start,
    end: start + phrase.length,
    quote: phrase,
    color: 'yellow',
    createdAt: '2026-10-01T10:00:00.000Z',
    selector: createQuoteSelector(text, start, start + phrase.length),
    ...extra,
  });
}

function sync(
  documentId: string,
  records: readonly UserDocumentHighlight[],
  units: readonly AnchorUnit[],
  predecessors: readonly { documentId: string; records: readonly UserDocumentHighlight[] }[] = [],
) {
  return syncHighlights({
    documentId,
    records,
    predecessors,
    units,
    revision: unitsRevision(units),
    newId,
  });
}

describe('upgradeHighlight (migration of stored records)', () => {
  const legacy = {
    id: 'hl-1',
    documentId: 'doc',
    pageAnchor: 'doc#p0',
    start: 10,
    end: 25,
    quote: 'старая выделенная',
    color: 'blue' as const,
    createdAt: '2026-09-01T10:00:00.000Z',
  };

  it('gives a record saved before selectors a selector, an exact status and its origin', () => {
    const upgraded = upgradeHighlight(legacy);
    expect(upgraded.selector).toEqual({ exact: 'старая выделенная', prefix: '', suffix: '' });
    expect(upgraded.anchorStatus).toBe('exact');
    expect(upgraded.origin).toEqual({
      documentId: 'doc',
      pageAnchor: 'doc#p0',
      start: 10,
      end: 25,
      at: '2026-09-01T10:00:00.000Z',
    });
    // Nothing the user saved is changed.
    expect(upgraded).toMatchObject(legacy);
  });

  it('is idempotent', () => {
    const once = upgradeHighlight(legacy);
    expect(upgradeHighlight(once)).toBe(once);
  });

  it('leaves EPUB records (CFI ranges) alone', () => {
    const epub = { ...legacy, cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)' };
    expect(upgradeHighlight(epub)).toBe(epub);
  });
});

describe('syncHighlights — same document id', () => {
  it('leaves highlights that are where they were saved and saves nothing', () => {
    const records = [highlight(EDITION_A, 'doc', 'a2', BASIC)];
    const result = sync('doc', records, EDITION_A);
    expect(result.upserts).toEqual([]);
    expect(result.counts.verified).toBe(1);
  });

  it('migrates a legacy record on first open: selector context is filled from the text', () => {
    const text = EDITION_A[1]?.text ?? '';
    const start = text.indexOf(BASIC);
    const legacy: UserDocumentHighlight = {
      id: 'hl-legacy',
      documentId: 'doc',
      pageAnchor: 'a2',
      start,
      end: start + BASIC.length,
      quote: BASIC,
      color: 'green',
      createdAt: '2026-09-01T10:00:00.000Z',
    };
    const [saved] = sync('doc', [legacy], EDITION_A).upserts;
    expect(saved?.id).toBe('hl-legacy');
    expect(saved?.anchorStatus).toBe('exact');
    expect(saved?.selector?.exact).toBe(BASIC);
    expect(saved?.selector?.prefix).toContain('Базисная терапия включает');
    expect(saved?.selector?.suffix).toContain('независимо от наличия симптомов');
    // The saved position and colour are untouched.
    expect([saved?.pageAnchor, saved?.start, saved?.end, saved?.color]).toEqual([
      'a2',
      start,
      start + BASIC.length,
      'green',
    ]);
    // A second pass has nothing left to change.
    expect(sync('doc', saved ? [saved] : [], EDITION_A).upserts).toEqual([]);
  });

  it('re-anchors a highlight whose text moved, keeping its origin and colour', () => {
    const stored = highlight(EDITION_A, 'doc', 'a3', EXACERBATION, { color: 'pink' });
    const edition: readonly AnchorUnit[] = [
      { id: 'b0', text: 'Новое вступление к разделу о терапии обострений.' },
      { id: 'b1', text: EDITION_A[0]?.text ?? '' },
      {
        id: 'b2',
        text: `Что нового: ${EDITION_A[2]?.text ?? ''}`,
      },
    ];
    const [saved] = sync('doc', [stored], edition).upserts;
    expect(saved?.anchorStatus).toBe('moved');
    expect(saved?.pageAnchor).toBe('b2');
    expect(edition[2]?.text.slice(saved?.start, saved?.end)).toBe(EXACERBATION);
    expect(saved?.color).toBe('pink');
    expect(saved?.id).toBe(stored.id);
    expect(saved?.origin?.pageAnchor).toBe('a3');
    expect(saved?.selector).toEqual(stored.selector);
  });

  it('marks reworded text approximate', () => {
    const stored = highlight(EDITION_A, 'doc', 'a2', BASIC);
    const edition = EDITION_A.map((unit) =>
      unit.id === 'a2'
        ? {
            id: 'a2',
            text: 'Базисная терапия включает ингаляционные глюкокортикоиды, которые назначают ежедневно независимо от наличия симптомов.',
          }
        : unit,
    );
    const [saved] = sync('doc', [stored], edition).upserts;
    expect(saved?.anchorStatus).toBe('approximate');
    expect(saved?.anchorMethod).toBe('fuzzy');
    expect(edition[1]?.text.slice(saved?.start, saved?.end)).toContain('глюкокортикоиды');
  });

  it('keeps a highlight whose text was deleted, as missing, with its old place', () => {
    const stored = highlight(EDITION_A, 'doc', 'a3', EXACERBATION);
    const edition = EDITION_A.filter((unit) => unit.id !== 'a3');
    const result = sync('doc', [stored], edition);
    const [saved] = result.upserts;
    expect(saved?.anchorStatus).toBe('missing');
    expect(saved?.id).toBe(stored.id);
    expect(saved?.quote).toBe(EXACERBATION);
    expect([saved?.pageAnchor, saved?.start, saved?.end]).toEqual([
      stored.pageAnchor,
      stored.start,
      stored.end,
    ]);
    expect(saved?.origin).toEqual(stored.origin);
    expect(result.counts.missing).toBe(1);
  });

  it('does not search for a missing highlight again until the text changes', () => {
    const stored = highlight(EDITION_A, 'doc', 'a3', EXACERBATION);
    const edition = EDITION_A.filter((unit) => unit.id !== 'a3');
    const [missing] = sync('doc', [stored], edition).upserts;
    expect(sync('doc', missing ? [missing] : [], edition).upserts).toEqual([]);
    // The text comes back in a later edition (a different revision): it is found again.
    const later: readonly AnchorUnit[] = [
      ...edition,
      { id: 'z9', text: `Дополнение. ${EDITION_A[2]?.text ?? ''}` },
    ];
    const [found] = sync('doc', missing ? [missing] : [], later).upserts;
    expect(found?.anchorStatus).toBe('moved');
    expect(found?.pageAnchor).toBe('z9');
  });

  it('revives a missing highlight when its text is back at the saved place', () => {
    const stored = highlight(EDITION_A, 'doc', 'a3', EXACERBATION, { anchorStatus: 'missing' });
    const [saved] = sync('doc', [stored], EDITION_A).upserts;
    expect(saved?.anchorStatus).toBe('exact');
  });

  it('does nothing when the document has no text yet', () => {
    const stored = highlight(EDITION_A, 'doc', 'a2', BASIC);
    expect(sync('doc', [stored], []).upserts).toEqual([]);
  });

  it('is stable: a second pass over the result changes nothing', () => {
    const stored = [
      highlight(EDITION_A, 'doc', 'a2', BASIC),
      highlight(EDITION_A, 'doc', 'a3', EXACERBATION),
    ];
    const edition: readonly AnchorUnit[] = [
      { id: 'n1', text: 'Вступление.' },
      ...EDITION_A.slice()
        .reverse()
        .map((unit) => ({ id: `r-${unit.id}`, text: unit.text })),
    ];
    const first = sync('doc', stored, edition).upserts;
    expect(first).toHaveLength(2);
    expect(sync('doc', first, edition).upserts).toEqual([]);
  });
});

describe('syncHighlights — a newer edition under a new document id', () => {
  const OLD = 'kr.rf.507_3';
  const NEW = 'kr.rf.507_4';

  it('carries a highlight over as a copy and leaves the old edition untouched', () => {
    const original = highlight(EDITION_A, OLD, 'a2', BASIC, { color: 'blue' });
    const edition: readonly AnchorUnit[] = [
      { id: 'n0', text: 'Новая редакция. Изменён порядок разделов.' },
      EDITION_A[2] as AnchorUnit,
      { id: 'n1', text: EDITION_A[1]?.text ?? '' },
    ];
    const result = sync(NEW, [], edition, [{ documentId: OLD, records: [original] }]);
    expect(result.counts.carried).toBe(1);
    const [copy] = result.upserts;
    expect(copy?.documentId).toBe(NEW);
    expect(copy?.id).not.toBe(original.id);
    expect(copy?.carriedFrom).toEqual({
      documentId: OLD,
      highlightId: original.id,
      rootId: original.id,
    });
    expect(copy?.anchorStatus).toBe('moved');
    expect(copy?.pageAnchor).toBe('n1');
    expect(copy?.color).toBe('blue');
    expect(copy?.createdAt).toBe(original.createdAt);
    expect(copy?.origin).toEqual(original.origin);
  });

  it('carries each highlight once: a second opening adds nothing', () => {
    const original = highlight(EDITION_A, OLD, 'a2', BASIC);
    const first = sync(NEW, [], EDITION_A, [{ documentId: OLD, records: [original] }]).upserts;
    expect(first).toHaveLength(1);
    const again = sync(NEW, first, EDITION_A, [{ documentId: OLD, records: [original] }]);
    expect(again.upserts).toEqual([]);
  });

  it('does not bring back a copy the reader removed (tombstone)', () => {
    const original = highlight(EDITION_A, OLD, 'a2', BASIC);
    const [copy] = sync(NEW, [], EDITION_A, [{ documentId: OLD, records: [original] }]).upserts;
    const tombstone = { ...(copy as UserDocumentHighlight), dismissed: true };
    expect(
      sync(NEW, [tombstone], EDITION_A, [{ documentId: OLD, records: [original] }]).upserts,
    ).toEqual([]);
  });

  it('keeps a highlight whose text is not in the new edition as a missing copy', () => {
    const original = highlight(EDITION_A, OLD, 'a3', EXACERBATION);
    const edition = EDITION_A.filter((unit) => unit.id !== 'a3');
    const result = sync(NEW, [], edition, [{ documentId: OLD, records: [original] }]);
    const [copy] = result.upserts;
    expect(copy?.anchorStatus).toBe('missing');
    expect(copy?.documentId).toBe(NEW);
    expect(copy?.carriedFrom?.documentId).toBe(OLD);
    expect(copy?.quote).toBe(EXACERBATION);
    // The original on the old edition is not an upsert: it stays where it is.
    expect(result.upserts.every((record) => record.id !== original.id)).toBe(true);
  });

  it('carries through a chain of editions once, preferring the nearest one that has the text', () => {
    const first = highlight(EDITION_A, 'kr.rf.507_2', 'a2', BASIC);
    const second = {
      ...highlight(EDITION_A, OLD, 'a2', BASIC),
      id: 'hl-second',
      carriedFrom: { documentId: 'kr.rf.507_2', highlightId: first.id, rootId: first.id },
    };
    const result = sync(NEW, [], EDITION_A, [
      { documentId: OLD, records: [second] },
      { documentId: 'kr.rf.507_2', records: [first] },
    ]);
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0]?.carriedFrom).toEqual({
      documentId: OLD,
      highlightId: 'hl-second',
      rootId: first.id,
    });
  });

  it('ignores EPUB highlights, which are anchored by CFI', () => {
    const epub: UserDocumentHighlight = {
      id: 'hl-epub',
      documentId: OLD,
      pageAnchor: 'epubcfi(/6/4)',
      start: 0,
      end: 0,
      quote: 'текст',
      cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
      createdAt: '2026-09-01T10:00:00.000Z',
    };
    expect(sync(NEW, [], EDITION_A, [{ documentId: OLD, records: [epub] }]).upserts).toEqual([]);
  });
});

describe('highlightSegments', () => {
  it('lists the primary place and any further pieces', () => {
    const record: UserDocumentHighlight = {
      id: 'h',
      documentId: 'd',
      pageAnchor: 'u1',
      start: 1,
      end: 5,
      quote: 'abcd',
      createdAt: 'now',
      more: [{ pageAnchor: 'u2', start: 0, end: 3 }],
    };
    expect(highlightSegments(record)).toEqual([
      { pageAnchor: 'u1', start: 1, end: 5 },
      { pageAnchor: 'u2', start: 0, end: 3 },
    ]);
  });
});

describe('unitsRevision', () => {
  it('changes with the text and not otherwise', () => {
    expect(unitsRevision(EDITION_A)).toBe(unitsRevision([...EDITION_A]));
    expect(unitsRevision(EDITION_A)).not.toBe(unitsRevision(EDITION_A.slice(1)));
    expect(unitsRevision([{ id: 'a', text: 'x' }])).not.toBe(
      unitsRevision([{ id: 'a', text: 'y' }]),
    );
  });
});
