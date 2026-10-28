import { describe, expect, it } from 'vitest';

import {
  type AssetCard,
  COMPARISON_INDEX_SCHEMA_VERSION,
  type ComparisonIndexAsset,
  createComparisonIndex,
} from '@/features/drug-comparison/comparison-index';
import { drugNameEntries } from './drug-name-match';
import { drugPopularity, rankDrugSuggestions, sentenceCase, suggestionForms } from './drug-suggest';

function card(name: string, parts: Partial<Pick<AssetCard, 'f' | 'r' | 'm'>> = {}): AssetCard {
  return {
    s: name.toLowerCase().replaceAll(/[^а-яa-z]+/gu, '-'),
    n: name,
    a: [],
    g: [],
    f: parts.f ?? [[0, ['50 мг'], 2]],
    r: parts.r ?? 10,
    t: 1,
    m: parts.m ?? 3,
    h: 1,
    x: null,
  };
}

const FORMS = ['таблетки, покрытые оболочкой', 'капсулы', 'раствор для инъекций'];

function asset(
  cards: readonly AssetCard[],
  trade: Readonly<Record<string, number>> = {},
): ComparisonIndexAsset {
  return {
    schemaVersion: COMPARISON_INDEX_SCHEMA_VERSION,
    basis: { esklp: { edition: 'test' }, grls: { edition: 'test' }, modules: [] },
    modules: ['test'],
    forms: FORMS,
    cards,
    documents: Object.fromEntries(
      Object.entries(trade).map(([title, position], index) => [
        `doc.${index}`,
        { c: [position], m: 0, t: title, k: 0, s: 0, f: 0, y: 0 },
      ]),
    ),
  };
}

function rank(
  cards: readonly AssetCard[],
  query: string,
  trade: Readonly<Record<string, number>> = {},
  limit?: number,
) {
  const fake = asset(cards, trade);
  return rankDrugSuggestions(createComparisonIndex(fake), drugNameEntries(fake), query, limit);
}

describe('drug suggestions', () => {
  it('writes the МНН in sentence case', () => {
    expect(sentenceCase('САЛЬБУТАМОЛ')).toBe('Сальбутамол');
    expect(sentenceCase('валсартан+САКУБИТРИЛ')).toBe('Валсартан+сакубитрил');
  });

  it('puts a fuller name match before a more popular partial one', () => {
    const result = rank(
      [
        card('АМЛОДИПИН+ВАЛСАРТАН', { r: 900, m: 80, f: [[0, ['5 мг'], 1]] }),
        card('ВАЛСАРТАН', { r: 5, m: 1 }),
      ],
      'валсартан',
    );
    expect(result.map((item) => item.name)).toEqual(['Валсартан', 'Амлодипин+валсартан']);
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
  });

  it('orders equal scores by ЖНВЛП, then by the size of the market', () => {
    const result = rank(
      [
        card('АМЛОДИПИН+ЛИЗИНОПРИЛ', { r: 300, m: 40, f: [[0, ['5 мг'], 2]] }),
        card('АМЛОДИПИН+ВАЛСАРТАН', { r: 20, m: 4, f: [[0, ['5 мг'], 1]] }),
        card('АМЛОДИПИН+ТЕЛМИСАРТАН', { r: 60, m: 9, f: [[0, ['5 мг'], 2]] }),
      ],
      'амлодипин',
    );
    expect(result.map((item) => item.name)).toEqual([
      'Амлодипин+валсартан',
      'Амлодипин+лизиноприл',
      'Амлодипин+телмисартан',
    ]);
    expect(result.map((item) => item.essential)).toEqual([true, false, false]);
  });

  it('reports the trade name when the typed words matched it', () => {
    const result = rank([card('СЕРТРАЛИН')], 'золофт', { 'Золофт®': 0 });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Сертралин');
    expect(result[0]?.product).toBe('Золофт');
    expect(rank([card('СЕРТРАЛИН')], 'сертрал', { Золофт: 0 })[0]?.product).toBeNull();
  });

  it('cuts to the limit and returns nothing for a too short or unknown text', () => {
    const cards = Array.from({ length: 12 }, (_, index) => card(`ЛЕКАРСТВО${'А'.repeat(index)}`));
    expect(rank(cards, 'лекарство', {}, 5)).toHaveLength(5);
    expect(rank(cards, 'ле')).toEqual([]);
    expect(rank(cards, 'нет такого')).toEqual([]);
  });

  it('groups the forms of a card with their distinct strengths, listed forms first', () => {
    const forms = suggestionForms(
      card('ТЕСТ', {
        f: [
          [1, ['10 мг'], 2],
          [0, ['50 мг', '100 мг', '200 мг'], 2],
          [1, ['10 мг', '20 мг'], 2],
          [2, ['5 мг/мл'], 1],
        ],
      }),
      FORMS,
    );
    expect(forms).toEqual([
      { form: 'раствор для инъекций', strengths: ['5 мг/мл'] },
      { form: 'таблетки, покрытые оболочкой', strengths: ['50 мг', '100 мг', '200 мг'] },
      { form: 'капсулы', strengths: ['10 мг', '20 мг'] },
    ]);
  });

  it('keeps the popularity proxy within [0, 1] and monotone', () => {
    const small = drugPopularity(card('А', { r: 1, m: 1, f: [[0, [], 2]] }));
    const big = drugPopularity(card('Б', { r: 5000, m: 500, f: [[0, [], 1]] }));
    expect(small).toBeGreaterThanOrEqual(0);
    expect(big).toBeLessThanOrEqual(1);
    expect(big).toBeGreaterThan(small);
  });
});
