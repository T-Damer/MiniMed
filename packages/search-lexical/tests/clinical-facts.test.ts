import { describe, expect, it } from 'vitest';

import { analyzeClinicalQuery } from '../src/index';

const aliases = [
  {
    id: 'alias.tachypnea',
    canonicalTerm: 'тахипноэ',
    alias: 'часто дышит',
    category: 'symptom',
    weight: 1,
  },
];

describe('supplemental Russian clinical facts', () => {
  it('extracts age when age precedes sex', () => {
    const plan = analyzeClinicalQuery('5 лет, мальчик', aliases);
    const age = plan.analysis.facts.find((fact) => fact.kind === 'age');
    const sex = plan.analysis.facts.find((fact) => fact.kind === 'sex');

    expect(age?.normalizedValue).toBe('5 лет');
    expect(sex?.normalizedValue).toBe('мужской');
    expect(plan.analysis.suggestions.map((item) => item.id)).not.toContain('age');
  });

  it('normalizes an inflected cough verb into a symptom and search term', () => {
    const plan = analyzeClinicalQuery('Мальчик 5 лет, кашляет', aliases);
    const cough = plan.analysis.facts.find(
      (fact) => fact.kind === 'symptom' && fact.normalizedValue === 'кашель',
    );
    const clinical = plan.branches.find((branch) => branch.kind === 'clinical');

    expect(cough?.value.toLowerCase()).toBe('кашляет');
    expect(clinical?.terms.some((term) => term.startsWith('кашел'))).toBe(true);
  });

  it('does not convert a negated cough into a positive symptom fact', () => {
    const plan = analyzeClinicalQuery('Мальчик 5 лет. Кашля нет.', aliases);
    const positiveCough = plan.analysis.facts.find(
      (fact) => fact.kind === 'symptom' && fact.normalizedValue === 'кашель',
    );

    expect(positiveCough).toBeUndefined();
    expect(plan.analysis.facts.some((fact) => fact.kind === 'negative-finding')).toBe(true);
  });

  it('recognizes common colloquial symptom verbs', () => {
    const plan = analyzeClinicalQuery('Температурит, рвало, появилась сыпь и тяжело дышит', aliases);
    const symptoms = plan.analysis.facts
      .filter((fact) => fact.kind === 'symptom')
      .map((fact) => fact.normalizedValue);

    expect(symptoms).toEqual(
      expect.arrayContaining([
        'лихорадка',
        'рвота тошнота',
        'сыпь экзантема',
        'одышка тахипноэ дыхательная недостаточность',
      ]),
    );
  });
});
