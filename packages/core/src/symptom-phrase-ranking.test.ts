import type { SearchResultGroup } from '@localmed/contracts';
import type { SearchDocumentDescriptor } from '@localmed/storage';
import { describe, expect, it } from 'vitest';

import { isSymptomLevelDocument, prioritizeSymptomLevelGroups } from './symptom-phrase-ranking';

const document = (id: string, metadata: Record<string, unknown>): SearchDocumentDescriptor => ({
  id,
  title: id,
  shortTitle: null,
  sourceType: 'medical_reference',
  metadata,
});
const group = (documentId: string) => ({ documentId, title: documentId }) as SearchResultGroup;

describe('symptom-level documents', () => {
  it('reads the entity type and the R chapter of МКБ-10', () => {
    expect(isSymptomLevelDocument(document('a', { entityType: 'symptom' }))).toBe(true);
    expect(isSymptomLevelDocument(document('b', { entityType: 'syndrome' }))).toBe(true);
    expect(isSymptomLevelDocument(document('c', { icd10Codes: ['R10.0'] }))).toBe(true);
    expect(isSymptomLevelDocument(document('d', { mkbCode: 'R11' }))).toBe(true);
    expect(isSymptomLevelDocument(document('e', { icd10Codes: ['K43.9'] }))).toBe(false);
    expect(isSymptomLevelDocument(document('f', { icd10Codes: ['R10.4', 'K35'] }))).toBe(false);
    expect(isSymptomLevelDocument(document('g', {}))).toBe(false);
  });

  it('moves symptom-level groups ahead of the other non-recommendation groups', () => {
    const documents = new Map(
      [
        document('hernia', { icd10Codes: ['K43.9'] }),
        document('r11', { mkbCode: 'R11' }),
        document('pregnancy', { icd10Codes: ['O21'] }),
        document('acute-abdomen', { icd10Codes: ['R10.0'] }),
        { ...document('kr', { catalogFamily: 'clinical' }), sourceType: 'core_catalog_pointer' },
      ].map((entry) => [entry.id, entry]),
    );
    const ranked = prioritizeSymptomLevelGroups(
      ['hernia', 'kr', 'r11', 'pregnancy', 'acute-abdomen'].map(group),
      documents,
    );
    // The recommendation keeps its slot; the others are reordered among theirs.
    expect(ranked.map((entry) => entry.documentId)).toEqual([
      'r11',
      'kr',
      'acute-abdomen',
      'hernia',
      'pregnancy',
    ]);
  });
});
