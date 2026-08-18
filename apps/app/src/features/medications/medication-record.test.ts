import { describe, expect, it } from 'vitest';

import { documentFromSummary, processMedicationSummariesInBatches } from './medication-loading';
import {
  parseAllmedMedicationProduct,
  parseMedicationProduct,
  readableMedicationDocumentId,
} from './medication-record';

describe('parseMedicationProduct', () => {
  it('streams metadata-only summaries without loading document chunks', async () => {
    const summaries = Array.from({ length: 61 }, (_, index) => ({
      id: `document-${index}`,
      title: `Препарат ${index}`,
      shortTitle: null,
      sourceType: 'allmed_reference',
      status: 'reference',
      specialties: [],
      versionId: `document-${index}@1`,
      versionLabel: '1',
      effectiveFrom: null,
      metadata: { contentMode: 'allmed-snapshot', allmedId: index },
    }));
    const updates: number[] = [];
    const sections: number[] = [];
    await processMedicationSummariesInBatches(summaries, (batch) => {
      updates.push(batch.length);
      sections.push(...batch.map((document) => document.sections.length));
    });

    expect(updates.length).toBeGreaterThan(1);
    expect(Math.max(...updates)).toBeLessThanOrEqual(60);
    expect(updates.reduce((total, size) => total + size, 0)).toBe(summaries.length);
    expect(sections).toEqual(Array.from({ length: 61 }, () => 0));
    const firstSummary = summaries[0];
    if (!firstSummary) throw new Error('test fixture is empty');
    const { metadata: _metadata, ...withoutMetadata } = firstSummary;
    expect(documentFromSummary(withoutMetadata)).toBeNull();
  });

  it('keeps every package variant from a normalized registry document', () => {
    const product = parseMedicationProduct(
      {
        id: 'drug.registry',
        title: 'Мирамистин',
        shortTitle: 'Мирамистин',
        sourceType: 'official_registry_summary',
        status: 'active',
        specialties: [],
        versionId: 'drug.registry@1',
        versionLabel: '1',
        effectiveFrom: null,
        sections: [],
        metadata: {
          contentMode: 'registry-normalized',
          registrationNumber: 'ЛП-1',
          tradeName: 'Мирамистин®',
          inn: 'Действующее вещество',
          registrationStatus: 'Действующий',
          presentations: [
            {
              dosageForm: 'раствор',
              strength: '0.01%',
              packages: [
                { description: '50 мл', prescriptionStatus: 'Без рецепта' },
                { description: '150 мл', prescriptionStatus: 'Без рецепта' },
              ],
            },
          ],
        },
      },
      'drug.instruction',
    );

    expect(product?.presentations[0]?.packages.map((item) => item.description)).toEqual([
      '50 мл',
      '150 мл',
    ]);
    expect(product?.instructionDocumentId).toBe('drug.instruction');
  });

  it('maps a source-linked registry summary from the document title', () => {
    const product = parseMedicationProduct(
      {
        id: 'drug.rf.paracetamol.pediatric-suspension',
        title: 'Парацетамол — детская суспензия 120 мг/5 мл',
        shortTitle: null,
        sourceType: 'official_registry_summary',
        status: 'active',
        specialties: [],
        versionId: 'drug.rf.paracetamol.pediatric-suspension@1',
        versionLabel: '1',
        effectiveFrom: null,
        sections: [],
        metadata: {
          contentMode: 'source_linked_summary',
          registrationNumber: 'ЛП-№(002094)-(РГ-RU)',
          sourceReviewedAt: '2026-07-20',
        },
      },
      null,
    );

    expect(product).toMatchObject({
      sourceKind: 'registry',
      tradeName: 'Парацетамол',
      inn: 'Парацетамол',
      registrationNumber: 'ЛП-№(002094)-(РГ-RU)',
    });
    expect(product?.presentations[0]?.dosageForm).toBe('детская суспензия 120 мг/5 мл');
  });

  it('maps an Allmed snapshot row without presenting it as a registry record', () => {
    const product = parseAllmedMedicationProduct({
      id: 'drug.allmed.12',
      title: 'Мирамистин',
      shortTitle: null,
      sourceType: 'allmed_reference',
      status: 'reference',
      specialties: [],
      versionId: 'drug.allmed.12@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'allmed-snapshot',
        allmedId: 12,
        nameLat: 'Miramistin',
        productionForm: 'раствор',
      },
    });

    expect(product).toMatchObject({
      sourceKind: 'allmed',
      registrationNumber: 'allmed:12',
      tradeName: 'Мирамистин',
      inn: 'Miramistin',
    });
  });
});

describe('readableMedicationDocumentId', () => {
  it('prefers the instruction document when both ids are present', () => {
    const product = parseMedicationProduct(
      {
        id: 'drug.registry',
        title: 'Мирамистин',
        shortTitle: 'Мирамистин',
        sourceType: 'official_registry_summary',
        status: 'active',
        specialties: [],
        versionId: 'drug.registry@1',
        versionLabel: '1',
        effectiveFrom: null,
        sections: [],
        metadata: {
          contentMode: 'registry-normalized',
          registrationNumber: 'ЛП-1',
          tradeName: 'Мирамистин®',
          inn: 'Действующее вещество',
          registrationStatus: 'Действующий',
          presentations: [
            {
              dosageForm: 'раствор',
              strength: '0.01%',
              packages: [{ description: '50 мл', prescriptionStatus: 'Без рецепта' }],
            },
          ],
        },
      },
      'drug.instruction',
    );
    if (!product) throw new Error('expected registry product');
    expect(readableMedicationDocumentId(product)).toBe('drug.instruction');
  });

  it('falls back to the registration document id', () => {
    const product = parseAllmedMedicationProduct({
      id: 'drug.allmed.12',
      title: 'Мирамистин',
      shortTitle: null,
      sourceType: 'allmed_reference',
      status: 'reference',
      specialties: [],
      versionId: 'drug.allmed.12@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'allmed-snapshot',
        allmedId: 12,
        nameLat: 'Miramistin',
        productionForm: 'раствор',
      },
    });
    if (!product) throw new Error('expected allmed product');
    expect(readableMedicationDocumentId(product)).toBe('drug.allmed.12');
  });
});
