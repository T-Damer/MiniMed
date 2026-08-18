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

  it('returns the document catalog for recommendation lists and collections', () => {
    expect(knowledgeDocumentBackHash('modules/documents/recommendations')).toBe(
      '#/modules/documents',
    );
    expect(knowledgeDocumentBackHash('modules/documents/collection/reference')).toBe(
      '#/modules/documents',
    );
    expect(knowledgeDocumentBackHash('modules/documents/collection/regulatory')).toBe(
      '#/modules/documents',
    );
    expect(knowledgeDocumentBackHash('modules/documents/core-library')).toBe('#/modules/documents');
  });

  it('returns no parent for official document read pages so native back uses history', () => {
    expect(knowledgeDocumentBackHash('modules/documents/d/token')).toBeNull();
  });

  it('returns the user library catalog for open user documents', () => {
    expect(knowledgeDocumentBackHash('modules/documents/user/user-doc-1')).toBe(
      '#/modules/documents/user',
    );
    expect(knowledgeDocumentBackHash('modules/documents/user/user-doc-1/p/2')).toBe(
      '#/modules/documents/user',
    );
  });

  it('returns the document catalog for the user library catalog route', () => {
    expect(knowledgeDocumentBackHash('modules/documents/user')).toBe('#/modules/documents');
  });

  it('returns no parent for the document catalog root', () => {
    expect(knowledgeDocumentBackHash('modules/documents')).toBeNull();
  });

  it('returns no parent for legacy model routes handled by settings', () => {
    expect(knowledgeDocumentBackHash('modules/model')).toBeNull();
    expect(knowledgeDocumentBackHash('status')).toBeNull();
  });

  it('returns no document target outside the document catalog', () => {
    expect(knowledgeDocumentBackHash('modules')).toBeNull();
  });
});
