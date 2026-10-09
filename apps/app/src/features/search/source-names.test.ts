import type { SearchDocumentDescriptor } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildSourceCatalog,
  detectSourceNameIntent,
  labelPhrases,
  type SourceCollection,
} from '@/features/search/source-names';

function descriptor(
  id: string,
  title: string,
  metadata: Record<string, unknown> = {},
  sourceType = 'core_catalog_pointer',
): SearchDocumentDescriptor {
  return { id, title, shortTitle: null, sourceType, metadata };
}

function many(count: number, prefix: string, metadata: Record<string, unknown>) {
  return Array.from({ length: count }, (_, index) =>
    descriptor(`${prefix}.${index}`, `${prefix} ${index}`, metadata),
  );
}

const COLLECTIONS: readonly SourceCollection[] = [
  {
    id: 'clinical-recommendation',
    label: 'Клинические рекомендации',
    matches: (document) => document.sourceType === 'clinical_recommendation',
  },
  {
    id: 'icd10',
    label: 'МКБ-10',
    matches: (document) => typeof document.metadata?.['mkbCode'] === 'string',
  },
];

const DOCUMENTS = [
  ...many(5, 'kim', { publisher: 'Красота и медицина' }),
  ...many(4, 'allmed', { sourceLabel: 'Allmed snapshot' }),
  ...many(3, 'order', { issuer: 'Министерство здравоохранения Российской Федерации' }),
  ...many(3, 'rls', { publisher: 'Регистр лекарственных средств России', mkbCode: 'J18' }),
  ...Array.from({ length: 3 }, (_, index) =>
    descriptor(`kr.${index}`, `Рекомендация ${index}`, {}, 'clinical_recommendation'),
  ),
  // Too few documents, or a description instead of a name.
  ...many(1, 'single', { publisher: 'Единичный издатель' }),
  ...many(6, 'web', {
    publisher: 'multiple general medical/nutrition web sources, no single official body',
  }),
  descriptor('title.kim', 'Красота'),
];
const CATALOG = buildSourceCatalog(DOCUMENTS, COLLECTIONS);

const detect = (query: string) => detectSourceNameIntent(query, CATALOG);

describe('labelPhrases', () => {
  it('derives the whole name, its initialism and a ministry abbreviation from a label', () => {
    expect(labelPhrases('Красота и медицина')).toEqual([['красота', 'и', 'медицина'], ['ким']]);
    expect(labelPhrases('Регистр лекарственных средств России')).toEqual([
      ['регистр', 'лекарственных', 'средств'],
      ['рлс'],
    ]);
    expect(labelPhrases('Министерство здравоохранения Российской Федерации').flat()).toContain(
      'минздрав',
    );
  });

  it('reads Latin names in Cyrillic and drops a trailing generic word', () => {
    const phrases = labelPhrases('Allmed snapshot').map((phrase) => phrase.join(' '));
    expect(phrases).toContain('allmed');
    expect(phrases).toContain('аллмед');
    expect(phrases).not.toContain('allmed snapshot');
  });

  it('offers the words inside brackets as a name of their own', () => {
    const phrases = labelPhrases('ВОЗ (WHO)').map((phrase) => phrase.join(' '));
    expect(phrases).toEqual(['воз', 'who']);
  });
});

describe('buildSourceCatalog', () => {
  it('lists sources by metadata and declared collections, without tiny or descriptive ones', () => {
    expect(CATALOG.sources.map((source) => source.label).toSorted()).toEqual([
      'Allmed',
      'Клинические рекомендации',
      'Красота и медицина',
      'МКБ-10',
      'Министерство здравоохранения Российской Федерации',
      'Регистр лекарственных средств России',
    ]);
  });
});

describe('detectSourceNameIntent', () => {
  it('reads a bare source name, in any case and with aliases', () => {
    for (const query of ['Красота и медицина', 'красота и медицина', 'КиМ', 'ким']) {
      const intent = detect(query);
      expect(intent?.label, query).toBe('Красота и медицина');
      expect(intent?.remainder, query).toBe('');
      expect(intent?.documentIds.size, query).toBe(5);
    }
    expect(detect('Аллмед')?.label).toBe('Allmed');
    expect(detect('Allmed')?.label).toBe('Allmed');
    expect(detect('РЛС')?.label).toBe('Регистр лекарственных средств России');
  });

  it('tells the whole name from a short form of it', () => {
    expect(detect('Красота и медицина')?.exactName).toBe(true);
    expect(detect('красоте и медицине')?.exactName).toBe(true);
    expect(detect('КиМ')?.exactName).toBe(false);
    expect(detect('Минздрав')?.exactName).toBe(false);
    expect(detect('Аллмед')?.exactName).toBe(false);
    expect(detect('Allmed')?.exactName).toBe(true);
  });

  it('keeps the rest of the query as the text to search inside the source', () => {
    expect(detect('Красота и медицина пневмония')?.remainder).toBe('пневмония');
    expect(detect('пневмония красота и медицина')?.remainder).toBe('пневмония');
    expect(detect('аллмед нурофен 200 мг')?.remainder).toBe('нурофен 200 мг');
    expect(detect('МКБ-10 J18.9')?.remainder).toBe('J18.9');
    expect(detect('клинические рекомендации по пневмонии')?.remainder).toBe('пневмонии');
  });

  it('finds a long name in the middle of a query, a short one only at its ends', () => {
    expect(detect('приказ минздрава 203н')?.remainder).toBe('приказ 203н');
    expect(detect('лечение ким пневмония')).toBeUndefined();
    expect(detect('пневмония ким')?.remainder).toBe('пневмония');
  });

  it('recognises inflected names and the singular of a collection', () => {
    expect(detect('приказ минздрава')?.remainder).toBe('приказ');
    expect(detect('Минздрав')?.documentIds.size).toBe(3);
    expect(detect('клиническая рекомендация мигрень')?.label).toBe('Клинические рекомендации');
  });

  it('does not read ordinary queries, unknown sources or document titles as a source', () => {
    expect(detect('пневмония')).toBeUndefined();
    expect(detect('Видаль')).toBeUndefined();
    expect(detect('ГРЛС')).toBeUndefined();
    expect(detect('красота')).toBeUndefined();
    expect(detect('медицина красота')).toBeUndefined();
    expect(detect('мкб пневмония')).toBeUndefined();
    expect(detect('Единичный издатель')).toBeUndefined();
    expect(detect('')).toBeUndefined();
  });

  it('never reads a document title as a source name', () => {
    const catalog = buildSourceCatalog(
      [
        ...many(5, 'kim', { publisher: 'Красота и медицина' }),
        descriptor('title', 'Красота и медицина'),
      ],
      [],
    );
    expect(detectSourceNameIntent('красота и медицина', catalog)).toBeUndefined();
    expect(detectSourceNameIntent('красота и медицина пневмония', catalog)?.remainder).toBe(
      'пневмония',
    );
  });

  it('prefers the longest name and a name at the start over one at the end', () => {
    const catalog = buildSourceCatalog(
      [
        ...many(4, 'a', { publisher: 'Первый источник' }),
        ...many(4, 'b', { publisher: 'Второй' }),
        ...many(4, 'c', { publisher: 'Первый источник второй' }),
      ],
      [],
    );
    expect(detectSourceNameIntent('первый источник второй пневмония', catalog)?.label).toBe(
      'Первый источник второй',
    );
    expect(detectSourceNameIntent('первый источник второй', catalog)?.label).toBe(
      'Первый источник второй',
    );
  });
});
