import { describe, expect, it } from 'vitest';

import {
  type ColumnUnits,
  clusterKind,
  clusterUnits,
  diffSegments,
  jaccard,
  type MatchUnit,
  ownNameStems,
  SIMILAR_THRESHOLD,
  unitTokens,
} from './comparison-match';

const unit = (text: string): MatchUnit => ({ text, tokens: unitTokens(text) });
const column = (
  drug: number,
  texts: readonly string[],
  own: readonly string[] = [],
): ColumnUnits => ({
  drug,
  units: texts.map(unit),
  ownStems: ownNameStems(own),
});

describe('unitTokens', () => {
  it('stems words the same way for every case of a word and keeps numbers and numerals', () => {
    const stems = (text: string): readonly string[] => unitTokens(text).map((token) => token.stem);
    expect(stems('ибупрофена')).toEqual(stems('ибупрофеном'));
    expect(stems('детям до 12 лет')).toContain('#12');
    expect(stems('1,5 г')).toContain('#1.5');
    expect(stems('II триместр')).toContain('r:ii');
    expect(stems('II триместр')).not.toEqual(stems('III триместр'));
  });

  it('gives offsets into the text', () => {
    const text = 'Дозу 12 мг';
    for (const token of unitTokens(text)) {
      expect(text.slice(token.start, token.end).length).toBeGreaterThan(0);
    }
  });
});

describe('jaccard', () => {
  it('is 1 for equal sets, 0 for disjoint or empty ones', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard([], ['a'])).toBe(0);
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(0.5);
  });
});

describe('clusterUnits', () => {
  it('matches a statement that differs only by the drug name, case and word endings', () => {
    const clusters = clusterUnits([
      column(0, ['Гиперчувствительность к ибупрофену или другим НПВП.'], ['Ибупрофен', 'Нурофен']),
      column(1, ['Гиперчувствительность к парацетамолу или другим НПВП'], ['Парацетамол']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toEqual([
      { drug: 0, unit: 0 },
      { drug: 1, unit: 0 },
    ]);
    expect(clusters[0]?.identical).toBe(true);
    expect(clusterKind(clusters[0] as never, 2)).toBe('shared');
  });

  it('pairs units that differ by a number as similar, not identical', () => {
    const clusters = clusterUnits([
      column(0, ['Детям до 12 лет препарат не назначают.']),
      column(1, ['Детям до 6 лет препарат не назначают.']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.identical).toBe(false);
    const [first, second] = [
      unit('Детям до 12 лет препарат не назначают.'),
      unit('Детям до 6 лет препарат не назначают.'),
    ];
    const marked = diffSegments(first, [second], new Set(), [new Set()]);
    expect(marked.filter((segment) => segment.differs).map((segment) => segment.text)).toEqual([
      '12',
    ]);
  });

  it('keeps statements that name different things apart', () => {
    const clusters = clusterUnits([
      column(0, ['Язвенная болезнь желудка в стадии обострения.', 'Тошнота.']),
      column(1, ['Тяжелая печеночная недостаточность.', 'Тошнота.']),
    ]);
    const kinds = clusters.map((cluster) => clusterKind(cluster, 2));
    expect(kinds.filter((kind) => kind === 'shared')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'only')).toHaveLength(2);
  });

  it('uses each unit once and never joins two units of one drug', () => {
    const clusters = clusterUnits([
      column(0, ['Тошнота и рвота.', 'Тошнота и рвота!']),
      column(1, ['Тошнота и рвота.']),
    ]);
    for (const cluster of clusters) {
      expect(new Set(cluster.members.map((member) => member.drug)).size).toBe(
        cluster.members.length,
      );
    }
    expect(clusters.filter((cluster) => cluster.members.length === 2)).toHaveLength(1);
  });

  it('requires every pair of a three-drug group to be similar', () => {
    const clusters = clusterUnits([
      column(0, ['Головная боль, головокружение, слабость, сонливость, тремор.']),
      column(1, ['Головная боль, головокружение, слабость, сонливость, потливость.']),
      column(2, ['Головокружение, слабость, сонливость, потливость, одышка.']),
    ]);
    // 0~1 (4/6) and 1~2 (4/6) are similar, 0~2 (3/7) is not: no group of all three.
    expect(clusters.some((cluster) => cluster.members.length === 3)).toBe(false);
  });

  it('orders the groups by the first drug, then by the next drug that has them alone', () => {
    const clusters = clusterUnits([
      column(0, ['Первое только у первого.', 'Второе общее для двух препаратов лекарственных.']),
      column(1, ['Третье только у второго.', 'Второе общее для двух препаратов лекарственных.']),
    ]);
    expect(clusters.map((cluster) => cluster.members.map((member) => member.drug))).toEqual([
      [0],
      [0, 1],
      [1],
    ]);
  });

  it('documents the threshold it uses', () => {
    expect(SIMILAR_THRESHOLD).toBeGreaterThan(0.5);
    expect(SIMILAR_THRESHOLD).toBeLessThan(0.9);
  });
});

describe('a statement inside a longer list', () => {
  it('is matched with the unit that holds it and marked as similar, not as «only»', () => {
    const clusters = clusterUnits([
      column(0, ['Возраст до 18 лет (эффективность и безопасность не установлены).']),
      column(1, [
        'Повышенная чувствительность к компоненту, беременность, период грудного вскармливания, возраст до 18 лет (безопасность и эффективность применения не установлены).',
      ]),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.identical).toBe(false);
    expect(clusterKind(clusters[0] as never, 2)).toBe('shared');
  });

  it('needs at least four words, so a one-word item never matches a long unit', () => {
    const clusters = clusterUnits([
      column(0, ['Тошнота.']),
      column(1, ['Тошнота, рвота, диарея, боль в животе, головная боль, слабость.']),
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('diffSegments', () => {
  it('marks nothing in a unit that is alone', () => {
    expect(diffSegments(unit('Тошнота.'), [], new Set(), [])).toEqual([
      { text: 'Тошнота.', differs: false },
    ]);
  });
});
