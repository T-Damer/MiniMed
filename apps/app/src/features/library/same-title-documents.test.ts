import { describe, expect, it } from 'vitest';

import { sameTitleDocuments, sameTitleKey } from './same-title-documents';

function doc(id: string, title: string, metadata: Record<string, unknown> = {}) {
  return { id, title, shortTitle: null, sourceType: 'reference', metadata } as const;
}

describe('sameTitleDocuments', () => {
  it('folds case, «ё» and spacing', () => {
    expect(sameTitleKey('  Шизофрения. ')).toBe('шизофрения');
    expect(sameTitleKey('Ёлка')).toBe(sameTitleKey('елка'));
  });

  it('lists the other documents of the same name, not the current one or its editions', () => {
    const documents = [
      doc('kr.rf.451_2', 'Шизофрения'),
      doc('kr.rf.451_3', 'Шизофрения'),
      doc('kr.rf.700_1', 'Шизофрения'),
      doc('ref.krasota.schizo', 'шизофрения'),
      doc('def.schizo', 'Шизофрения.'),
      doc('kr.rf.1_1', 'Депрессия'),
    ];
    const current = documents[0] as (typeof documents)[number];
    expect(sameTitleDocuments(documents, current).map((item) => item.id)).toEqual([
      'kr.rf.700_1',
      'ref.krasota.schizo',
      'def.schizo',
    ]);
  });

  it('counts a module pointer as the document it opens', () => {
    const documents = [
      doc('ref.krasota.schizo', 'Шизофрения'),
      doc('core.catalog.pointer.ref.krasota.schizo', 'Шизофрения', {
        targetDocumentId: 'ref.krasota.schizo',
      }),
      doc('core.catalog.pointer.kr.rf.700_1-abc', 'Шизофрения', {
        targetDocumentId: 'kr.rf.700_1',
      }),
      doc('def.schizo', 'Шизофрения'),
    ];
    // Reading the installed article: its own pointer is left out, the other pointer stays.
    expect(
      sameTitleDocuments(documents, documents[0] as (typeof documents)[number]).map(
        (item) => item.id,
      ),
    ).toEqual(['core.catalog.pointer.kr.rf.700_1-abc', 'def.schizo']);
    // Reading the definition: the article is listed once, as the installed document.
    expect(
      sameTitleDocuments(documents, documents[3] as (typeof documents)[number]).map(
        (item) => item.id,
      ),
    ).toEqual(['ref.krasota.schizo', 'core.catalog.pointer.kr.rf.700_1-abc']);
  });
});
