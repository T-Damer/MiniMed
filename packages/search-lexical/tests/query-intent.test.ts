import { describe, expect, it } from 'vitest';

import { analyzeClinicalQuery, classifyMedicalQueryIntent } from '../src/index';

const cases = [
  ['Мальчик 5 лет, 3 дня назад появилась сыпь', 'diagnosis'],
  ['Лечение бронхиальной астмы', 'treatment'],
  ['Лечение бронхиальной астмы первой степени при потере контоля девочке 3 лет', 'treatment'],
  ['Мазь при укусе комара', 'treatment'],
  ['Помощь при ссаденой ране', 'treatment'],
  ['Мазь при ожоге у ребенка 1 месяца', 'treatment'],
  ['Препарат для снижения давления', 'medication'],
  ['Препараты при мигрени', 'medication'],
  ['Вскармливание ребенка в 4 месяца', 'care-guidance'],
  ['Прикорм ребенка в 4 месяца', 'care-guidance'],
  ['Прибавка в весе ребенка в 4 месяца', 'care-guidance'],
  ['Какой прикорм разрешен в 4 месяца', 'care-guidance'],
  ['Группа здоровья при язвенной болезни, болеет ей 2 месяца', 'administrative-reference'],
] as const;

describe('medical search intent', () => {
  it.each(cases)('classifies %s as %s', (query, expected) => {
    expect(classifyMedicalQueryIntent(query).primary).toBe(expected);
  });

  it('keeps every product query from the discovery catalog executable', () => {
    for (const [query] of cases) {
      const plan = analyzeClinicalQuery(query, []);
      expect(plan.analysis.intent?.primary).not.toBe('unknown');
      expect(plan.branches.length).toBeGreaterThan(0);
      expect(plan.ftsQuery).not.toBe('');
    }
  });

  it('asks for asthma control when a broad treatment query omits it', () => {
    const plan = analyzeClinicalQuery('Лечение бронхиальной астмы', []);
    expect(plan.analysis.suggestions.map((item) => item.field)).toContain('control');
    expect(plan.analysis.suggestions.map((item) => item.field)).toContain('severity');
  });

  it('does not ask for control when the dirty query already mentions loss of control', () => {
    const plan = analyzeClinicalQuery(
      'Лечение бронхиальной астмы первой степени при потере контоля девочке 3 лет',
      [],
    );
    expect(plan.analysis.suggestions.map((item) => item.field)).not.toContain('control');
    expect(plan.analysis.facts.some((fact) => fact.kind === 'age')).toBe(true);
  });

  it('marks a generic antihypertensive request for clarification', () => {
    const intent = classifyMedicalQueryIntent('Препарат для снижения давления');
    const plan = analyzeClinicalQuery('Препарат для снижения давления', []);
    expect(intent.needsClarification).toBe(true);
    expect(plan.analysis.suggestions.map((item) => item.field)).toEqual(
      expect.arrayContaining(['age', 'severity', 'context', 'goal']),
    );
  });

  it('asks for severity when an administrative group cannot be derived safely', () => {
    const plan = analyzeClinicalQuery(
      'Группа здоровья при язвенной болезни, болеет ей 2 месяца',
      [],
    );
    expect(plan.analysis.suggestions.map((item) => item.field)).toContain('severity');
  });
});
