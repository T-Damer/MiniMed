import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { allmedMatchesProduct } from './allmed-matching';
import { instructionUnavailableNotice } from './instruction-offer';
import {
  isReferenceSnapshotContentMode,
  type MedicationProduct,
  medicationReadingChoices,
  mergeAllmedSupplementalText,
  parseAllmedMedicationProduct,
  parseEsklpMedicationProducts,
  referenceSourceLabel,
} from './medication-record';

/** A third-party reference entry (source type `allmed_reference`) with invented content. */
function referenceDocument(
  id: string,
  title: string,
  metadata: Readonly<Record<string, unknown>>,
): MedicalDocument {
  return {
    id,
    title,
    shortTitle: null,
    sourceType: 'allmed_reference',
    status: 'reference',
    specialties: [],
    versionId: `${id}@1`,
    versionLabel: '1',
    effectiveFrom: null,
    sections: [],
    metadata,
  };
}

const VIDAL_METADATA = {
  contentMode: 'drug-reference-snapshot',
  referenceSourceKey: 'vidal',
  referenceSourceName: 'Видаль',
  referenceId: 7,
  nameLat: 'TESTOVIN',
  linkedMnnDocumentId: 'esklp.mnn.testovin',
  shortDescription: 'Тестовое средство.',
} as const;

function registryProducts(): readonly MedicationProduct[] {
  return parseEsklpMedicationProducts({
    id: 'esklp.mnn.testovin',
    title: 'Тестовин',
    shortTitle: null,
    sourceType: 'official_registry_summary',
    status: 'active',
    specialties: [],
    versionId: 'esklp.mnn.testovin@1',
    versionLabel: '1',
    effectiveFrom: null,
    sections: [],
    metadata: {
      contentMode: 'esklp-mnn',
      standardizedInn: 'Тестовин',
      smnnNodes: [
        {
          smnnCode: 'smnn.tablet',
          dosageForm: 'ТАБЛЕТКИ',
          strength: '5 мг',
          tradeNames: [
            {
              tradeName: 'Тестовин',
              registrationNumber: 'ЛП-000123',
              dosageForm: 'ТАБЛЕТКИ',
              strength: '5 мг',
            },
            {
              tradeName: 'Проба-Форте',
              registrationNumber: 'ЛП-000789',
              dosageForm: 'ТАБЛЕТКИ',
              strength: '20 мг',
            },
          ],
          klpPositions: [],
        },
      ],
    },
  });
}

function product(tradeName: string): MedicationProduct {
  const found = registryProducts().find((candidate) => candidate.tradeName === tradeName);
  if (!found) throw new Error(`expected registry product ${tradeName}`);
  return found;
}

describe('generic reference entries', () => {
  it('accepts both content modes and nothing else', () => {
    expect(isReferenceSnapshotContentMode('allmed-snapshot')).toBe(true);
    expect(isReferenceSnapshotContentMode('drug-reference-snapshot')).toBe(true);
    expect(isReferenceSnapshotContentMode('esklp-mnn')).toBe(false);
    expect(isReferenceSnapshotContentMode(undefined)).toBe(false);
  });

  it('parses a reference entry with its own source name, id and covered registrations', () => {
    const parsed = parseAllmedMedicationProduct(
      referenceDocument('drug.vidal.7', 'ТЕСТОВИН (для приема внутрь)', {
        ...VIDAL_METADATA,
        tradeName: 'ТЕСТОВИН',
        productionForm: 'таблетки',
        registrationNumbers: ['ЛП-000123', ' ЛС-000456 '],
        referenceSourceUrl: 'https://example.test/vidal',
      }),
    );

    expect(parsed).toMatchObject({
      sourceKind: 'allmed',
      registrationNumber: 'vidal:7',
      tradeName: 'ТЕСТОВИН',
      inn: 'TESTOVIN',
      registrationStatus: 'Справочник Видаль',
      referenceSourceName: 'Видаль',
      referenceSourceUrl: 'https://example.test/vidal',
      servedRegistrationNumbers: ['ЛП-000123', 'ЛС-000456'],
      linkedMnnDocumentId: 'esklp.mnn.testovin',
      shortDescription: 'Тестовое средство.',
      instructionDocumentId: null,
    });
  });

  it('keeps an Allmed entry what it was and names its source', () => {
    const parsed = parseAllmedMedicationProduct(
      referenceDocument('drug.allmed.3', 'Тестовин', {
        contentMode: 'allmed-snapshot',
        allmedId: 3,
      }),
    );

    expect(parsed).toMatchObject({
      registrationNumber: 'allmed:3',
      registrationStatus: 'Справочник Allmed',
      referenceSourceName: 'Allmed',
      referenceSourceUrl: 'https://allmed.pro/',
    });
    expect(parsed?.servedRegistrationNumbers).toBeUndefined();
  });

  it('rejects unusable entries: no id, no source key, an unsafe source page, another source type', () => {
    expect(
      parseAllmedMedicationProduct(
        referenceDocument('x', 'Т', { ...VIDAL_METADATA, referenceId: undefined }),
      ),
    ).toBeNull();
    expect(
      parseAllmedMedicationProduct(
        referenceDocument('x', 'Т', { ...VIDAL_METADATA, referenceSourceKey: undefined }),
      ),
    ).toBeNull();
    expect(
      parseAllmedMedicationProduct({
        ...referenceDocument('x', 'Т', VIDAL_METADATA),
        sourceType: 'official_drug_instruction',
      }),
    ).toBeNull();
    const unsafe = parseAllmedMedicationProduct(
      referenceDocument('x', 'Т', { ...VIDAL_METADATA, referenceSourceUrl: 'javascript:alert(1)' }),
    );
    expect(unsafe?.referenceSourceUrl).toBeUndefined();
  });
});

describe('matching a reference entry to a registry product', () => {
  const vidal = (overrides: Readonly<Record<string, unknown>> = {}): MedicationProduct => {
    const parsed = parseAllmedMedicationProduct(
      referenceDocument('drug.vidal.7', 'ТЕСТОВИН', { ...VIDAL_METADATA, ...overrides }),
    );
    if (!parsed) throw new Error('expected a reference entry');
    return parsed;
  };

  it('matches by substance, trade name and compatible form like an Allmed entry', () => {
    expect(allmedMatchesProduct(product('Тестовин'), vidal({ productionForm: 'таблетки' }))).toBe(
      true,
    );
    expect(
      allmedMatchesProduct(product('Тестовин'), vidal({ productionForm: 'раствор для инъекций' })),
    ).toBe(false);
    expect(allmedMatchesProduct(product('Проба-Форте'), vidal())).toBe(false);
  });

  it('ignores a space around + in a combination trade name', () => {
    const combination = { ...product('Тестовин'), tradeName: 'Тестовин+Пробацил' };
    const entry = referenceDocument('drug.vidal.8', 'ТЕСТОВИН + ПРОБАЦИЛ', VIDAL_METADATA);
    const parsed = parseAllmedMedicationProduct(entry);
    if (!parsed) throw new Error('expected a reference entry');

    expect(allmedMatchesProduct(combination, parsed)).toBe(true);
  });

  it('matches a product whose registration the entry declares, whatever its name', () => {
    const entry = vidal({
      tradeName: 'ПРОБА',
      registrationNumbers: ['ЛП-000789'],
      productionForm: 'раствор',
    });

    expect(allmedMatchesProduct(product('Проба-Форте'), entry)).toBe(true);
    expect(allmedMatchesProduct(product('Тестовин'), entry)).toBe(false);
  });

  it('never matches across substances, even for a declared registration', () => {
    const entry = vidal({
      registrationNumbers: ['ЛП-000789'],
      linkedMnnDocumentId: 'esklp.mnn.other',
    });

    expect(allmedMatchesProduct(product('Проба-Форте'), entry)).toBe(false);
  });
});

describe('source labels', () => {
  it('names one, several or the default source', () => {
    expect(referenceSourceLabel(undefined)).toBe('Allmed');
    expect(referenceSourceLabel([])).toBe('Allmed');
    expect(referenceSourceLabel(['Видаль'])).toBe('Видаль');
    expect(referenceSourceLabel(['Allmed', 'Видаль', 'Allmed'])).toBe('Allmed и Видаль');
    expect(instructionUnavailableNotice('Видаль')).toBe(
      'Полная официальная инструкция пока недоступна — показана краткая справка Видаль.',
    );
  });

  it('shows the reference source in the short-version switch of a merged product', () => {
    const entry = parseAllmedMedicationProduct(
      referenceDocument('drug.vidal.7', 'Тестовин', VIDAL_METADATA),
    );
    if (!entry) throw new Error('expected a reference entry');

    const merged = mergeAllmedSupplementalText(product('Тестовин'), [entry]);

    expect(merged.supplementalDescription).toBe('Тестовое средство.');
    expect(merged.supplementalSourceNames).toEqual(['Видаль']);
    expect(medicationReadingChoices(merged, merged.registrationDocumentId).options[0]?.label).toBe(
      'Кратко (Видаль)',
    );
    expect(medicationReadingChoices(entry, entry.registrationDocumentId).options[0]?.label).toBe(
      'Кратко (Видаль)',
    );
  });
});
