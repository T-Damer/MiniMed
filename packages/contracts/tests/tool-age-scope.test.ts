import { describe, expect, it } from 'vitest';

import {
  anyAgeScope,
  TOOL_AGE_GROUPS,
  ToolAgeScopeSchema,
  toolAgeBoundEndDays,
  toolAgeBoundStartDays,
} from '../src/tool-age-scope';

const basis = 'Определение инструмента';

describe('tool age scope', () => {
  it('accepts adults, children with a range, newborns and any age', () => {
    expect(ToolAgeScopeSchema.safeParse({ groups: ['adults'], basis }).success).toBe(true);
    expect(
      ToolAgeScopeSchema.safeParse({
        groups: ['children'],
        minAge: { value: 1, unit: 'years' },
        maxAge: { value: 16, unit: 'years' },
        basis,
      }).success,
    ).toBe(true);
    expect(ToolAgeScopeSchema.safeParse({ groups: ['neonates'], basis }).success).toBe(true);
    expect(ToolAgeScopeSchema.safeParse(anyAgeScope(basis)).success).toBe(true);
    expect([...TOOL_AGE_GROUPS]).toEqual(['neonates', 'children', 'adults']);
  });

  it('rejects a scope without groups or without the statement it rests on', () => {
    expect(ToolAgeScopeSchema.safeParse({ groups: [], basis }).success).toBe(false);
    expect(ToolAgeScopeSchema.safeParse({ groups: ['adults'] }).success).toBe(false);
    expect(ToolAgeScopeSchema.safeParse({ groups: ['adults'], basis: '' }).success).toBe(false);
    expect(ToolAgeScopeSchema.safeParse({ basis }).success).toBe(false);
  });

  it('rejects duplicate groups, unknown groups and unknown keys', () => {
    expect(ToolAgeScopeSchema.safeParse({ groups: ['adults', 'adults'], basis }).success).toBe(
      false,
    );
    expect(ToolAgeScopeSchema.safeParse({ groups: ['teens'], basis }).success).toBe(false);
    expect(ToolAgeScopeSchema.safeParse({ groups: ['adults'], basis, extra: 1 }).success).toBe(
      false,
    );
  });

  it('keeps limits consistent with the declared groups', () => {
    const min = (value: number, unit: 'days' | 'months' | 'years') => ({ value, unit });
    // Lower limit above the upper limit.
    expect(
      ToolAgeScopeSchema.safeParse({
        groups: ['children'],
        minAge: min(10, 'years'),
        maxAge: min(5, 'years'),
        basis,
      }).success,
    ).toBe(false);
    // An adults-only tool cannot start below 18 years.
    expect(
      ToolAgeScopeSchema.safeParse({ groups: ['adults'], minAge: min(16, 'years'), basis }).success,
    ).toBe(false);
    expect(
      ToolAgeScopeSchema.safeParse({ groups: ['adults'], minAge: min(21, 'years'), basis }).success,
    ).toBe(true);
    // A children-only tool cannot reach into adulthood (WHO 5-19 stays valid).
    expect(
      ToolAgeScopeSchema.safeParse({ groups: ['children'], maxAge: min(25, 'years'), basis })
        .success,
    ).toBe(false);
    expect(
      ToolAgeScopeSchema.safeParse({
        groups: ['neonates', 'children'],
        maxAge: min(19, 'years'),
        basis,
      }).success,
    ).toBe(true);
    // A newborn-only tool covers the first month.
    expect(
      ToolAgeScopeSchema.safeParse({ groups: ['neonates'], maxAge: min(30, 'days'), basis })
        .success,
    ).toBe(true);
    expect(
      ToolAgeScopeSchema.safeParse({ groups: ['neonates'], maxAge: min(6, 'months'), basis })
        .success,
    ).toBe(false);
    // Newborns and adults without children make no sense; a tool starting after the newborn
    // month cannot list newborns.
    expect(ToolAgeScopeSchema.safeParse({ groups: ['neonates', 'adults'], basis }).success).toBe(
      false,
    );
    expect(
      ToolAgeScopeSchema.safeParse({
        groups: ['neonates', 'children'],
        minAge: min(2, 'months'),
        basis,
      }).success,
    ).toBe(false);
  });

  it('measures limits in completed units', () => {
    expect(toolAgeBoundStartDays({ value: 2, unit: 'months' })).toBe(60);
    expect(toolAgeBoundEndDays({ value: 16, unit: 'years' })).toBe(Math.ceil(17 * 365.25) - 1);
    expect(toolAgeBoundEndDays({ value: 30, unit: 'days' })).toBe(30);
  });
});
