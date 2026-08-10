import { describe, expect, it } from 'vitest';

import { knowledgeDocumentBackHash } from './knowledge-routing';

describe('knowledgeDocumentBackHash', () => {
  it('returns the recommendations browser for recommendation categories', () => {
    expect(
      knowledgeDocumentBackHash(
        'modules/documents/category/minimed.clinical.emergency-critical.ru',
      ),
    ).toBe('#/modules/documents/recommendations');
  });

  it('returns the document catalog for other document subroutes', () => {
    expect(knowledgeDocumentBackHash('modules/documents/collection/reference')).toBe(
      '#/modules/documents',
    );
  });

  it('returns no document target outside the document catalog', () => {
    expect(knowledgeDocumentBackHash('modules')).toBeNull();
  });
});
