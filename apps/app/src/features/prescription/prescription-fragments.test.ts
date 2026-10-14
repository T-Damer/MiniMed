import { describe, expect, it } from 'vitest';

import type { ResolvedRule } from './dose-document';
import { foldedFragments, fragmentCount, MAX_FRAGMENTS } from './prescription-fragments';
import type { ItemAnalysis, RuleOption } from './prescription-model';

function resolved(quote: string, sectionTitle: string): ResolvedRule {
  return {
    rule: { k: 0, s: 0, a: 0, b: 1 },
    computable: true,
    quote,
    context: null,
    sectionTitle,
    anchor: null,
  };
}

function option(key: string, quote: string, sectionTitle = 'Способ применения'): RuleOption {
  return {
    key,
    resolved: resolved(quote, sectionTitle),
    position: 0,
    match: { fit: 'yes', missing: [] } as unknown as RuleOption['match'],
    plan: {} as RuleOption['plan'],
    summary: quote,
  };
}

function analysis(patch: Partial<ItemAnalysis>): ItemAnalysis {
  return {
    options: [],
    pending: [],
    restricted: [],
    quoted: [],
    caps: [],
    chosen: null,
    ...patch,
  } as unknown as ItemAnalysis;
}

describe('the fold of dose sentences', () => {
  it('leaves the chosen sentence out and lists every other once, grouped by section', () => {
    const first = option('a', 'По 250 мг 3 раза в сутки.');
    const second = option('b', 'По 500 мг 2 раза в сутки.');
    const groups = foldedFragments(
      analysis({
        options: [first, second],
        chosen: first,
        quoted: [
          resolved('По 500 мг 2 раза в сутки.', 'Способ применения'),
          resolved('Таблица доз', 'Дозирование при почечной недостаточности'),
        ],
        restricted: [
          resolved(
            'При клиренсе менее 30 мл/мин – 250 мг.',
            'Дозирование при почечной недостаточности',
          ),
        ],
      }),
    );
    expect(groups.map((group) => group.title)).toEqual([
      'Способ применения',
      'Дозирование при почечной недостаточности',
    ]);
    expect(fragmentCount(groups)).toBe(3);
    expect(groups[0]?.fragments[0]?.option?.key).toBe('b');
    expect(groups[1]?.fragments.map((fragment) => fragment.kind)).toEqual(['quoted', 'restricted']);
  });

  it('keeps the first quoted sentence out of the fold when no rule can be computed', () => {
    const groups = foldedFragments(
      analysis({
        quoted: [
          resolved('Первое предложение.', 'Раздел'),
          resolved('Второе предложение.', 'Раздел'),
        ],
      }),
    );
    expect(fragmentCount(groups)).toBe(1);
    expect(groups[0]?.fragments[0]?.resolved.quote).toBe('Второе предложение.');
  });

  it('says what a waiting rule needs and caps the list', () => {
    const waiting = {
      ...option('w', 'По 5 мг/кг.'),
      match: { fit: 'yes', missing: ['weight'] } as unknown as RuleOption['match'],
    };
    const many = Array.from({ length: MAX_FRAGMENTS + 10 }, (_, at) =>
      resolved(`Фрагмент ${at}.`, 'Раздел'),
    );
    const groups = foldedFragments(analysis({ pending: [waiting], quoted: many }));
    expect(groups[0]?.fragments[0]?.note).toBe('нужен вес');
    expect(fragmentCount(groups)).toBe(MAX_FRAGMENTS);
  });
});
