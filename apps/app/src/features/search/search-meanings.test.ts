import { describe, expect, it } from 'vitest';

import { meaningsBeyondResults, titleMatchesBeyondResults } from './search-meanings';

const meaning = (phrase: string, ...ids: string[]) => ({
  phrase,
  alternatives: ids.map((documentId) => ({ documentId, title: documentId })),
});

// SRCHDRUG1 (owner 2026-11-13): «Кветиапин» showed the drug above the results and again in them.
describe('meanings worth asking about above the results', () => {
  it('drops the documents the results already list', () => {
    expect(
      meaningsBeyondResults([meaning('ра', 'a', 'b', 'c')], ['a']).map((entry) =>
        entry.alternatives.map((alternative) => alternative.documentId),
      ),
    ).toEqual([['b', 'c']]);
  });

  it('drops a phrase left with fewer than two choices', () => {
    expect(meaningsBeyondResults([meaning('кветиапин', 'card', 'leaflet')], ['card'])).toEqual([]);
    expect(
      meaningsBeyondResults([meaning('кветиапин', 'card', 'leaflet')], ['card', 'leaflet']),
    ).toEqual([]);
  });

  it('keeps every choice while no result names them', () => {
    expect(meaningsBeyondResults([meaning('ра', 'a', 'b')], [])).toHaveLength(1);
  });
});

describe('title matches beyond the results', () => {
  const doc = (id: string, title: string) => ({ id, title });
  it('adds nothing a drug search lists already, by id or by title', () => {
    expect(
      titleMatchesBeyondResults(
        [doc('pointer.кветиапин', 'КВЕТИАПИН'), doc('drug.rf.1', 'Кветиапин-Алиум')],
        (document) => document.title,
        [
          { documentId: 'esklp.mnn.кветиапин', title: 'Кветиапин' },
          { documentId: 'drug.rf.1', title: 'КВЕТИАПИН-АЛИУМ' },
        ],
      ),
    ).toEqual([]);
  });

  it('keeps a narrower article the list leaves out', () => {
    expect(
      titleMatchesBeyondResults(
        [doc('ref.1', 'Пневмония у детей'), doc('kr.1', 'Пневмония')],
        (document) => document.title,
        [{ documentId: 'kr.1', title: 'Пневмония' }],
      ).map((document) => document.id),
    ).toEqual(['ref.1']);
  });
});
