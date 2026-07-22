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
  it('keeps current therapy as a fact but removes it from diagnosis retrieval', () => {
    const plan = analyzeClinicalQuery(
      'Мальчик 5 лет, температура 39,2, часто дышит, кашля нет, принимает аугментин',
      aliases,
    );

    expect(plan.analysis.intent.primary).toBe('diagnosis');
    expect(plan.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'medication',
          normalizedValue: 'амоксициллин клавулановая кислота',
        }),
      ]),
    );
    expect(plan.branches.some((branch) => branch.kind === 'medication')).toBe(false);
    expect(plan.terms).not.toContain('аугментин');
    expect(plan.terms).not.toContain('амоксициллин');
    expect(plan.terms).toContain('тахипноэ');
  });

  it('retains medication retrieval for an explicit treatment question', () => {
    const plan = analyzeClinicalQuery(
      'Как лечить пневмонию, если ребёнок принимает аугментин?',
      aliases,
    );

    expect(plan.analysis.intent.primary).toBe('treatment');
    expect(plan.branches.some((branch) => branch.kind === 'medication')).toBe(true);
    expect(plan.terms).toEqual(expect.arrayContaining(['аугментин', 'амоксициллин']));
  });
});
