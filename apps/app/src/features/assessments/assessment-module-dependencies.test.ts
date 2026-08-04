import type { ChunkRecord, DocumentRecord } from '@localmed/domain';
import { describe, expect, it } from 'vitest';

import { findAssessmentDependenciesInStore } from '@/features/assessments/assessment-module-dependencies';

const document: DocumentRecord = {
  id: 'clinical-document',
  contentPackId: 'clinical-module',
  title: 'Клиническая рекомендация',
  shortTitle: null,
  sourceType: 'clinical_recommendation',
  status: 'active',
  specialties: [],
  metadata: {},
  version: {
    id: 'clinical-document@1',
    documentId: 'clinical-document',
    versionLabel: '1',
    effectiveFrom: null,
    effectiveTo: null,
    sourceChecksum: 'sha256:test',
    extractedAt: '2026-08-04T00:00:00Z',
  },
};

function chunk(id: string, originalText: string): ChunkRecord {
  return {
    id,
    documentVersionId: document.version.id,
    sectionId: 'section',
    orderIndex: 0,
    originalText,
    normalizedText: originalText.toLocaleLowerCase('ru-RU'),
    pageStart: null,
    pageEnd: null,
    charStart: null,
    charEnd: null,
    previousChunkId: null,
    nextChunkId: null,
    anchor: id,
    metadata: {},
  };
}

describe('assessment module dependencies', () => {
  it('collects unique assessment references from installed module text', async () => {
    const store = {
      listDocuments: async () => [document],
      getChunksByDocument: async () => [
        chunk('one', 'Для оценки можно использовать тест Бравермана.'),
        chunk('two', 'Повторно указан профиль Бравермана и калькулятор ППТ Mosteller.'),
        chunk('three', 'Также допустима личная эгограмма.'),
      ],
    };

    await expect(findAssessmentDependenciesInStore(store)).resolves.toEqual([
      'minimed.assessment.braverman-behavioral',
      'minimed.assessment.egogram',
    ]);
  });
});
