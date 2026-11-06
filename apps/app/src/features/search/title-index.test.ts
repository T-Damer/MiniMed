import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { buildTitleIndex } from './title-index';

function doc(id: string, title: string): MedicalDocumentSummary {
  return {
    id,
    title,
    shortTitle: null,
    sourceType: 'reference',
    metadata: {},
  } as unknown as MedicalDocumentSummary;
}

const DOCUMENTS = [
  doc('a', 'Шизофрения у взрослых'),
  doc('b', 'Шизофрения'),
  doc('c', 'Шизотипическое расстройство'),
  doc('d', 'Гастрит и дуоденит'),
  doc('e', 'Хронический гастрит'),
  doc('f', 'Пневмония у детей'),
];

describe('title index', () => {
  it('finds titles by a word or its start, the exact name first', () => {
    const index = buildTitleIndex(DOCUMENTS);
    expect(index.lookup('шизофрения', 5).map((item) => item.id)).toEqual(['b', 'a']);
    expect(index.lookup('шизо', 5).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(index.lookup('Гастрит', 5).map((item) => item.id)).toEqual(['d', 'e']);
  });

  it('needs every word, leaves sentences and short words to the full search', () => {
    const index = buildTitleIndex(DOCUMENTS);
    expect(index.lookup('пневмония детей', 5).map((item) => item.id)).toEqual(['f']);
    expect(index.lookup('пневмония взрослых', 5)).toEqual([]);
    expect(index.lookup('у', 5)).toEqual([]);
    expect(index.lookup('кашель и температура третий день', 5)).toEqual([]);
  });

  it('lists an installed document once, not its module pointer too', () => {
    const pointer = {
      ...doc('pointer.b', 'Шизофрения'),
      metadata: { targetDocumentId: 'b' },
    } as MedicalDocumentSummary;
    const index = buildTitleIndex([...DOCUMENTS, pointer]);
    expect(index.lookup('шизофрения', 5).map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('keeps only accepted documents and reports its size', () => {
    const index = buildTitleIndex(DOCUMENTS);
    expect(index.lookup('шизофрения', 5, (item) => item.id !== 'b').map((item) => item.id)).toEqual(
      ['a'],
    );
    expect(index.stats.documents).toBe(6);
    expect(index.stats.words).toBeGreaterThan(5);
    expect(index.stats.bytes).toBeGreaterThan(0);
  });
});
