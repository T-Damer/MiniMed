import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildDocumentLinkPhrases,
  buildMedicationLinkPhrases,
  createDocumentLinkMatcher,
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

const recommendation = (
  id: string,
  title: string,
  shortTitle: string | null = null,
): MedicalDocumentSummary => ({
  ...medication(id, title, shortTitle),
  sourceType: 'clinical_recommendation_summary',
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

  it('does not link a recommendation to its own topic card or title', () => {
    const documents: MedicalDocumentSummary[] = [
      recommendation('kr.rf.281_3', 'Инфекция мочевых путей', 'ИМП'),
      recommendation('kr.rf.281_3.uti', 'Инфекция мочевых путей', 'ИМП у детей'),
      recommendation('clinical.pneumonia', 'Пневмония у детей', 'Пневмония у детей'),
    ];

    const links = buildDocumentLinkPhrases(documents, 'kr.rf.281_3');
    expect(links.map((link) => link.documentId)).toEqual(['clinical.pneumonia']);

    const segments = segmentTextWithMedicationLinks(
      'ИМП — инфекция мочевых путей. См. также пневмония у детей.',
      links,
    );
    expect(segments).toEqual([
      { kind: 'text', value: 'ИМП — инфекция мочевых путей. См. также ' },
      {
        kind: 'link',
        value: 'пневмония у детей',
        documentId: 'clinical.pneumonia',
        linkKind: 'recommendation',
      },
      { kind: 'text', value: '.' },
    ]);
  });

  it('does not link a phrase inside a longer word', () => {
    const segments = segmentTextWithMedicationLinks('цефтриаксонный раствор', [
      { phrase: 'цефтриаксон', documentId: 'drug.rf.ceftriaxone', kind: 'medication' },
    ]);
    expect(segments).toEqual([{ kind: 'text', value: 'цефтриаксонный раствор' }]);
  });

  it('matches flexible whitespace and ё/е', () => {
    const segments = segmentTextWithMedicationLinks('Пневмония   у   детёй.', [
      {
        phrase: 'Пневмония у детей',
        documentId: 'clinical.pneumonia',
        kind: 'recommendation',
      },
    ]);
    expect(segments).toEqual([
      {
        kind: 'link',
        value: 'Пневмония   у   детёй',
        documentId: 'clinical.pneumonia',
        linkKind: 'recommendation',
      },
      { kind: 'text', value: '.' },
    ]);
  });

  it('indexes a large phrase list without compiling a catalog-sized regex', () => {
    const links = Array.from({ length: 4000 }, (_, index) => ({
      phrase: `препарат-${index}`,
      documentId: `drug.rf.example-${index}`,
      kind: 'medication' as const,
    }));
    links[42] = {
      phrase: 'цефтриаксон',
      documentId: 'drug.rf.ceftriaxone.injection-1g',
      kind: 'medication',
    };

    const indexedAt = performance.now();
    const matcher = createDocumentLinkMatcher(links);
    expect(performance.now() - indexedAt).toBeLessThan(50);

    const paragraphs = Array.from(
      { length: 350 },
      (_, index) =>
        `Раздел ${index + 1}. При тяжёлом течении назначают цефтриаксон внутримышечно. Контроль состояния обязателен.`,
    );

    const started = performance.now();
    let hits = 0;
    for (const paragraph of paragraphs) {
      const segments = matcher.segment(paragraph);
      if (segments.some((segment) => segment.kind === 'link')) hits += 1;
    }
    const elapsed = performance.now() - started;

    expect(hits).toBe(paragraphs.length);
    expect(elapsed).toBeLessThan(800);
  });
});
