import { describe, expect, it } from 'vitest';

import {
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import { parsePediatricFeedingPlan } from '@/features/calculators/pediatric-feeding-plan';
import { calculatorSchemaFromModules } from '@/features/calculators/tool-module-test-helpers';

const schema = calculatorSchemaFromModules('minimed.calculator.pediatric-feeding-plan');

function plan(overrides: Record<string, string | number> = {}) {
  const result = evaluateCalculatorSchema(schema, {
    ageMonths: 4,
    weightKg: 6,
    feedingMode: 'formula',
    complementaryStatus: 'not-started',
    feedsPerDay: 6,
    formulaKcalPer100Ml: 67,
    measuredBreastMilkPerFeedMl: 0,
    allergic: 0,
    intoleranceCategory: 'none',
    excludedFoods: '',
    includeCalendar: 0,
    ...overrides,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const stored = toStoredCalculationResult(result);
  if (!('textValues' in stored)) throw new Error('Expected text result');
  return parsePediatricFeedingPlan(stored.textValues);
}

describe('pediatric feeding plan schema', () => {
  it('calculates formula volume, mixed supplement, allergy replacement and calendar', () => {
    const formula = plan();
    expect(formula.dailyCalories).toBe('690 ккал');
    expect(formula.dailyVolume).toBe('900 г/мл');
    expect(formula.meals[0]?.volume).toBe('150 г/мл');

    const mixed = plan({ feedingMode: 'mixed', measuredBreastMilkPerFeedMl: 80 });
    expect(mixed.meals[0]?.food).toBe('Грудное молоко 80 мл + докорм смесью 70 мл');

    const allergic = plan({
      ageMonths: 8,
      weightKg: 8,
      feedingMode: 'breast',
      complementaryStatus: 'established',
      allergic: 1,
      intoleranceCategory: 'gluten',
      excludedFoods: 'пшеница',
      includeCalendar: 1,
    });
    expect(allergic.allergyPlan).toContain('гречневой, рисовой или кукурузной');
    expect(allergic.meals[1]?.food).toContain('Безглютеновая каша');
    expect(allergic.calendar).toHaveLength(7);
  });
});
