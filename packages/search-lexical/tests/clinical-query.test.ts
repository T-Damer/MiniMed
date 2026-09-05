import { describe, expect, it } from 'vitest';

import { analyzeClinicalQuery } from '../src/index';

const aliases = [
  {
    id: 'alias.augmentin',
    canonicalTerm: 'амоксициллин клавулановая кислота',
    alias: 'аугментин',
    category: 'medication',
    weight: 1,
  },
  {
    id: 'alias.tachypnea',
    canonicalTerm: 'тахипноэ',
    alias: 'часто дышит',
    category: 'symptom',
    weight: 1,
  },
];

describe('clinical query retrieval sanitation', () => {
  it('searches positive symptoms in a plain description without requiring a diagnostic question', () => {
    const query = 'апноэ на фоне вирусной инфекции, без хрипов';
    for (const text of [query, `найти документы: ${query}`]) {
      const plan = analyzeClinicalQuery(text, []);
      expect(plan.analysis.intent?.primary).toBe('unknown');
      expect(plan.branches[0]).toMatchObject({
        id: 'canonical-symptoms',
        terms: ['апноэ'],
        ftsQuery: '"апноэ"*',
      });
    }
  });

  it('recognizes literal respiratory findings and keeps negated findings out of positive facts', () => {
    const query = 'Апноэ и раздувание крыльев носа, без хрипов';
    const { analysis } = analyzeClinicalQuery(query, []);
    const positive = analysis.facts.filter(
      (fact) => fact.kind === 'symptom' && fact.polarity === 'positive',
    );
    expect(positive.map((fact) => fact.normalizedValue)).toEqual(
      expect.arrayContaining(['апноэ', 'раздувание крыльев носа']),
    );
    expect(positive.some((fact) => fact.normalizedValue === 'хрипы')).toBe(false);
    for (const fact of positive)
      expect(query.slice(fact.range.start, fact.range.end)).toBe(fact.value);
  });
  it('keeps current therapy visible but removes it from diagnosis retrieval', () => {
    const plan = analyzeClinicalQuery(
      'Мальчик 5 лет, температура 39,2, часто дышит, кашля нет, принимает аугментин',
      aliases,
    );

    expect(plan.analysis.intent?.primary).toBe('diagnosis');
    expect(plan.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'medication',
          normalizedValue: 'амоксициллин клавулановая кислота',
        }),
      ]),
    );
    expect(plan.analysis.branches.some((branch) => branch.kind === 'medication')).toBe(true);
    expect(plan.branches.some((branch) => branch.kind === 'medication')).toBe(false);
    expect(plan.terms).not.toContain('аугментин');
    expect(plan.terms).not.toContain('амоксициллин');
    expect(plan.terms).toContain('тахипноэ');
    expect(plan.branches[0]).toEqual(
      expect.objectContaining({ id: 'canonical-symptoms', weight: 1.58 }),
    );
  });

  it('retains medication retrieval for an explicit treatment question', () => {
    const plan = analyzeClinicalQuery(
      'Как лечить пневмонию, если ребёнок принимает аугментин?',
      aliases,
    );

    expect(plan.analysis.intent?.primary).toBe('treatment');
    expect(plan.branches.some((branch) => branch.kind === 'medication')).toBe(true);
    expect(plan.terms).toEqual(expect.arrayContaining(['аугментин', 'амоксициллин']));
  });
});
