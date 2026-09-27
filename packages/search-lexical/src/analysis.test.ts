import type { AliasRecord } from '@localmed/domain';
import { describe, expect, it } from 'vitest';

import { buildLookupQueryPlan, DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID } from './analysis';

function alias(
  id: string,
  canonicalTerm: string,
  aliasText: string,
  category: string | null = 'diagnosis',
): AliasRecord {
  return { id, canonicalTerm, alias: aliasText, category, weight: 1 };
}

function branchTerms(plan: ReturnType<typeof buildLookupQueryPlan>, branchId: string) {
  return plan.branches.find((branch) => branch.id === branchId)?.terms;
}

describe('buildLookupQueryPlan diagnosis-alias dilution', () => {
  it('keeps a single-target diagnosis alias in the one primary branch', () => {
    const aliases = [alias('a.1', 'Ангина', 'Фарингит')];
    const plan = buildLookupQueryPlan('фарингит у ребенка', aliases);

    expect(plan.branches).toHaveLength(1);
    expect(plan.branches[0]?.id).toBe('lookup');
    expect(plan.terms).toEqual(expect.arrayContaining(['ангина', 'фарингит']));
  });

  it('tolerates the two-pack baseline duplicate (a krasotaimedicina name plus its own mkb code) without diluting it', () => {
    // The same real-world condition commonly has two representations (its own name-page and its
    // bare mkb.db code entry) even before any fan-out; this must not trigger dilution on its own.
    const aliases = [alias('a.1', 'Ангина', 'Фарингит'), alias('a.2', 'J02', 'Фарингит')];
    const plan = buildLookupQueryPlan('фарингит у ребенка', aliases);

    expect(plan.branches).toHaveLength(1);
    expect(plan.terms).toEqual(expect.arrayContaining(['ангина', 'j02']));
  });

  it('moves a genuinely fanned-out diagnosis alias (3+ unrelated targets) to a separate, lower-weight branch', () => {
    const aliases = [
      alias('a.1', 'Нейроинфекции', 'Менингит'),
      alias('a.2', 'Пахименингит', 'Менингит'),
      alias('a.3', 'Отогенные внутричерепные осложнения', 'Менингит'),
    ];
    const plan = buildLookupQueryPlan('менингит у ребенка', aliases);

    expect(plan.branches).toHaveLength(2);
    const [primary, diluted] = plan.branches;
    expect(primary?.id).toBe('lookup');
    expect(primary?.weight).toBe(1);
    expect(diluted?.id).toBe(DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID);
    expect(diluted?.weight).toBeLessThan(1);
    expect(diluted?.terms).toEqual(
      expect.arrayContaining(['нейроинфекции', 'пахименингит', 'отогенные', 'внутричерепные']),
    );
    expect(primary?.terms).not.toEqual(expect.arrayContaining(['пахименингит']));
  });

  it('never dilutes a clinical pointer’s own declared alias, even when it shares surface text with a fanned-out diagnosis alias', () => {
    const aliases = [
      alias('a.1', 'Клещевой вирусный энцефалит у детей', 'Энцефалит', 'clinical-recommendation'),
      alias('a.2', 'Нейроинфекции', 'Энцефалит'),
      alias('a.3', 'Анти-NMDA-рецепторный энцефалит', 'Энцефалит'),
      alias('a.4', 'Инфекционная миелопатия', 'Энцефалит'),
    ];
    const plan = buildLookupQueryPlan('энцефалит у ребенка', aliases);

    expect(plan.branches).toHaveLength(2);
    const strongTerms = branchTerms(plan, 'lookup');
    const dilutedTerms = branchTerms(plan, DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID);
    expect(strongTerms).toEqual(expect.arrayContaining(['клещевой', 'вирусный']));
    expect(dilutedTerms).not.toEqual(expect.arrayContaining(['клещевой']));
    expect(dilutedTerms).toEqual(expect.arrayContaining(['нейроинфекции', 'рецепторный']));
  });

  it('keeps an ICD-10-shaped token from a fanned-out alias in the primary branch', () => {
    const aliases = [
      alias('a.1', 'Ангина', 'Фарингит'),
      alias('a.2', 'Тонзиллофарингит', 'Фарингит'),
      alias('a.3', 'J02 Острый фарингит, МКБ-10', 'Фарингит'),
    ];
    const plan = buildLookupQueryPlan('фарингит у ребенка', aliases);

    expect(plan.branches).toHaveLength(2);
    expect(branchTerms(plan, 'lookup')).toEqual(expect.arrayContaining(['j02']));
    expect(branchTerms(plan, DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID)).not.toEqual(
      expect.arrayContaining(['j02']),
    );
    expect(branchTerms(plan, DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID)).toEqual(
      expect.arrayContaining(['тонзиллофарингит']),
    );
  });
});
