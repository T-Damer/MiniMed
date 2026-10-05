import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import catalogText from '@/features/modules/catalog.preview.json?raw';
import { FIXTURE_CATALOG, relationsFile } from './section-fixtures';
import { sectionManifest } from './section-manifest';
import { deriveSectionManifest } from './section-manifest-source';

const baseInput = {
  catalog: FIXTURE_CATALOG,
  catalogFile: 'catalog.json',
  catalogSha256: 'a'.repeat(64),
  relationsDirectory: 'relations',
  relationsDigest: 'b'.repeat(64),
  generator: 'test',
};

describe('deriveSectionManifest', () => {
  const manifest = deriveSectionManifest({
    ...baseInput,
    relations: [
      relationsFile('kr.rf.1_1', ['esklp.mnn.a', 'esklp.mnn.b']),
      relationsFile('kr.rf.2_1', ['esklp.mnn.a']),
      relationsFile('kr.rf.3_1', ['esklp.mnn.c', 'esklp.mnn.a', 'esklp.mnn.unknown']),
    ],
  });

  it('makes a section of every released clinical collection and none of a planned one', () => {
    expect(manifest.sections.map((section) => section.collection)).toEqual([
      'minimed.clinical.cardiology.ru',
      'minimed.clinical.psychiatry.ru',
    ]);
  });

  it('counts each drug once per section and groups it by its ЕСКЛП module', () => {
    const psychiatry = manifest.sections.find((s) => s.collection.includes('psychiatry'));
    expect(psychiatry).toMatchObject({
      relatedRecommendations: 2,
      recommendationsWithDrugs: 2,
      medicationCount: 2,
      drugs: [{ groupId: 'nervous-system', medicationCount: 2 }],
    });
    const cardiology = manifest.sections.find((s) => s.collection.includes('cardiology'));
    expect(cardiology?.drugs).toEqual([
      { groupId: 'cardiovascular', medicationCount: 1 },
      { groupId: 'nervous-system', medicationCount: 1 },
    ]);
  });

  it('reports a drug that no ЕСКЛП module lists instead of inventing a package for it', () => {
    const cardiology = manifest.sections.find((s) => s.collection.includes('cardiology'));
    expect(cardiology?.unmatchedMedicationCount).toBe(1);
  });

  it('pairs each ЕСКЛП module with the ГРЛС instructions module of the same ATC group', () => {
    expect(manifest.drugGroups).toEqual([
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
    ]);
  });

  it('records where it came from', () => {
    expect(manifest.provenance).toMatchObject({
      catalogVersion: 'fixture-1',
      relationsFileCount: 3,
      generator: 'test',
    });
  });

  it('rejects a recommendation that is in no clinical module', () => {
    expect(() =>
      deriveSectionManifest({ ...baseInput, relations: [relationsFile('kr.rf.99_1', [])] }),
    ).toThrow(/kr\.rf\.99_1/u);
  });
});

describe('the committed section manifest', () => {
  const manifest = sectionManifest();
  const catalog = ContentModuleCatalogSchema.parse(JSON.parse(catalogText));
  const moduleById = new Map(catalog.modules.map((module) => [module.id, module]));

  it('names provenance with the digest of 753 relations files', () => {
    expect(manifest.provenance.relationsFileCount).toBeGreaterThan(700);
    expect(manifest.provenance.relationsDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('only refers to collections and modules the catalog still has', () => {
    const collections = new Set(catalog.categories.map((category) => category.id));
    for (const section of manifest.sections) {
      expect(collections.has(section.collection), section.collection).toBe(true);
    }
    for (const group of manifest.drugGroups) {
      expect(moduleById.get(group.esklpModuleId)?.collection, group.id).toBe('esklp');
      if (group.instructionModuleId) {
        expect(moduleById.get(group.instructionModuleId)?.collection, group.id).toBe(
          'grls-instructions',
        );
      }
    }
  });

  it('lists only drug groups of the manifest, none twice, none empty', () => {
    const groupIds = new Set(manifest.drugGroups.map((group) => group.id));
    for (const section of manifest.sections) {
      expect(new Set(section.drugs.map((drug) => drug.groupId)).size).toBe(section.drugs.length);
      for (const drug of section.drugs) expect(groupIds.has(drug.groupId)).toBe(true);
      expect(section.drugs.reduce((sum, drug) => sum + drug.medicationCount, 0)).toBe(
        section.medicationCount,
      );
    }
  });

  it('gives every substantial clinical collection a section', () => {
    const sectionCollections = new Set(manifest.sections.map((section) => section.collection));
    const clinical = catalog.modules.filter(
      (module) => module.kind === 'clinical' && module.collection.startsWith('minimed.clinical.'),
    );
    for (const module of clinical) {
      expect(sectionCollections.has(module.collection), module.id).toBe(true);
    }
  });
});
