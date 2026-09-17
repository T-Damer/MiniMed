import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildDocumentLinkPhrases,
  createDocumentLinkMatcher,
} from '@/features/library/document-medication-links';

function document(id: string, title: string): MedicalDocumentSummary {
  return {
    id,
    title,
    shortTitle: title,
    sourceType: 'core_catalog_pointer',
    status: 'active',
    specialties: [],
    versionId: `${id}@1`,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

describe('inline links on the current document title', () => {
  it('does not turn a reference title into a same-caption link to a different source', () => {
    const reference = document('reference.shock', 'Анафилактический шок');
    const guideline = document('guideline.shock', 'Анафилактический шок');
    const adjacent = document('reference.anaphylaxis', 'Анафилаксия');
    const documents = [reference, guideline, adjacent];
    const before = JSON.stringify(documents);
    const links = buildDocumentLinkPhrases(documents, reference.id);

    expect(links.some((link) => link.phrase === reference.title)).toBe(false);
    expect(links.some((link) => link.documentId === adjacent.id)).toBe(true);
    expect(createDocumentLinkMatcher(links).segment(reference.title)).toEqual([
      { kind: 'text', value: reference.title },
    ]);
    expect(JSON.stringify(documents)).toBe(before);
  });

  it('retains both distinct sources as alternatives inside an unrelated document', () => {
    const reference = document('reference.shock', 'Анафилактический шок');
    const guideline = document('guideline.shock', 'Анафилактический шок');
    const current = document('reference.allergy', 'Аллергические реакции');
    const links = buildDocumentLinkPhrases([reference, guideline, current], current.id);
    const segment = createDocumentLinkMatcher(links).segment(reference.title)[0];

    expect(segment?.kind).toBe('link');
    if (segment?.kind !== 'link') throw new Error('Expected an explicit source choice');
    expect(segment.alternatives?.map((item) => item.documentId).sort()).toEqual([
      guideline.id,
      reference.id,
    ]);
  });

  it('folds case, whitespace and ё without asserting clinical equivalence', () => {
    const current = document('reference.edema', 'Отёк  гортани');
    const other = document('guideline.edema', 'отек гортани');
    expect(buildDocumentLinkPhrases([current, other], current.id)).toEqual([]);
  });

  it('does not suppress related terms merely because they share an eponym', () => {
    const current = document('reference.automatism', 'Синдром Кандинского—Клерамбо');
    const other = document('reference.erotomania', 'Синдром Клерамбо');
    const links = buildDocumentLinkPhrases([current, other], current.id);
    expect(links.some((link) => link.documentId === other.id)).toBe(true);
  });

  it('does not treat broad search aliases as the current title', () => {
    const current = {
      ...document('reference.illness', 'Учебная карточка'),
      metadata: { declaredAliases: ['Лихорадка'] },
    };
    const symptom = document('reference.fever', 'Лихорадка');
    const links = buildDocumentLinkPhrases([current, symptom], current.id);
    expect(links.some((link) => link.documentId === symptom.id)).toBe(true);
  });

  it('preserves caption links when there is no current document context', () => {
    const first = document('reference.shock', 'Анафилактический шок');
    const second = document('guideline.shock', 'Анафилактический шок');
    const links = buildDocumentLinkPhrases([first, second]);
    expect(new Set(links.map((link) => link.documentId))).toEqual(new Set([first.id, second.id]));
  });
});
