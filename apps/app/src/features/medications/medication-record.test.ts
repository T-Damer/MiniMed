import { describe, expect, it } from 'vitest';

import { documentFromSummary, processMedicationSummariesInBatches } from './medication-loading';
import {
  composeMedicationProducts,
  mergeAllmedSupplementalText,
  parseAllmedMedicationProduct,
  parseEsklpMedicationProducts,
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
          smnnCodes: ['SMNN-A', 'SMNN-B'],
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
    expect(product?.smnnCodes).toEqual(['SMNN-A', 'SMNN-B']);
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
      sourceKind: 'grls',
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
        shortDescription: 'Антисептическое средство',
      },
    });

    expect(product).toMatchObject({
      sourceKind: 'allmed',
      registrationNumber: 'allmed:12',
      tradeName: 'Мирамистин',
      inn: 'Miramistin',
      shortDescription: 'Антисептическое средство',
    });
  });

  it('expands one ESKLP MNN document into exact TN, form, strength, and KLP variants', () => {
    const products = parseEsklpMedicationProducts(
      {
        id: 'esklp.mnn.ibuprofen',
        title: 'Ибупрофен',
        shortTitle: 'Ибупрофен',
        sourceType: 'official_registry_summary',
        status: 'active',
        specialties: [],
        versionId: 'esklp.mnn.ibuprofen@2026',
        versionLabel: '2026',
        effectiveFrom: null,
        sections: [],
        metadata: {
          contentMode: 'esklp-mnn',
          standardizedInn: 'Ибупрофен',
          smnnNodes: [
            {
              smnnCode: 'smnn.suspension',
              dosageForm: 'Суспензия для приема внутрь',
              strength: '100 мг/5 мл',
              pharmacotherapeuticGroup: 'НПВС',
              tradeNames: [
                {
                  tradeName: 'Нурофен для детей',
                  registrationNumber: 'РФ-CHILD',
                  dosageForm: 'Суспензия для приема внутрь',
                  strength: '100 мг/5 мл',
                },
              ],
              klpPositions: [
                {
                  klpCode: 'klp.child.100ml',
                  tradeName: 'Нурофен для детей',
                  registrationNumber: 'РФ-CHILD',
                  dosageForm: 'Суспензия для приема внутрь',
                  strength: '100.0 мг/5 мл',
                  primaryPackage: 'Флакон 100 мл',
                },
              ],
            },
            {
              smnnCode: 'smnn.tablet',
              dosageForm: 'Таблетки',
              strength: '200 мг',
              tradeNames: [
                {
                  tradeName: 'Нурофен',
                  registrationNumber: 'РФ-TABLET',
                  dosageForm: 'Таблетки',
                  strength: '200 мг',
                },
              ],
              klpPositions: [
                {
                  klpCode: 'klp.tablet.12',
                  tradeName: 'Нурофен',
                  registrationNumber: 'РФ-TABLET',
                  dosageForm: 'Таблетки',
                  strength: '200 мг',
                  primaryPackage: '12 таблеток',
                },
              ],
            },
          ],
        },
      },
      new Map([
        ['РФ-CHILD', 'official.instruction.child'],
        ['РФ-TABLET', 'official.instruction.tablet'],
      ]),
    );

    expect(products).toHaveLength(2);
    expect(products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mnnDocumentId: 'esklp.mnn.ibuprofen',
          registrationDocumentId: 'esklp.mnn.ibuprofen',
          registrationNumber: 'РФ-CHILD',
          tradeName: 'Нурофен для детей',
          smnnCode: 'smnn.suspension',
          klpCodes: ['klp.child.100ml'],
          instructionDocumentId: 'official.instruction.child',
          presentations: [
            expect.objectContaining({
              dosageForm: 'Суспензия для приема внутрь',
              strength: '100 мг/5 мл',
              packages: [{ description: 'Флакон 100 мл', prescriptionStatus: null }],
            }),
          ],
        }),
        expect.objectContaining({
          registrationNumber: 'РФ-TABLET',
          tradeName: 'Нурофен',
          smnnCode: 'smnn.tablet',
          klpCodes: ['klp.tablet.12'],
          presentations: [
            expect.objectContaining({
              dosageForm: 'Таблетки',
              strength: '200 мг',
            }),
          ],
        }),
      ]),
    );
  });

  it('attaches sibling KLP positions to the node trade variant without duplicating it', () => {
    const products = parseEsklpMedicationProducts({
      id: 'esklp.mnn.single',
      title: 'Ибупрофен',
      shortTitle: null,
      sourceType: 'official_registry_summary',
      status: 'active',
      specialties: [],
      versionId: 'esklp.mnn.single@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'Ибупрофен',
        smnnNodes: [
          {
            smnnCode: 'smnn.suspension',
            dosageForm: 'Суспензия для приема внутрь',
            strength: '100 мг/5 мл',
            tradeNames: [
              {
                tradeName: 'Нурофен для детей',
                registrationNumber: 'РФ-CHILD',
                dosageForm: 'Суспензия для приема внутрь',
                strength: '100 мг/5 мл',
              },
            ],
            klpPositions: [
              {
                klpCode: 'klp.child.100ml',
                tradeName: 'Нурофен для детей',
                registrationNumber: 'РФ-CHILD',
                dosageForm: 'Суспензия для приема внутрь',
                strength: '100.0 мг/5 мл',
                primaryPackage: 'Флакон 100 мл',
              },
            ],
          },
        ],
      },
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      smnnCode: 'smnn.suspension',
      klpCodes: ['klp.child.100ml'],
      tradeName: 'Нурофен для детей',
    });
  });

  it('keeps distinct registrations and forms separate even when trade names match', () => {
    const products = parseEsklpMedicationProducts({
      id: 'esklp.mnn.example',
      title: 'Препарат',
      shortTitle: null,
      sourceType: 'official_registry_summary',
      status: 'active',
      specialties: [],
      versionId: 'esklp.mnn.example@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'Препарат',
        smnnNodes: [
          {
            smnnCode: 'smnn.solution',
            dosageForm: 'Раствор',
            strength: '10 мг/мл',
            tradeNames: [
              {
                tradeName: 'Одинаковый ТН',
                registrationNumber: 'РФ-1',
                dosageForm: 'Раствор',
                strength: '10 мг/мл',
              },
            ],
            klpPositions: [],
          },
          {
            smnnCode: 'smnn.tablet',
            dosageForm: 'Таблетки',
            strength: '10 мг',
            tradeNames: [
              {
                tradeName: 'Одинаковый ТН',
                registrationNumber: 'РФ-2',
                dosageForm: 'Таблетки',
                strength: '10 мг',
              },
            ],
            klpPositions: [],
          },
        ],
      },
    });

    expect(products).toHaveLength(2);
    expect(products.map((product) => product.registrationNumber).sort()).toEqual(['РФ-1', 'РФ-2']);
  });

  it('composes ESKLP identity with only the exact GRLS registration', () => {
    const esklp = parseEsklpMedicationProducts({
      id: 'esklp.mnn.ibuprofen',
      title: 'Ибупрофен',
      shortTitle: null,
      sourceType: 'official_registry_summary',
      status: 'active',
      specialties: [],
      versionId: 'esklp.mnn.ibuprofen@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'Ибупрофен',
        smnnNodes: [
          {
            smnnCode: 'SMNN-SUSPENSION',
            dosageForm: 'Суспензия для приема внутрь',
            strength: '100 мг/5 мл',
            tradeNames: [
              {
                tradeName: 'Нурофен для детей',
                registrationNumber: 'ЛП-NUROFEN',
                dosageForm: 'Суспензия для приема внутрь',
                strength: '100 мг/5 мл',
              },
            ],
            klpPositions: [],
          },
        ],
      },
    })[0];
    if (!esklp) throw new Error('expected ESKLP product');
    const exactGrls = {
      ...esklp,
      sourceKind: 'grls' as const,
      registrationDocumentId: 'drug.registry.nurofen',
      grlsRegistrationDocumentId: 'drug.registry.nurofen',
      instructionDocumentId: 'drug.instruction.nurofen',
      registrationStatus: 'Действует',
    };
    const wrongTradeName = {
      ...exactGrls,
      registrationDocumentId: 'drug.registry.nurofen-plus',
      grlsRegistrationDocumentId: 'drug.registry.nurofen-plus',
      instructionDocumentId: 'drug.instruction.nurofen-plus',
      tradeName: 'Нурофен Плюс',
    };

    const composed = composeMedicationProducts([esklp, exactGrls, wrongTradeName], []);

    expect(composed).toHaveLength(2);
    expect(composed[0]).toMatchObject({
      sourceKind: 'esklp',
      tradeName: 'Нурофен для детей',
      mnnDocumentId: 'esklp.mnn.ibuprofen',
      grlsRegistrationDocumentId: 'drug.registry.nurofen',
      instructionDocumentId: 'drug.instruction.nurofen',
      registrationStatus: 'Действует',
    });
    expect(composed[1]).toMatchObject({
      sourceKind: 'grls',
      tradeName: 'Нурофен Плюс',
      instructionDocumentId: 'drug.instruction.nurofen-plus',
    });
  });

  it('merges Allmed text only through the explicit MNN document id', () => {
    const registry = parseEsklpMedicationProducts({
      id: 'esklp.mnn.miramistin',
      title: 'Мирамистин',
      shortTitle: null,
      sourceType: 'official_registry_summary',
      status: 'active',
      specialties: [],
      versionId: 'esklp.mnn.miramistin@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'Мирамистин',
        smnnNodes: [
          {
            smnnCode: 'smnn.solution',
            dosageForm: 'Раствор',
            strength: '0,01%',
            tradeNames: [
              {
                tradeName: 'Мирамистин',
                registrationNumber: 'РФ-MIR',
                dosageForm: 'Раствор',
                strength: '0,01%',
              },
            ],
            klpPositions: [],
          },
        ],
      },
    });
    const linked = parseAllmedMedicationProduct({
      id: 'allmed.linked',
      title: 'Мирамистин',
      shortTitle: null,
      sourceType: 'allmed_reference',
      status: 'reference',
      specialties: [],
      versionId: 'allmed.linked@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'allmed-snapshot',
        allmedId: 1,
        linkedMnnDocumentId: 'esklp.mnn.miramistin',
        shortDescription: 'Связанный текст',
      },
    });
    const wrongLink = parseAllmedMedicationProduct({
      id: 'allmed.wrong',
      title: 'Мирамистин',
      shortTitle: null,
      sourceType: 'allmed_reference',
      status: 'reference',
      specialties: [],
      versionId: 'allmed.wrong@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'allmed-snapshot',
        allmedId: 2,
        linkedMnnDocumentId: 'esklp.mnn.other',
        shortDescription: 'Чужой текст',
      },
    });
    if (!registry[0] || !linked || !wrongLink) throw new Error('expected medication fixtures');

    const enriched = mergeAllmedSupplementalText(registry[0], [linked, wrongLink]);
    expect(enriched.supplementalDescription).toBe('Связанный текст');
    expect(enriched.supplementalDescription).not.toContain('Чужой текст');
    expect(linked.linkedMnnDocumentId).toBe('esklp.mnn.miramistin');
  });

  it('scopes Allmed supplements to the exact normalized trade name', () => {
    const registry = parseEsklpMedicationProducts({
      id: 'esklp.mnn.ibuprofen',
      title: 'Ибупрофен',
      shortTitle: null,
      sourceType: 'official_registry_summary',
      status: 'active',
      specialties: [],
      versionId: 'esklp.mnn.ibuprofen@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'Ибупрофен',
        smnnNodes: [
          {
            smnnCode: 'smnn.tablet',
            dosageForm: 'Таблетки',
            tradeNames: [
              { tradeName: 'Нурофен', registrationNumber: 'RF-plain' },
              { tradeName: 'Нурофен Плюс', registrationNumber: 'RF-plus' },
              { tradeName: 'Нурофен Интенсив', registrationNumber: 'RF-intensive' },
            ],
            klpPositions: [],
          },
        ],
      },
    });
    const allmed = (id: number, tradeName: string, linkedMnnDocumentId: string, img: string) =>
      parseAllmedMedicationProduct({
        id: `allmed.${id}`,
        title: tradeName,
        shortTitle: null,
        sourceType: 'allmed_reference',
        status: 'reference',
        specialties: [],
        versionId: `allmed.${id}@1`,
        versionLabel: '1',
        effectiveFrom: null,
        sections: [],
        metadata: {
          contentMode: 'allmed-snapshot',
          allmedId: id,
          linkedMnnDocumentId,
          shortDescription: `Описание ${tradeName}`,
          img,
        },
      });
    const supplements = [
      allmed(1, 'Нурофен', 'esklp.mnn.ibuprofen', 'img/preparations/plain.jpg'),
      allmed(2, 'Нурофен Плюс', 'esklp.mnn.ibuprofen', 'img/preparations/plus.jpg'),
      allmed(3, 'Нурофен Интенсив', 'esklp.mnn.ibuprofen', 'img/preparations/intensive.jpg'),
      allmed(4, 'Нурофен', 'esklp.mnn.other', 'img/preparations/wrong-mnn.jpg'),
    ];
    const [plainProduct, plusProduct, intensiveProduct] = registry;
    const validSupplements = supplements.filter(
      (product): product is NonNullable<typeof product> => product !== null,
    );
    if (!plainProduct || !plusProduct || !intensiveProduct || validSupplements.length !== 4) {
      throw new Error('expected medication fixtures');
    }

    const plain = mergeAllmedSupplementalText(plainProduct, validSupplements);
    const plus = mergeAllmedSupplementalText(plusProduct, validSupplements);
    const intensive = mergeAllmedSupplementalText(intensiveProduct, validSupplements);

    expect(plain).toMatchObject({
      tradeName: 'Нурофен',
      supplementalDescription: 'Описание Нурофен',
      imageReference: 'img/preparations/plain.jpg',
    });
    expect(plus).toMatchObject({
      tradeName: 'Нурофен Плюс',
      supplementalDescription: 'Описание Нурофен Плюс',
      imageReference: 'img/preparations/plus.jpg',
    });
    expect(intensive).toMatchObject({
      tradeName: 'Нурофен Интенсив',
      supplementalDescription: 'Описание Нурофен Интенсив',
      imageReference: 'img/preparations/intensive.jpg',
    });
    expect(plain.supplementalDescription).not.toContain('Плюс');
    expect(plain.supplementalDescription).not.toContain('Интенсив');
    expect(plain.imageReference).not.toContain('wrong-mnn');
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

  it('opens the parent ESKLP MNN document for a concrete product variant', () => {
    const product = parseEsklpMedicationProducts({
      id: 'esklp.mnn.paracetamol',
      title: 'Парацетамол',
      shortTitle: null,
      sourceType: 'official_registry_summary',
      status: 'active',
      specialties: [],
      versionId: 'esklp.mnn.paracetamol@1',
      versionLabel: '1',
      effectiveFrom: null,
      sections: [],
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'Парацетамол',
        smnnNodes: [
          {
            smnnCode: 'smnn.tablet',
            dosageForm: 'Таблетки',
            strength: '500 мг',
            tradeNames: [
              {
                tradeName: 'Парацетамол',
                registrationNumber: 'РФ-PARA',
                dosageForm: 'Таблетки',
                strength: '500 мг',
              },
            ],
            klpPositions: [],
          },
        ],
      },
    })[0];
    if (!product) throw new Error('expected ESKLP product');
    expect(readableMedicationDocumentId(product)).toBe('esklp.mnn.paracetamol');
  });
});
