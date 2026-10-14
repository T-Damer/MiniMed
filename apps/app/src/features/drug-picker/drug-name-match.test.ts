import { describe, expect, it } from 'vitest';

import type { ComparisonIndexAsset } from '@/features/drug-comparison/comparison-index';
import { drugNameEntries, drugNameWords, matchDrugNames } from './drug-name-match';

function asset(
  cards: readonly string[],
  trade: Readonly<Record<string, number>> = {},
): ComparisonIndexAsset {
  return {
    cards: cards.map((name) => ({
      s: name.toLowerCase().replaceAll(/[^а-яa-z]+/gu, '-'),
      n: name,
    })),
    documents: Object.fromEntries(
      Object.entries(trade).map(([title, card], index) => [
        `doc.${index}`,
        { c: [card], t: title },
      ]),
    ),
  } as unknown as ComparisonIndexAsset;
}

const ENTRIES = drugNameEntries(
  asset(
    [
      'ВАЛСАРТАН',
      'ВАЛСАРТАН+САКУБИТРИЛ',
      'АМЛОДИПИН+ВАЛСАРТАН+ГИДРОХЛОРОТИАЗИД',
      'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
      'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА+АСКОРБИНОВАЯ КИСЛОТА',
      'АМОКСИЦИЛЛИН+КЛАВУЛАНОВАЯ КИСЛОТА',
      'ЭНАЛАПРИЛ',
    ],
    { 'Аспирин®': 3, 'Аспирин® Кардио': 3, Амоксиклав: 5, 'Эналаприл-ФПО': 6 },
  ),
);
const slugs = (query: string) => matchDrugNames(ENTRIES, query).map((match) => match.name);

describe('drug name matcher (SRCH1, item 4)', () => {
  it('splits a name at every separator', () => {
    expect(drugNameWords('Сакубитрил/валсартан + (Ё-тест) 2,5')).toEqual([
      'сакубитрил',
      'валсартан',
      'тест',
      '2',
      '5',
    ]);
  });

  it('finds a combination by any one component', () => {
    expect(slugs('сакубитрил')).toEqual(['ВАЛСАРТАН+САКУБИТРИЛ']);
    expect(slugs('валсартан')[0]).toBe('ВАЛСАРТАН');
    expect(slugs('валсартан')).toContain('ВАЛСАРТАН+САКУБИТРИЛ');
  });

  it('finds it in any order and with any separator', () => {
    for (const query of [
      'сакубитрил/валсартан',
      'валсартан+сакубитрил',
      'сакубитрил валсартан',
      'Сакубитрил + Валсартан',
      'сакубитрил, валсартан',
      'валсартан-сакубитрил',
    ]) {
      expect(slugs(query)[0], query).toBe('ВАЛСАРТАН+САКУБИТРИЛ');
    }
  });

  it('matches the start of any word, not only of the name', () => {
    expect(slugs('кисл')).toContain('АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА');
    expect(slugs('клавул')).toEqual(['АМОКСИЦИЛЛИН+КЛАВУЛАНОВАЯ КИСЛОТА']);
    expect(slugs('сакуб')).toEqual(['ВАЛСАРТАН+САКУБИТРИЛ']);
  });

  it('puts the whole name first and the substance card before its combinations', () => {
    expect(slugs('ацетилсалициловая кислота')[0]).toBe('АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА');
    expect(slugs('кислота ацетилсалициловая')[0]).toBe('АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА');
    expect(slugs('эналаприл')[0]).toBe('ЭНАЛАПРИЛ');
  });

  it('reads an inflected typed word', () => {
    expect(slugs('валсартана')[0]).toBe('ВАЛСАРТАН');
  });

  it('finds the card of a trade name, whatever the registered mark and case', () => {
    expect(matchDrugNames(ENTRIES, 'аспирин')[0]).toMatchObject({
      name: 'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
      product: 'Аспирин',
    });
    expect(slugs('Амоксиклав')).toEqual(['АМОКСИЦИЛЛИН+КЛАВУЛАНОВАЯ КИСЛОТА']);
    expect(slugs('эналаприл-фпо')[0]).toBe('ЭНАЛАПРИЛ');
    expect(slugs('аспирин кардио')).toEqual(['АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА']);
  });

  it('finds nothing for text that begins no word of any name', () => {
    expect(slugs('сакубитрол')).toEqual([]);
    expect(slugs('бвап')).toEqual([]);
    expect(slugs('<script>alert(1)</script>')).toEqual([]);
    expect(slugs('')).toEqual([]);
    expect(slugs('ва')).toEqual([]);
  });

  it('needs every typed word', () => {
    expect(slugs('сакубитрил амлодипин')).toEqual([]);
  });
});
