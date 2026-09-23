import { describe, expect, it } from 'vitest';
import { planDefinitionDescription, rankDefinitionDescriptions } from './definition-description';

function plan(query: string) {
  const value = planDefinitionDescription(query);
  if (!value) throw new Error('Expected a bounded description plan');
  return value;
}
function rank(query: string, texts: readonly string[]) {
  return rankDefinitionDescriptions(plan(query), texts.map((text, index) => ({
    id: `fixture.${index}`, text, retrievalRank: index,
  })));
}

describe('description-to-definition query handler', () => {
  it.each(['как это называется', 'что за термин', 'не знаю название', '', '   '])(
    'does not manufacture a query from navigation-only input %s', (query) => {
      expect(planDefinitionDescription(query)).toBeNull();
    },
  );
  it('removes only anchored framing and preserves meaningful absence', () => {
    const value = plan('Как называется, когда запахи не ощущаются?');
    expect(value.descriptive).toBe(true);
    expect(value.terms.map((term) => term.stem)).toEqual(['запах', 'ощущаются']);
    expect(value.terms.every((term) => term.absent)).toBe(true);
    expect(value.disjunction).not.toContain('называется');
    expect(plan('термин нарушает восприятие').terms.some((term) => term.surface === 'термин')).toBe(true);
  });
  it('produces quoted token expressions, not caller-supplied FTS operators', () => {
    const value = plan('эритроциты неравных размеров " OR *');
    expect(value.disjunction).toContain('"эритроцит"*');
    expect(value.disjunction).toContain('"неравн"*');
    expect(value.conjunction).not.toContain('" OR *');
  });
  it('does not treat the lexical prefix не as a negation', () => {
    expect(plan('эритроциты неравных размеров').terms.every((term) => !term.absent)).toBe(true);
  });
  it.each(['тест\0текст', 'а'.repeat(2049)])('rejects malformed query %s', (query) => {
    expect(planDefinitionDescription(query)).toBeNull();
  });
  it('does not silently truncate overlong feature sets', () => {
    expect(planDefinitionDescription(Array.from({ length: 20 }, (_, i) => `word${i}`).join(' '))).toBeNull();
  });
  it('repairs noun and adjective inflections without term-specific aliases', () => {
    const results = rank('объекты неравных размеров', [
      'Измерение размеров — действие с измерительным прибором.',
      'Это объекты неравного размера.',
      'Размеры — информация о величине.',
    ]);
    expect(results[0]?.id).toBe('fixture.1');
    expect(results.map((row) => row.id)).not.toContain('fixture.2');
  });
  it('requires several defining features rather than a single common word', () => {
    expect(rank('движение длинного красного объекта', ['Объекты встречаются в пространстве.'])).toEqual([]);
  });
  it('retains explicit absence instead of preferring its positive counterpart', () => {
    expect(rank('запахи не ощущаются', [
      'Запахи ощущаются слабее.',
      'Запахи не ощущаются.',
    ]).map((row) => row.id)).toEqual(['fixture.1']);
  });
  it('keeps clause-local absence from leaking across punctuation', () => {
    const value = plan('боль есть; температура отсутствует');
    expect(value.terms.find((term) => term.stem === 'бол')?.absent).toBe(false);
    expect(value.terms.find((term) => term.stem === 'температур')?.absent).toBe(true);
  });
  it('never returns an identity that was not an actual candidate', () => {
    const result = rank('короткое движение мышцы', ['Короткие движения мышц.']);
    expect(result.map((row) => row.id)).toEqual(['fixture.0']);
  });
  it('deduplicates repeated evidence for the same record, not distinct source identities', () => {
    const value = plan('короткое движение мышцы');
    const result = rankDefinitionDescriptions(value, [
      { id: 'a', text: 'Короткие движения мышц.', retrievalRank: 0 },
      { id: 'a', text: 'Короткое движение мышцы.', retrievalRank: 1 },
      { id: 'b', text: 'Короткое движение мышцы.', retrievalRank: 2 },
    ]);
    expect(new Set(result.map((row) => row.id))).toEqual(new Set(['a', 'b']));
    expect(result).toHaveLength(2);
  });
  it('is stable under candidate reordering', () => {
    const value = plan('короткое движение мышцы');
    const candidates = [
      { id: 'a', text: 'Короткие движения мышц.', retrievalRank: 0 },
      { id: 'b', text: 'Короткие движения.', retrievalRank: 1 },
    ];
    expect(rankDefinitionDescriptions(value, candidates)).toEqual(rankDefinitionDescriptions(value, [...candidates].reverse()));
  });
  it('bounds candidate count and text, including supplementary Unicode', () => {
    const value = plan('короткое движение мышцы');
    const candidate = { id: 'a', text: 'мышца', retrievalRank: 0 };
    expect(() => rankDefinitionDescriptions(value, Array(193).fill(candidate))).toThrow('budget');
    expect(() => rankDefinitionDescriptions(value, [{ ...candidate, text: '🔬'.repeat(4097) }])).toThrow('bounded');
    expect(rankDefinitionDescriptions(value, [])).toEqual([]);
  });
  it('does not add a symptom interpretation for conflicting mentions', () => {
    expect(planDefinitionDescription('запахи не ощущаются, запахи ощущаются')).toBeNull();
  });
});
