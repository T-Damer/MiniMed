import { describe, expect, it } from 'vitest';
import {
  parseUserCalculatorRoute,
  userCalculatorEditPath,
  userCalculatorNewPath,
  userCalculatorsPath,
} from '@/features/calculators/user-calculator/user-calculator-routing';

describe('«Мои калькуляторы» routes', () => {
  it('builds the three paths', () => {
    expect(userCalculatorsPath()).toBe('#/calculators/mine');
    expect(userCalculatorNewPath()).toBe('#/calculators/mine/new');
    expect(userCalculatorEditPath('uc-abc123def456')).toBe(
      '#/calculators/mine/uc-abc123def456/edit',
    );
  });

  it('reads them back', () => {
    expect(parseUserCalculatorRoute('calculators/mine')).toEqual({ kind: 'list' });
    expect(parseUserCalculatorRoute('calculators/section/custom')).toEqual({ kind: 'list' });
    expect(parseUserCalculatorRoute('calculators/mine/new')).toEqual({ kind: 'new' });
    expect(parseUserCalculatorRoute('calculators/mine/uc-abc123def456/edit')).toEqual({
      kind: 'edit',
      id: 'uc-abc123def456',
    });
  });

  it('shows the list for a malformed route under «mine» and ignores every other route', () => {
    expect(parseUserCalculatorRoute('calculators/mine/uc-abc123def456')).toEqual({ kind: 'list' });
    expect(parseUserCalculatorRoute('calculators/mine/%E0%A4%A/edit')).toEqual({ kind: 'list' });
    expect(parseUserCalculatorRoute('calculators/mine/a/b/c')).toEqual({ kind: 'list' });
    expect(parseUserCalculatorRoute('calculators')).toBeUndefined();
    expect(parseUserCalculatorRoute('calculators/bsa')).toBeUndefined();
    expect(parseUserCalculatorRoute('calculators/section/renal')).toBeUndefined();
    expect(parseUserCalculatorRoute('assessments/mine')).toBeUndefined();
    expect(parseUserCalculatorRoute('')).toBeUndefined();
  });
});
