import { afterEach, describe, expect, it } from 'vitest';

import {
  isPlaceholderDocumentTitle,
  knownDocumentTitle,
  OPENING_DOCUMENT_TITLE,
  rememberDocumentSummaries,
  rememberDocumentTitle,
  resetDocumentTitleHintsForTests,
} from '@/features/library/document-title-hints';

const summary = (id: string, title: string, shortTitle?: string) => ({
  id,
  title,
  shortTitle: shortTitle ?? null,
  sourceType: 'clinical_recommendation',
  metadata: {},
});

describe('document title hints', () => {
  afterEach(resetDocumentTitleHintsForTests);

  it('names a document from the catalog lists the app has already read', () => {
    rememberDocumentSummaries([
      summary(
        'kr.rf.1006_1',
        'Острая ишемия конечностей: клинические рекомендации',
        'Острая ишемия конечностей',
      ),
      summary('kr.rf.2_1', 'Другая рекомендация'),
    ]);
    expect(knownDocumentTitle('kr.rf.1006_1')).toBe('Острая ишемия конечностей');
    expect(knownDocumentTitle('kr.rf.2_1')).toBe('Другая рекомендация');
    expect(knownDocumentTitle('kr.rf.unknown')).toBeUndefined();
  });

  it('prefers a title the opener passed over the catalog list', () => {
    rememberDocumentSummaries([summary('doc-1', 'Из каталога')]);
    rememberDocumentTitle('doc-1', '  Из ссылки  ');
    expect(knownDocumentTitle('doc-1')).toBe('Из ссылки');
  });

  it('keeps the newest lists and forgets the oldest', () => {
    const lists = ['a', 'b', 'c', 'd'].map((id) => [summary(id, `Документ ${id}`)]);
    for (const list of lists) rememberDocumentSummaries(list);
    expect(knownDocumentTitle('a')).toBeUndefined();
    expect(knownDocumentTitle('d')).toBe('Документ d');
  });

  it('never remembers the placeholder as a name', () => {
    rememberDocumentTitle('doc-1', OPENING_DOCUMENT_TITLE);
    expect(knownDocumentTitle('doc-1')).toBeUndefined();
    expect(isPlaceholderDocumentTitle(OPENING_DOCUMENT_TITLE)).toBe(true);
    expect(isPlaceholderDocumentTitle('Острая ишемия конечностей')).toBe(false);
  });
});
