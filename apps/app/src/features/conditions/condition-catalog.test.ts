import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { fuzzyQueryScore } from '../../state/fuzzy-text';
import { buildConditionCatalog } from './condition-catalog';

function document(
  id: string,
  title: string,
  sourceType: string,
  metadata: Readonly<Record<string, unknown>>,
): MedicalDocumentSummary {
  return {
    id,
    title,
    shortTitle: null,
    sourceType,
    status: 'active',
    specialties: [],
    metadata,
    versionId: `${id}.v1`,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

describe('buildConditionCatalog', () => {
  it('keeps all attributed definitions without copying a recommendation’s other codes', () => {
    const definition = (id: string) => ({
      definitionId: id,
      text: `Исходное определение ${id}.`,
      sourceDocumentId: id,
      sourceDocumentVersionId: `${id}.v1`,
      sourceSectionId: 'section.definition',
      sourceChunkId: `${id}.chunk`,
      sourceAnchor: `${id}#definition`,
      sourceSectionTitle: '1.1 Определение заболевания',
    });
    const catalog = buildConditionCatalog([
      document('mkb.i10', 'I10 Эссенциальная гипертензия', 'rls_mkb_reference', { mkbCode: 'I10' }),
      document('mkb.i11', 'I11 Гипертензивная болезнь сердца', 'rls_mkb_reference', {
        mkbCode: 'I11',
      }),
      document('reference', 'Справочная статья', 'medical_reference', {
        entityType: 'disease',
        icd10Codes: ['I10'],
        canonicalDefinition: definition('reference'),
      }),
      document('kr', 'Артериальная гипертензия', 'clinical_recommendation', {
        contentMode: 'module-pointer',
        definitionPreviewAnchor: 'local-preview#definition',
        icd10Codes: ['I10', 'I11'],
        canonicalDefinition: definition('kr'),
      }),
    ]);
    const entry = catalog.find((item) => item.id === 'code:I10');
    expect(entry?.codes).toEqual(['I10']);
    expect(entry?.definitions[0]?.readerAnchor).toBe('local-preview#definition');
    expect(entry?.definitions[0]?.sourceAnchor).toBe('kr#definition');
    expect(entry?.definitions.map((item) => [item.sourceTitle, item.sourceKind])).toEqual([
      ['Артериальная гипертензия', 'recommendation'],
      ['Справочная статья', 'reference'],
    ]);
    expect(catalog.find((item) => item.id === 'code:I11')?.codes).toEqual(['I11']);
    expect(catalog.find((item) => item.id === 'code:I11')?.definitions).toHaveLength(1);
  });

  it('keeps the parent ICD rubric visible for names that depend on classification context', () => {
    const [entry] = buildConditionCatalog([
      document('mkb.t51.2', 'T51.2 2-пропанола, МКБ-10', 'rls_mkb_reference', {
        mkbCode: 'T51.2',
        classificationPath: [{ code: 'T51', title: 'Токсическое действие алкоголя' }],
      }),
    ]);
    expect(entry?.title).toBe('Токсическое действие алкоголя — 2-пропанола');
    expect(entry?.sources[0]?.title).toBe(entry?.title);
  });

  it.each([
    ['А09', 'A09'],
    ['С50', 'C50'],
    ['Е11', 'E11'],
    ['М16', 'M16'],
  ])('filters a canonical code when the query uses Cyrillic lookalikes: %s', (query, code) => {
    const [entry] = buildConditionCatalog([
      document(`mkb.${code}`, `${code} Заболевание, МКБ-10`, 'rls_mkb_reference', {
        mkbCode: code,
      }),
    ]);

    expect(entry?.codes).toEqual([code]);
    expect(
      fuzzyQueryScore(query, [
        entry?.title ?? '',
        ...(entry?.codes ?? []),
        ...(entry?.searchTerms ?? []),
      ]),
    ).toBeGreaterThan(0);
  });

  it('canonicalizes Cyrillic code metadata and strips it from the displayed title', () => {
    const [entry] = buildConditionCatalog([
      document('mkb.a09', 'А09 Холера, МКБ-10', 'rls_mkb_reference', { mkbCode: 'А 09' }),
    ]);

    expect(entry).toMatchObject({ id: 'code:A09', title: 'Холера', codes: ['A09'] });
  });

  it('groups recommendations with MKB entries and classifies symptoms and other conditions', () => {
    const catalog = buildConditionCatalog([
      document('mkb.i10', 'I10 Эссенциальная гипертензия, МКБ-10', 'rls_mkb_reference', {
        mkbCode: 'I10',
      }),
      document('mkb.r51', 'R51 Головная боль, МКБ-10', 'rls_mkb_reference', {
        mkbCode: 'R51',
      }),
      document('mkb.s52', 'S52 Перелом предплечья, МКБ-10', 'rls_mkb_reference', {
        mkbCode: 'S52',
      }),
      document('mkb.e80', 'E80.4 Синдром Жильбера, МКБ-10', 'rls_mkb_reference', {
        mkbCode: 'E80.4',
      }),
      document('kr.i10.pointer', 'Артериальная гипертензия', 'core_catalog_pointer', {
        entityType: 'disease',
        catalogFamily: 'clinical',
        contentMode: 'module-pointer',
        targetDocumentId: 'kr.i10',
        icd10Codes: ['I10'],
        canonicalDefinition: {
          definitionId: 'clinical.definition.i10.fixture',
          text: 'Стойкое повышение артериального давления.',
          sourceDocumentId: 'kr.i10',
          sourceDocumentVersionId: 'kr.i10.v1',
          sourceSectionId: 'section.terms',
          sourceChunkId: 'chunk.terms',
          sourceAnchor: 'terms#chunk-terms',
          sourceSectionTitle: 'Термины и определения',
        },
      }),
      document('kr.i10', 'Артериальная гипертензия', 'clinical_recommendation', {
        entityType: 'disease',
        icd10Codes: ['I10'],
      }),
    ]);

    expect(catalog).toHaveLength(4);
    expect(catalog.find((entry) => entry.codes.includes('I10'))).toMatchObject({
      title: 'Эссенциальная гипертензия',
      section: 'diseases',
    });
    expect(catalog.find((entry) => entry.codes.includes('I10'))?.sources).toHaveLength(2);
    expect(catalog.find((entry) => entry.codes.includes('I10'))?.sources[0]?.documentId).toBe(
      'kr.i10',
    );
    expect(catalog.find((entry) => entry.codes.includes('I10'))?.definitions[0]).toMatchObject({
      id: 'clinical.definition.i10.fixture',
      text: 'Стойкое повышение артериального давления.',
      pointerDocumentId: 'kr.i10.pointer',
      sourceDocumentId: 'kr.i10',
      sourceAnchor: 'terms#chunk-terms',
    });
    expect(catalog.find((entry) => entry.codes.includes('R51'))?.section).toBe('symptoms');
    expect(catalog.find((entry) => entry.codes.includes('S52'))?.section).toBe('conditions');
    expect(catalog.find((entry) => entry.codes.includes('E80.4'))?.section).toBe('syndromes');
  });

  it('keeps a multi-code recommendation as one entry until the MKB catalog is installed', () => {
    const catalog = buildConditionCatalog([
      document('kr.hypertension', 'Артериальная гипертензия', 'core_catalog_pointer', {
        entityType: 'disease',
        icd10Codes: ['I10', 'I11', 'I12'],
      }),
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.codes).toEqual(['I10', 'I11', 'I12']);
  });

  it('merges separate recommendation editions with the same disease title', () => {
    const catalog = buildConditionCatalog([
      document('kr.aplastic.adult', 'Апластическая анемия', 'core_catalog_pointer', {
        entityType: 'disease',
        targetDocumentId: 'kr.aplastic.adult.full',
        icd10Codes: ['D61.1', 'D61.9'],
      }),
      document('kr.aplastic.child', 'Апластическая анемия', 'core_catalog_pointer', {
        entityType: 'disease',
        targetDocumentId: 'kr.aplastic.child.full',
        icd10Codes: ['D61.3', 'D61.9'],
      }),
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      title: 'Апластическая анемия',
      codes: ['D61.1', 'D61.3', 'D61.9'],
    });
    expect(catalog[0]?.sources).toHaveLength(2);
  });

  it('keeps an explicitly typed disease out of symptoms when it has an auxiliary R code', () => {
    const [entry] = buildConditionCatalog([
      document('kr.diabetes', 'Сахарный диабет', 'core_catalog_pointer', {
        entityType: 'disease',
        icd10Codes: ['E11.9', 'R73.9'],
      }),
    ]);

    expect(entry?.section).toBe('diseases');
  });

  it('includes an explicitly typed syndrome from a generic reference source', () => {
    const [entry] = buildConditionCatalog([
      document('reference.gilbert', 'Синдром Жильбера', 'medical_reference', {
        entityType: 'syndrome',
        icd10Codes: ['E80.4'],
      }),
    ]);

    expect(entry?.section).toBe('syndromes');
  });

  it('uses compact MKB pointers as classification entries and joins recommendations by code', () => {
    const catalog = buildConditionCatalog([
      document('core.mkb.i10', 'I10 Эссенциальная гипертензия, МКБ-10', 'core_catalog_pointer', {
        contentMode: 'module-pointer',
        sourceType: 'rls_mkb_reference',
        entityType: 'disease',
        targetDocumentId: 'mkb.i10',
        mkbCode: 'I10',
      }),
      document('core.kr.i10', 'Артериальная гипертензия', 'core_catalog_pointer', {
        contentMode: 'module-pointer',
        catalogFamily: 'clinical',
        targetDocumentId: 'kr.i10',
        icd10Codes: ['I10'],
      }),
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: 'code:I10',
      title: 'Эссенциальная гипертензия',
      section: 'diseases',
    });
    expect(catalog[0]?.sources.map((source) => source.kind)).toEqual([
      'recommendation',
      'classification',
    ]);
  });
});
