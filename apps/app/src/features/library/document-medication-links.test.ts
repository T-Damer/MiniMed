import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildDocumentLinkPhrases,
  buildMedicationLinkPhrases,
  segmentTextWithMedicationLinks,
} from '@/features/library/document-medication-links';

const medication = (
  id: string,
  title: string,
  shortTitle: string | null = null,
): MedicalDocumentSummary => ({
  id,
  title,
  shortTitle,
  sourceType: 'official_registry_summary',
  status: 'active',
  specialties: [],
  versionId: 'v1',
  versionLabel: 'registry',
  effectiveFrom: null,
});

describe('document-medication-links', () => {
  it('indexes INN phrases from installed medication cards', () => {
    const links = buildMedicationLinkPhrases([
      medication(
        'drug.rf.ceftriaxone.injection-1g',
        'Цефтриаксон — порошок 1 г',
        'Цефтриаксон 1 г',
      ),
    ]);

    expect(links.map((link) => link.phrase)).toEqual(['Цефтриаксон 1 г', 'Цефтриаксон']);
  });

  it('links medication mentions inside clinical text', () => {
    const links = buildMedicationLinkPhrases([
      medication('drug.rf.ceftriaxone.injection-1g', 'Цефтриаксон — порошок 1 г'),
    ]);
    const segments = segmentTextWithMedicationLinks(
      'При тяжёлом течении назначают цефтриаксон внутримышечно.',
      links,
    );

    expect(segments).toEqual([
      { kind: 'text', value: 'При тяжёлом течении назначают ' },
      { kind: 'link', value: 'цефтриаксон', documentId: 'drug.rf.ceftriaxone.injection-1g' },
      { kind: 'text', value: ' внутримышечно.' },
    ]);
  });

  it('indexes installed conditions and laws as cross-links', () => {
    const documents: MedicalDocumentSummary[] = [
      {
        ...medication('clinical.pneumonia', 'Клинические рекомендации — Пневмония у детей'),
        sourceType: 'clinical_recommendation_summary',
        shortTitle: 'Пневмония у детей',
      },
      {
        ...medication('law.323-fz', 'Федеральный закон № 323-ФЗ'),
        sourceType: 'regulatory_act',
        shortTitle: '323-ФЗ',
      },
    ];

    expect(buildDocumentLinkPhrases(documents).map((link) => link.phrase)).toEqual([
      'Федеральный закон № 323-ФЗ',
      'Пневмония у детей',
      '323-ФЗ',
    ]);
  });
});
