import type { AliasRecord } from '@localmed/domain';
import { describe, expect, it } from 'vitest';
import { buildLookupQueryPlan as baselineLookup } from './analysis';
import { buildLookupQueryPlan } from './medication-lookup';
import {
  createMedicationSpellingMatcher,
  MAX_MEDICATION_SPELLING_MATCHES,
} from './medication-spelling';

const names = [
  'Парацетамол',
  'Цефтриаксон',
  'Диклофенак',
  'Амоксициллин',
  'Азитромицин',
  'Омепразол',
  'Ацикловир',
  'Рисперидон',
  'Левофлоксацин',
  'Клозапин',
  'Клоназепам',
  'Цетрин',
  'Кеторол',
  'Кетонал',
  'Ацетилсалициловая кислота',
  'Цефазолин',
  'Эналаприл',
];
function vocabulary(labels: readonly string[]): AliasRecord[] {
  return labels.map((name, i) => ({
    id: `medicine.${i}`,
    alias: name,
    canonicalTerm: name,
    category: 'medication',
    weight: 1,
  }));
}
const aliases = vocabulary(names);
const match = createMedicationSpellingMatcher(aliases);

describe('source-vocabulary medication spelling', () => {
  it.each([
    ['парацетомол', 'Парацетамол'],
    ['парацитамол', 'Парацетамол'],
    ['парацитамолл', 'Парацетамол'],
    ['парацетмаол', 'Парацетамол'],
    ['парацтамол', 'Парацетамол'],
    ['паарацетамол', 'Парацетамол'],
    ['парацктамол', 'Парацетамол'],
    ['пароцитамол', 'Парацетамол'],
    ['цефтреаксон', 'Цефтриаксон'],
    ['цефтриакзон', 'Цефтриаксон'],
    ['цефазалин', 'Цефазолин'],
    ['амоксицилин', 'Амоксициллин'],
    ['омепрозол', 'Омепразол'],
    ['азетромецин', 'Азитромицин'],
    ['ациклавир', 'Ацикловир'],
    ['резперидон', 'Рисперидон'],
    ['энолоприл', 'Эналаприл'],
    ['тиклофенак', 'Диклофенак'],
    ['ацетилсалициловая кислата', 'Ацетилсалициловая кислота'],
  ])('retrieves %s as a candidate for %s', (query, expected) => {
    expect(match(query).map((item) => item.name)).toContain(expected);
  });
  it.each(['ие', 'дт', 'ео', 'зс', 'жш', 'бп', 'вф', 'гк', 'шщ', 'ий', 'еэ'])(
    'supports both directions of pair %s without a drug-specific alias',
    (pair) => {
      const first = `абра${pair[0]}кадабра`;
      const second = `абра${pair[1]}кадабра`;
      expect(createMedicationSpellingMatcher(vocabulary([first]))(second)[0]?.cost).toBe(1);
      expect(createMedicationSpellingMatcher(vocabulary([second]))(first)[0]?.cost).toBe(1);
    },
  );
  it('does not make unrelated vowels equal by transitive phonetic folding', () => {
    expect(
      createMedicationSpellingMatcher(vocabulary(['аброакадабра']))('абриакадабра')[0]?.cost,
    ).toBe(3);
  });
  it('keeps е/ё as existing orthographic normalization, not a second medicine', () => {
    expect(createMedicationSpellingMatcher(vocabulary(['Тестофен']))('тёстофен')).toEqual([]);
  });
  it.each(names)('never changes an existing name %s into its neighbour', (name) => {
    expect(match(name)).toEqual([]);
  });
  it('does not repair an exact non-medication alias', () => {
    const other = {
      id: 'finding',
      alias: 'Парацетомол',
      canonicalTerm: 'Тестовый симптом',
      category: 'symptom',
      weight: 1,
    };
    expect(createMedicationSpellingMatcher([...aliases, other])('парацетомол')).toEqual([]);
  });
  it('preserves the rest of the query, including strength, units and formulation', () => {
    const result = match('Инструкция к парацитамол 500 мг таблетки');
    expect(result.find((item) => item.name === 'Парацетамол')?.replacementQuery).toBe(
      'инструкция к парацетамол 500 мг таблетки',
    );
  });
  it.each([
    'АД',
    'мг',
    'F20',
    '123456',
    'не парацитомол',
    'без парацитомола',
    'аллергия на парацитомол',
    'космический мармелад',
    'тест\0препарат',
    'а'.repeat(161),
    'аmоксициллин',
  ])('abstains on %s', (query) => {
    expect(match(query)).toEqual([]);
  });
  it('does not repair numbers or short named components inside a combination', () => {
    const matcher = createMedicationSpellingMatcher(vocabulary(['Тест 500', 'Альфа АБ']));
    expect(matcher('тест 600')).toEqual([]);
    expect(matcher('альфа АВ')).toEqual([]);
  });
  it('returns separate alternatives for ambiguous names, never one merged medicine', () => {
    const matcher = createMedicationSpellingMatcher(vocabulary(['Тестопрал', 'Тестоприл']));
    expect(new Set(matcher('тестопрол').map((item) => item.name))).toEqual(
      new Set(['Тестопрал', 'Тестоприл']),
    );
  });
  it('does not use non-medication terms to expand a medicine query', () => {
    const matcher = createMedicationSpellingMatcher([
      {
        id: 'symptom',
        alias: 'Парацетамол',
        canonicalTerm: 'Чужой симптом',
        category: 'symptom',
        weight: 1,
      },
    ]);
    expect(matcher('парацетомол')).toEqual([]);
  });
  it('bounds output and is deterministic under vocabulary order', () => {
    expect(match('парацитомол').length).toBeLessThanOrEqual(MAX_MEDICATION_SPELLING_MATCHES);
    expect(createMedicationSpellingMatcher([...aliases].reverse())('пароцитамол')).toEqual(
      match('пароцитамол'),
    );
  });
});

describe('ordinary lookup integration, not clinical inference', () => {
  it('adds explicit alternative branches without changing original query, facts or calculations', () => {
    const query = 'парацитомол 500 мг';
    const plan = buildLookupQueryPlan(query, aliases);
    expect(plan.branches.some((branch) => branch.id.startsWith('medication-spelling-'))).toBe(true);
    expect(plan.analysis.originalQuery).toBe(query);
    expect(plan.analysis.facts).toEqual([]);
    expect(plan.analysis.calculation).toBeUndefined();
    expect(plan.analysis.warnings.join(' ')).toContain('не рекомендация заменить');
    expect(plan.analysis.suggestions).toEqual([]);
  });
  it('leaves exact-name lookup unchanged', () => {
    expect(buildLookupQueryPlan('Парацетамол', aliases)).toEqual(
      baselineLookup('Парацетамол', aliases),
    );
  });
  it('never shares candidates across different installed vocabularies', () => {
    expect(
      buildLookupQueryPlan('парацитомол', vocabulary(['Омепразол'])).analysis.warnings,
    ).toEqual([]);
    expect(buildLookupQueryPlan('парацитомол', aliases).analysis.warnings).not.toEqual([]);
  });
});
