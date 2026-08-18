import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildDocumentLinkPhrases,
  buildMedicationLinkPhrases,
  parseDocumentText,
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
  it('turns OCR bullets into list items without losing the text', () => {
    expect(
      parseDocumentText(
        'Введение • Рекомендуется #дексаметазон** (H02AB)\n\nдля лечения.\n\n• Наблюдать.',
      ),
    ).toEqual([
      { kind: 'paragraph', text: 'Введение' },
      {
        kind: 'bullet',
        text: 'Рекомендуется #дексаметазон** (H02AB) для лечения.',
      },
      { kind: 'bullet', text: 'Наблюдать.' },
    ]);
  });

  it('keeps numbered instructions as an ordered list', () => {
    expect(parseDocumentText('1. Первый шаг\n\n2. Второй шаг')).toEqual([
      { kind: 'ordered', ordinal: 1, text: 'Первый шаг' },
      { kind: 'ordered', ordinal: 2, text: 'Второй шаг' },
    ]);
  });

  it('uses PDF indentation to stop a list before the following paragraph', () => {
    expect(
      parseDocumentText('• Пункт начинается\n\nи продолжается.\n\nСледующий раздел', [
        { bbox: [100, 0, 0, 0] },
        { bbox: [120, 0, 0, 0] },
        { bbox: [80, 0, 0, 0] },
      ]),
    ).toEqual([
      { kind: 'bullet', text: 'Пункт начинается и продолжается.' },
      { kind: 'paragraph', text: 'Следующий раздел' },
    ]);
  });

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
      {
        kind: 'link',
        value: 'цефтриаксон',
        documentId: 'drug.rf.ceftriaxone.injection-1g',
        linkKind: 'medication',
      },
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

    const links = buildDocumentLinkPhrases(documents);
    expect(links.find((link) => link.documentId === 'law.323-fz')?.kind).toBe('document');
    expect(links.find((link) => link.documentId === 'clinical.pneumonia')?.kind).toBe(
      'recommendation',
    );
  });
});
