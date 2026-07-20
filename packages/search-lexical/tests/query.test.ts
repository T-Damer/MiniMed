import { describe, expect, it } from 'vitest';

import {
  analyzeClinicalQuery,
  buildLexicalQueryPlan,
  lightStemRussian,
  normalizeForIndex,
} from '../src/index';

const aliases = [
  {
    id: 'alias.tachypnea',
    canonicalTerm: 'тахипноэ',
    alias: 'часто дышит',
    category: 'symptom',
    weight: 1,
  },
  {
    id: 'alias.augmentin',
    canonicalTerm: 'амоксициллин клавулановая кислота',
    alias: 'аугментин',
    category: 'medication',
    weight: 1,
  },
  {
    id: 'alias.dysuria',
    canonicalTerm: 'болезненное мочеиспускание',
    alias: 'дизурия',
    category: 'symptom',
    weight: 1,
  },
];

describe('lexical query planning', () => {
  it('normalizes Russian morphology in the same way as the corpus builder', () => {
    expect(lightStemRussian('пневмонией')).toBe('пневмони');
    expect(normalizeForIndex('Ребёнок с пневмонией')).toContain('ребенок');
  });

  it('adds canonical terms from a colloquial alias', () => {
    const plan = buildLexicalQueryPlan('Ребёнок часто дышит второй день', aliases);
    expect(plan.terms).toContain('тахипноэ');
    expect(plan.aliasMatches).toContain('часто дышит → тахипноэ');
    expect(plan.ftsQuery).toContain('"тахипноэ"*');
  });

  it('offers non-blocking missing-field suggestions', () => {
    const plan = buildLexicalQueryPlan('кашель и слабость', aliases);
    expect(plan.suggestions.map((suggestion) => suggestion.id)).toContain('age');
    expect(plan.suggestions.map((suggestion) => suggestion.id)).toContain('duration');
  });

  it('extracts deterministic facts from a long clinical description', () => {
    const plan = analyzeClinicalQuery(
      'Мальчик 5 лет. Лихорадка до 39,2 второй день, часто дышит. Кашля нет. Сатурация 94%. Принимает аугментин.',
      aliases,
    );
    const kinds = plan.analysis.facts.map((fact) => fact.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'sex',
        'age',
        'temperature',
        'duration',
        'symptom',
        'negative-finding',
        'measurement',
        'medication',
      ]),
    );
    expect(plan.analysis.suggestions.map((item) => item.id)).not.toContain('age');
    expect(plan.analysis.suggestions.map((item) => item.id)).not.toContain('temperature');
  });

  it('does not promote a negated symptom into the main clinical branch', () => {
    const plan = analyzeClinicalQuery(
      'Девочка 8 лет, температура 39 второй день, часто дышит. Кашля нет.',
      aliases,
    );
    const clinical = plan.branches.find((branch) => branch.id === 'clinical');
    expect(clinical?.terms).toContain('тахипноэ');
    expect(clinical?.terms).not.toContain('кашля');
    expect(clinical?.terms).not.toContain('кашл');
  });

  it('does not let a terse negation swallow the next known positive concept', () => {
    const plan = analyzeClinicalQuery('Лихорадка без очага дизурия', aliases);
    const negative = plan.analysis.facts.find((fact) => fact.kind === 'negative-finding');
    const clinical = plan.branches.find((branch) => branch.kind === 'clinical');
    expect(negative?.normalizedValue).toBe('очага');
    expect(clinical?.terms).toContain('мочеиспускание');
  });

  it('keeps diagnosis context searchable after a negated treatment-response phrase', () => {
    const plan = analyzeClinicalQuery(
      'Нет ответа на стартовый антибиотик через 72 часа при пневмонии',
      aliases,
    );
    const negative = plan.analysis.facts.find((fact) => fact.kind === 'negative-finding');
    const clinical = plan.branches.find((branch) => branch.kind === 'clinical');
    expect(negative?.normalizedValue).toBe('ответа на стартовый антибиотик');
    expect(clinical?.terms.some((term) => term.startsWith('пневмони'))).toBe(true);
  });

  it('extracts age before sex and recognizes an inflected cough verb', () => {
    const plan = analyzeClinicalQuery('5 лет, мальчик, кашляет', aliases);
    expect(plan.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'age', normalizedValue: '5 лет' }),
        expect.objectContaining({ kind: 'sex', normalizedValue: 'мужской' }),
        expect.objectContaining({ kind: 'symptom', normalizedValue: 'кашель' }),
      ]),
    );
    expect(plan.branches[0]?.terms.some((term) => term.startsWith('кашл'))).toBe(true);
  });

  it('does not turn a negated cough into a positive symptom fact', () => {
    const plan = analyzeClinicalQuery('Мальчик 5 лет, кашля нет', aliases);
    expect(
      plan.analysis.facts.some(
        (fact) => fact.kind === 'symptom' && fact.normalizedValue === 'кашель',
      ),
    ).toBe(false);
    expect(plan.analysis.facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'negative-finding' })]),
    );
  });

  it('does not confuse illness duration before sex with patient age', () => {
    const plan = analyzeClinicalQuery('5 дней, мальчик, кашляет', aliases);
    const duration = plan.analysis.facts.find((fact) => fact.kind === 'duration');
    expect(plan.analysis.facts.some((fact) => fact.kind === 'age')).toBe(false);
    expect(duration?.unit).toBe('дней');
    expect(plan.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'duration' }),
        expect.objectContaining({ kind: 'sex', normalizedValue: 'мужской' }),
        expect.objectContaining({ kind: 'symptom', normalizedValue: 'кашель' }),
      ]),
    );
  });

  it('splits long descriptions into observable search branches', () => {
    const plan = analyzeClinicalQuery(
      'Мальчик 7 лет. Боль справа внизу живота появилась вчера. Однократная рвота. Общий анализ мочи без изменений.',
      aliases,
    );
    expect(plan.branches.some((branch) => branch.kind === 'clause')).toBe(true);
    expect(plan.branches.some((branch) => branch.kind === 'investigation')).toBe(true);
    expect(plan.analysis.branches.map((branch) => branch.label)).toContain('Клинические признаки');
  });
});
