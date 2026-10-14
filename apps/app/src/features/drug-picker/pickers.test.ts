/**
 * SRCH1, item 4: the four drug pickers share one name rule. The core here holds no drug at all, so
 * everything a picker finds comes from the shipped drug names — which is the case the QA hit
 * («сакубитрил», «сакубитрил/валсартан» found nothing; only «валсартан+сакубитрил» did).
 */
import { ContentPackSeedSchema, type MedicalCore } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterAll, describe, expect, it } from 'vitest';

import { findDrugs, resolveDrugName } from '@/features/drug-comparison/comparison-candidates';
import { findDrugCandidates, resolveTypedName } from '@/features/drug-interactions/drug-candidates';
import { loadInteractionIndex } from '@/features/drug-interactions/interaction-load';
import { resolveSafetyCandidate } from '@/features/medication-safety/safety-candidates';
import { loadSafetyIndex } from '@/features/medication-safety/safety-load';
import { findDoseCandidates } from '@/features/prescription/dose-candidates';
import { loadDoseIndex } from '@/features/prescription/dose-load';

const SEED = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.srch1.pickers',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'SRCH1 pickers',
    checksum: 'test-srch1-pickers',
    builtAt: '2026-10-14T00:00:00Z',
  },
  documents: [
    {
      id: 'ref.noise',
      title: 'Справочная запись',
      shortTitle: 'Справочная запись',
      sourceType: 'medical_reference',
      status: 'active',
      specialties: [],
      metadata: {},
      version: {
        id: 'ref.noise.v1',
        label: '2026-10-14',
        effectiveFrom: null,
        effectiveTo: null,
        sourceChecksum: 'checksum:noise',
        extractedAt: '2026-10-14T00:00:00Z',
      },
      sections: [
        {
          id: 'ref.noise.s1',
          parentSectionId: null,
          title: 'Определение',
          normalizedTitle: 'определение',
          sectionType: 'definition',
          depth: 1,
          orderIndex: 0,
          pageStart: null,
          pageEnd: null,
          anchor: 's1',
          sectionPath: ['Определение'],
          chunks: [
            {
              id: 'ref.noise.s1.1',
              orderIndex: 0,
              originalText: 'Справочная запись.',
              normalizedText: 'справочная запись',
              pageStart: null,
              pageEnd: null,
              charStart: null,
              charEnd: null,
              anchor: 's1-1',
              metadata: {},
            },
          ],
        },
      ],
    },
  ],
  aliases: [],
});
const core: MedicalCore = createMedicalCore({
  store: new InMemoryMedicalStore(),
  seed: SEED,
  platform: 'test',
});
afterAll(() => core.close());

const QUERIES = ['сакубитрил', 'сакубитрил/валсартан', 'валсартан+сакубитрил', 'сакуб валсартан'];

describe('every drug picker finds a combination by any of its components', () => {
  it('interactions', async () => {
    const index = await loadInteractionIndex();
    for (const query of QUERIES) {
      const found = await findDrugCandidates(core, index, query);
      expect(
        found.map((candidate) => candidate.slug),
        query,
      ).toContain('валсартан-сакубитрил');
    }
    expect(
      (await resolveTypedName(core, index, 'сакубитрил/валсартан')).map((c) => c.slug),
    ).toEqual(['валсартан-сакубитрил']);
  });

  it('comparison', async () => {
    for (const query of QUERIES) {
      expect(
        (await findDrugs(core, query)).map((drug) => drug.slug),
        query,
      ).toContain('валсартан-сакубитрил');
    }
    expect((await resolveDrugName(core, 'сакубитрил валсартан'))?.slug).toBe(
      'валсартан-сакубитрил',
    );
  });

  it('prescription and dose', async () => {
    const index = await loadDoseIndex();
    for (const query of QUERIES) {
      const found = await findDoseCandidates(core, index, query);
      expect(
        found.map((candidate) => candidate.slug),
        query,
      ).toContain('валсартан-сакубитрил');
    }
  });

  it('safety', async () => {
    const index = await loadSafetyIndex();
    expect((await resolveSafetyCandidate(core, index, 'сакубитрил/валсартан'))?.slug).toBe(
      'валсартан-сакубитрил',
    );
  });
});

describe('every drug picker finds a card by its trade name', () => {
  it('comparison and interactions', async () => {
    const found = await findDrugs(core, 'Аспирин');
    expect(found[0]).toMatchObject({ slug: 'ацетилсалициловая-кислота', product: 'Аспирин' });
    const index = await loadInteractionIndex();
    expect((await findDrugCandidates(core, index, 'Аспирин'))[0]?.slug).toBe(
      'ацетилсалициловая-кислота',
    );
  });
});
