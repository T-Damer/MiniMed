import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';

import type { ClinicalRelationsFile, SectionManifest } from './section-manifest-source';

/** A tiny catalog shaped like the real one: two clinical sections, two ATC drug groups. */
export function moduleEntry(
  id: string,
  extra: {
    readonly kind: ContentModuleCatalogEntry['kind'];
    readonly collection: string;
    readonly title?: string;
    readonly bytes?: number | null;
    readonly documentIds?: readonly string[];
    readonly releaseState?: ContentModuleCatalogEntry['releaseState'];
  },
): ContentModuleCatalogEntry {
  return {
    id,
    version: '1',
    kind: extra.kind,
    collection: extra.collection,
    title: extra.title ?? id,
    releaseState: extra.releaseState ?? 'published',
    sizes: { downloadBytes: extra.bytes ?? null, installedBytes: null, precision: 'exact' },
    documents: (extra.documentIds ?? []).map((documentId) => ({ documentId })),
  } as unknown as ContentModuleCatalogEntry;
}

const MIB = 1024 * 1024;

export const FIXTURE_CATALOG = {
  catalogVersion: 'fixture-1',
  categories: [
    { id: 'minimed.clinical.psychiatry.ru', title: 'Психиатрия', recommendationCount: 2 },
    { id: 'minimed.clinical.cardiology.ru', title: 'Кардиология', recommendationCount: 1 },
    { id: 'minimed.clinical.empty.ru', title: 'Пустой', recommendationCount: 0 },
  ],
  modules: [
    moduleEntry('kr.1', {
      kind: 'clinical',
      collection: 'minimed.clinical.psychiatry.ru',
      bytes: 10 * MIB,
      documentIds: ['kr.rf.1_1'],
    }),
    moduleEntry('kr.2', {
      kind: 'clinical',
      collection: 'minimed.clinical.psychiatry.ru',
      bytes: 20 * MIB,
      documentIds: ['kr.rf.2_1'],
    }),
    moduleEntry('kr.3', {
      kind: 'clinical',
      collection: 'minimed.clinical.cardiology.ru',
      bytes: 5 * MIB,
      documentIds: ['kr.rf.3_1'],
    }),
    moduleEntry('kr.planned', {
      kind: 'clinical',
      collection: 'minimed.clinical.empty.ru',
      releaseState: 'planned',
    }),
    moduleEntry('minimed.medications.nervous-system.ru', {
      kind: 'medication',
      collection: 'esklp',
      title: 'Нервная система',
      bytes: 8 * MIB,
      documentIds: ['esklp.mnn.a', 'esklp.mnn.b'],
    }),
    moduleEntry('minimed.medications.instructions.nervous-system.ru', {
      kind: 'medication',
      collection: 'grls-instructions',
      bytes: 30 * MIB,
    }),
    moduleEntry('minimed.medications.cardiovascular.ru', {
      kind: 'medication',
      collection: 'esklp',
      title: 'Сердечно-сосудистая система',
      bytes: 10 * MIB,
      documentIds: ['esklp.mnn.c'],
    }),
    moduleEntry('minimed.medications.instructions.cardiovascular.ru', {
      kind: 'medication',
      collection: 'grls-instructions',
      bytes: 28 * MIB,
    }),
    moduleEntry('minimed.medications.ru', {
      kind: 'medication',
      collection: 'shared',
      bytes: 50 * MIB,
    }),
  ],
} as unknown as ContentModuleCatalog;

export const FIXTURE_MANIFEST: SectionManifest = {
  schemaVersion: 1,
  provenance: {
    catalogFile: 'catalog.json',
    catalogVersion: 'fixture-1',
    catalogSha256: 'a'.repeat(64),
    relationsDirectory: 'relations',
    relationsFileCount: 3,
    relationsDigest: 'b'.repeat(64),
    generator: 'test',
  },
  drugGroups: [
    {
      id: 'cardiovascular',
      esklpModuleId: 'minimed.medications.cardiovascular.ru',
      instructionModuleId: 'minimed.medications.instructions.cardiovascular.ru',
    },
    {
      id: 'nervous-system',
      esklpModuleId: 'minimed.medications.nervous-system.ru',
      instructionModuleId: 'minimed.medications.instructions.nervous-system.ru',
    },
  ],
  sections: [
    {
      collection: 'minimed.clinical.cardiology.ru',
      relatedRecommendations: 1,
      recommendationsWithDrugs: 1,
      medicationCount: 2,
      unmatchedMedicationCount: 0,
      drugs: [
        { groupId: 'cardiovascular', medicationCount: 1 },
        { groupId: 'nervous-system', medicationCount: 1 },
      ],
    },
    {
      collection: 'minimed.clinical.psychiatry.ru',
      relatedRecommendations: 2,
      recommendationsWithDrugs: 2,
      medicationCount: 2,
      unmatchedMedicationCount: 0,
      drugs: [{ groupId: 'nervous-system', medicationCount: 2 }],
    },
  ],
};

/** Relations of one recommendation naming the given ЕСКЛП МНН ids. */
export function relationsFile(
  recommendationId: string,
  mnnIds: readonly string[],
): ClinicalRelationsFile {
  const medications = mnnIds.map((mnnId, index) => ({
    id: `med.${index}`,
    entityType: 'medication',
    externalIds: { esklpMnnDocumentId: mnnId },
    metadata: {},
  }));
  return {
    fileName: `${recommendationId}.json`,
    sha256: 'c'.repeat(64),
    content: {
      entities: [
        {
          id: 'condition.1',
          entityType: 'condition',
          externalIds: {},
          metadata: { sourceDocumentId: recommendationId },
        },
        ...medications,
      ],
      relations: medications.map((medication) => ({
        subjectEntityId: medication.id,
        objectEntityId: 'condition.1',
      })),
    },
  };
}
