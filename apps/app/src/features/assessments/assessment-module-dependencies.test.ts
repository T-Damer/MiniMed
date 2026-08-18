import type { ChunkRecord, DocumentRecord } from '@localmed/domain';
import type { StorageHealth } from '@localmed/storage';
import { describe, expect, it, vi } from 'vitest';

import {
  getAssessmentCatalog,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { findAssessmentDependenciesInStore } from '@/features/assessments/assessment-module-dependencies';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

function psychologyCatalog() {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
  return getAssessmentCatalog();
}

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

function health(contentPackIds: readonly string[]): StorageHealth {
  return {
    schemaVersion: 2,
    sqliteVersion: 'test',
    fts5Available: true,
    contentPackIds,
    documentCount: 1,
    backend: 'sqlite-wasm',
    persistent: false,
    installation: 'memory',
    sizeBytes: null,
  };
}

describe('assessment module dependencies', () => {
  it('uses a valid declaration without scanning documents or chunks', async () => {
    const assessmentId = psychologyCatalog()[0]?.id ?? '';
    const listDocuments = vi.fn(async () => [document]);
    const getChunksByDocument = vi.fn(async () => [chunk('one', 'Личная эгограмма')]);
    const store = {
      getHealth: async () => health(['clinical.declared']),
      listDocuments,
      getChunksByDocument,
    };

    await expect(
      findAssessmentDependenciesInStore(store, {
        modules: [
          {
            id: 'clinical.declared',
            kind: 'clinical',
            tags: [`assessment:${assessmentId}`],
          },
        ],
      }),
    ).resolves.toEqual([assessmentId]);
    expect(listDocuments).not.toHaveBeenCalled();
    expect(getChunksByDocument).not.toHaveBeenCalled();
  });

  it('uses an explicit empty declaration without scanning content', async () => {
    const listDocuments = vi.fn(async () => [document]);
    const getChunksByDocument = vi.fn(async () => []);
    const store = {
      getHealth: async () => health(['clinical.empty']),
      listDocuments,
      getChunksByDocument,
    };

    await expect(
      findAssessmentDependenciesInStore(store, {
        modules: [
          {
            id: 'clinical.empty',
            kind: 'clinical',
            tags: ['assessment-dependencies:none'],
          },
        ],
      }),
    ).resolves.toEqual([]);
    expect(listDocuments).not.toHaveBeenCalled();
    expect(getChunksByDocument).not.toHaveBeenCalled();
  });

  it('falls back to content scanning when a declaration is missing', async () => {
    const getChunksByDocument = vi.fn(async () => [
      chunk('one', 'Для оценки можно использовать тест Бравермана.'),
      chunk('two', 'Также допустима личная эгограмма.'),
    ]);
    const store = {
      getHealth: async () => health(['clinical.legacy']),
      listDocuments: async () => [document],
      getChunksByDocument,
    };

    await expect(
      findAssessmentDependenciesInStore(store, {
        modules: [{ id: 'clinical.legacy', kind: 'clinical', tags: ['legacy'] }],
      }),
    ).resolves.toEqual(['minimed.assessment.braverman-behavioral', 'minimed.assessment.egogram']);
    expect(getChunksByDocument).toHaveBeenCalledOnce();
  });

  it('reports an invalid declaration and safely falls back to text', async () => {
    const onDeclarationError = vi.fn();
    const store = {
      getHealth: async () => health(['clinical.invalid']),
      listDocuments: async () => [document],
      getChunksByDocument: async () => [chunk('one', 'Личная эгограмма')],
    };

    await expect(
      findAssessmentDependenciesInStore(store, {
        modules: [
          {
            id: 'clinical.invalid',
            kind: 'clinical',
            tags: ['assessment:minimed.assessment.missing'],
          },
        ],
        onDeclarationError,
      }),
    ).resolves.toEqual(['minimed.assessment.egogram']);
    expect(onDeclarationError).toHaveBeenCalledWith('clinical.invalid', expect.any(Error));
  });

  it('collects unique assessment references from installed module text', async () => {
    psychologyCatalog();
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
    const catalog = psychologyCatalog();
    const getChunksByDocument = vi.fn(async () => []);
    const store = {
      listDocuments: async () =>
        catalog.map((assessment, index) =>
          documentWithTitle(`clinical-document-${index}`, assessment.title),
        ),
      getChunksByDocument,
    };

    await expect(findAssessmentDependenciesInStore(store)).resolves.toEqual(
      catalog.map((assessment) => assessment.id).toSorted(),
    );
    expect(getChunksByDocument).not.toHaveBeenCalled();
  });
});
