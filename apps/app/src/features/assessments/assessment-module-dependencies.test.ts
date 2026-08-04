import type { ChunkRecord, DocumentRecord } from '@localmed/domain';
import { describe, expect, it, vi } from 'vitest';

import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
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

function documentWithTitle(id: string, title: string): DocumentRecord {
  return {
    ...document,
    id,
    title,
    version: {
      ...document.version,
      id: `${id}@1`,
      documentId: id,
    },
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

  it('does not read chunks after every known questionnaire is found in document metadata', async () => {
    const getChunksByDocument = vi.fn(async () => []);
    const store = {
      listDocuments: async () =>
        ASSESSMENT_CATALOG.map((assessment, index) =>
          documentWithTitle(`clinical-document-${index}`, assessment.title),
        ),
      getChunksByDocument,
    };

    await expect(findAssessmentDependenciesInStore(store)).resolves.toEqual(
      ASSESSMENT_CATALOG.map((assessment) => assessment.id).toSorted(),
    );
    expect(getChunksByDocument).not.toHaveBeenCalled();
  });
});
