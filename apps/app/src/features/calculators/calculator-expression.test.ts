import { describe, expect, it } from 'vitest';

import {
  CalculatorExpressionError,
  evaluateCalculatorExpression,
  parseCalculatorExpression,
  renderExpressionWithValues,
} from '@/features/calculators/calculator-expression';

describe('calculator expression parser/evaluator', () => {
  it('evaluates arithmetic with standard precedence', () => {
    expect(evaluateCalculatorExpression('2 + 3 * 4', {})).toBe(14);
    expect(evaluateCalculatorExpression('(2 + 3) * 4', {})).toBe(20);
    expect(evaluateCalculatorExpression('2 ^ 3 ^ 2', {})).toBe(512); // right-associative
    expect(evaluateCalculatorExpression('-2 ^ 2', {})).toBe(4); // unary binds to the base here
  });

  it('resolves variables from scope', () => {
    expect(evaluateCalculatorExpression('height * weight', { height: 180, weight: 70 })).toBe(
      12600,
    );
  });

  it('supports min/max/abs/sqrt/round/pow', () => {
    expect(evaluateCalculatorExpression('min(3, 5)', {})).toBe(3);
    expect(evaluateCalculatorExpression('max(3, 5)', {})).toBe(5);
    expect(evaluateCalculatorExpression('abs(-7)', {})).toBe(7);
    expect(evaluateCalculatorExpression('sqrt(16)', {})).toBe(4);
    expect(evaluateCalculatorExpression('round(2.6)', {})).toBe(3);
    expect(evaluateCalculatorExpression('pow(2, 10)', {})).toBe(1024);
  });

  it('branches with cond() on numeric comparisons', () => {
    expect(evaluateCalculatorExpression('cond(age >= 18, 1, 0)', { age: 20 })).toBe(1);
    expect(evaluateCalculatorExpression('cond(age >= 18, 1, 0)', { age: 10 })).toBe(0);
  });

  it('branches with cond() on string equality, e.g. a sex-dependent coefficient', () => {
    const expression = 'cond(sex == "female", 0.7, 0.9)';
    expect(evaluateCalculatorExpression(expression, { sex: 'female' })).toBe(0.7);
    expect(evaluateCalculatorExpression(expression, { sex: 'male' })).toBe(0.9);
  });

  it('reproduces the CKD-EPI 2021 female coefficient path end to end', () => {
    // 42-year-old female, creatinine 0.9 mg/dl — mirrors calculateAdultEgfrCkdEpi2021's own numbers.
    const scope = { scr: 0.9, sex: 'female', age: 42 };
    const kappa = evaluateCalculatorExpression('cond(sex == "female", 0.7, 0.9)', scope);
    const alpha = evaluateCalculatorExpression('cond(sex == "female", -0.241, -0.302)', scope);
    const sexFactor = evaluateCalculatorExpression('cond(sex == "female", 1.012, 1)', scope);
    const ratio = evaluateCalculatorExpression('scr / kappa', { ...scope, kappa });
    const value = evaluateCalculatorExpression(
      '142 * min(ratio, 1) ^ alpha * max(ratio, 1) ^ -1.2 * 0.9938 ^ age * sexFactor',
      { ...scope, ratio, alpha, sexFactor },
    );
    expect(value).toBeCloseTo(81.8565, 3);
  });

  it('rejects unknown variables, unknown functions, and malformed syntax', () => {
    expect(() => evaluateCalculatorExpression('unknownVar + 1', {})).toThrow(
      CalculatorExpressionError,
    );
    expect(() => evaluateCalculatorExpression('notAFunction(1)', {})).toThrow(
      CalculatorExpressionError,
    );
    expect(() => evaluateCalculatorExpression('2 +', {})).toThrow(CalculatorExpressionError);
    expect(() => evaluateCalculatorExpression('min(1)', {})).toThrow(CalculatorExpressionError);
    expect(() => evaluateCalculatorExpression('(1 + 2', {})).toThrow(CalculatorExpressionError);
  });

  it('rejects using a string value in arithmetic', () => {
    expect(() => evaluateCalculatorExpression('sex + 1', { sex: 'female' })).toThrow(
      CalculatorExpressionError,
    );
  });

  it('tests variable presence with present() without evaluating absent variables', () => {
    expect(evaluateCalculatorExpression('present(x)', {})).toBe(0);
    expect(evaluateCalculatorExpression('present(x)', { x: 5 })).toBe(1);
    expect(evaluateCalculatorExpression('present(x)', { x: 0 })).toBe(1);
    expect(evaluateCalculatorExpression('cond(present(x), x + 1, 0)', {})).toBe(0);
    expect(() => evaluateCalculatorExpression('present(1)', {})).toThrow(CalculatorExpressionError);
    expect(() => evaluateCalculatorExpression('present(x + 1)', {})).toThrow(
      CalculatorExpressionError,
    );
  });

  it('never reaches JS eval/Function — a string containing JS syntax just fails to parse', () => {
    expect(() => evaluateCalculatorExpression('require("node:fs")', {})).toThrow(
      CalculatorExpressionError,
    );
    expect(() => evaluateCalculatorExpression('(() => 1)()', {})).toThrow(
      CalculatorExpressionError,
    );
  });

  it('renders a readable trace by substituting variable values into the expression', () => {
    const node = parseCalculatorExpression('min(ratio, 1) ^ alpha');
    const text = renderExpressionWithValues(node, { ratio: 1.2857142857142858, alpha: -0.241 });
    expect(text).toBe('min(1.28571, 1) ^ -0.241');
  });
});

describe('date functions (addDays/daysBetween/today)', () => {
  it('addDays adds calendar days and returns an ISO date string', () => {
    expect(evaluateCalculatorExpression('addDays(lmp, 280)', { lmp: '2026-01-01' })).toBe(
      '2026-10-08',
    );
  });

  it('addDays accepts a negative offset', () => {
    expect(evaluateCalculatorExpression('addDays(edd, -280)', { edd: '2026-10-08' })).toBe(
      '2026-01-01',
    );
  });

  it('daysBetween returns the whole-day difference between two ISO dates', () => {
    expect(
      evaluateCalculatorExpression('daysBetween(lmp, asOf)', {
        lmp: '2026-01-01',
        asOf: '2026-03-15',
      }),
    ).toBe(73);
  });

  it("daysBetween mirrors calculateEddByLmp/calculateGestationalAgeFromEdd's day math exactly", () => {
    // Naegele: EDD = LMP + 280 days; implied LMP = EDD - 280 days — round-trips exactly.
    const lmp = '2026-01-01';
    const edd = evaluateCalculatorExpression('addDays(lmp, 280)', { lmp });
    const impliedLmp = evaluateCalculatorExpression('addDays(edd, -280)', { edd });
    expect(impliedLmp).toBe(lmp);
    const gaDays = evaluateCalculatorExpression('daysBetween(impliedLmp, asOf)', {
      impliedLmp,
      asOf: '2026-01-15',
    });
    expect(gaDays).toBe(14);
  });

  it('today() returns today in ISO date form with no arguments', () => {
    const result = evaluateCalculatorExpression('today()', {});
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(result).toBe(
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`,
    );
  });

  it('rejects a malformed date string', () => {
    expect(() => evaluateCalculatorExpression('addDays(bad, 1)', { bad: 'not-a-date' })).toThrow(
      CalculatorExpressionError,
    );
    expect(() => evaluateCalculatorExpression('addDays(bad, 1)', { bad: 15 })).toThrow(
      CalculatorExpressionError,
    );
  });
});
