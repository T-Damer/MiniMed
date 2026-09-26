import type { AliasRecord } from '@localmed/domain';
import { describe, expect, it } from 'vitest';
import { buildLookupQueryPlan } from './medication-lookup';
import { createMedicationSpellingMatcher } from './medication-spelling';

function vocab(names: readonly string[]): AliasRecord[] {
  return names.map((alias, i) => ({
    id: `test.${i}`,
    alias,
    canonicalTerm: `Состав ${i}`,
    category: 'medication',
    weight: 1,
  }));
}
const labels = ['Канефрон Н', 'Цитрамон П', 'Нурофен', 'Амоксиклав'];
const match = createMedicationSpellingMatcher(vocab(labels));

describe('incomplete source names with a one-letter marker', () => {
  it.each([
    'канефрно',
    'канифрон',
    'конифрон',
    'конефрно',
    'канефрон',
    'канефронн',
    'канефро',
    'канефром',
    'канефрн',
    'канифрно',
    'канефрон нн',
  ])('handles %s or explicitly refuses an edited marker', (query) => {
    if (query === 'канефрон нн') expect(match(query)).toEqual([]);
    else expect(match(query).map((row) => row.name)).toContain('Канефрон Н');
  });
  it('returns full source spelling and marks the omitted suffix, without altering the source alias', () => {
    const aliases = vocab(['Канефрон Н']);
    const before = JSON.stringify(aliases);
    const result = createMedicationSpellingMatcher(aliases)('канифрон')[0];
    expect(result?.replacementQuery).toBe('канефрон н');
    expect(result?.omittedSuffix).toBe('н');
    expect(result?.canonicalTerms).toEqual(['Состав 0']);
    expect(JSON.stringify(aliases)).toBe(before);
  });
  it.each(['канефрон н', 'канефрон п', 'канефрно п', 'канефрон н 50 мг'])(
    'does not rewrite an explicit marker in %s',
    (query) => {
      expect(match(query)).toEqual([]);
    },
  );
  it('can correct the name while keeping a correctly entered marker', () => {
    expect(match('канифрон н')[0]?.replacementQuery).toBe('канефрон н');
  });
  it('retains multiple source variants as alternatives instead of merging ingredients', () => {
    const variants = createMedicationSpellingMatcher(vocab(['Тестоприл Н', 'Тестоприл П']));
    expect(variants('тестопирл').map((row) => row.name)).toEqual(['Тестоприл Н', 'Тестоприл П']);
  });
  it('does not strip long qualifiers, strengths or manufacturer labels', () => {
    const matcher = createMedicationSpellingMatcher(
      vocab(['Тестоприл Форте', 'Тестоприл 10', 'Тестоприл Ретард', 'Тестоприл Акрихин']),
    );
    expect(matcher('тестопирл')).toEqual([]);
  });
  it('protects an existing unqualified name and an existing non-medication name', () => {
    expect(createMedicationSpellingMatcher(vocab(['Канефрон', 'Канефрон Н']))('канефрон')).toEqual(
      [],
    );
    const other = {
      id: 'other',
      alias: 'Канифрон',
      canonicalTerm: 'Другой термин',
      category: 'finding',
      weight: 1,
    };
    expect(createMedicationSpellingMatcher([...vocab(labels), other])('канифрон')).toEqual([]);
  });
  it('does not invent a letter marker absent from source names', () => {
    const result = createMedicationSpellingMatcher(vocab(['Канефрон']))('канифрон');
    expect(result[0]?.name).toBe('Канефрон');
    expect(result[0]?.omittedSuffix).toBeNull();
  });
  it('preserves suffix, strength and form as search text, not clinical facts', () => {
    const plan = buildLookupQueryPlan('инструкция к конифрон 50 мг таблетки', vocab(labels));
    expect(
      plan.branches.some((row) => row.query === 'инструкция к канефрон н 50 мг таблетки'),
    ).toBe(true);
    expect(plan.analysis.originalQuery).toBe('инструкция к конифрон 50 мг таблетки');
    expect(plan.analysis.facts).toEqual([]);
    expect(plan.analysis.calculation).toBeUndefined();
    expect(plan.analysis.warnings.join(' ')).toContain('Канефрон Н');
  });
});

describe('word boundaries are part of spelling coverage', () => {
  for (const full of labels) {
    const stem = full.split(' ')[0] ?? '';
    const lower = stem.toLowerCase();
    const cases: string[] = [];
    for (let i = 0; i < lower.length - 1; i += 1) {
      if (lower[i] !== lower[i + 1])
        cases.push(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2));
    }
    cases.push(lower.slice(0, -1), `${lower}${lower.at(-1)}`, `${lower.slice(0, -1)}ж`);
    it.each(cases)(`recovers ${full} including the first/last edit: %s`, (query) => {
      expect(match(query).map((row) => row.name)).toContain(full);
    });
  }
});
