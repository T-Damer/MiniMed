import { describe, expect, it } from 'vitest';

import {
  convertQuantity,
  unitsForFamily,
} from '@/features/calculators/unit-conversion';

describe('convertQuantity', () => {
  it('converts mass through the canonical kilogram base unit', () => {
    const result = convertQuantity({ family: 'mass', value: 1, from: 'kg', to: 'mg' });

    expect(result).toMatchObject({ ok: true, value: 1_000_000, unit: 'mg' });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.trace).toHaveLength(3);
    expect(result.trace[1]).toMatchObject({ value: 1, unit: 'kg' });
  });

  it('converts length and volume without applying hidden rounding', () => {
    expect(convertQuantity({ family: 'length', value: 172, from: 'cm', to: 'm' })).toMatchObject({
      ok: true,
      value: 1.72,
      unit: 'm',
    });
    expect(convertQuantity({ family: 'volume', value: 2.5, from: 'ml', to: 'l' })).toMatchObject({
      ok: true,
      value: 0.0025,
      unit: 'l',
    });
  });

  it('rejects non-finite and negative quantities', () => {
    expect(convertQuantity({ family: 'mass', value: Number.NaN, from: 'kg', to: 'g' })).toMatchObject(
      { ok: false, error: { code: 'non-finite-value' } },
    );
    expect(convertQuantity({ family: 'length', value: -1, from: 'cm', to: 'm' })).toMatchObject({
      ok: false,
      error: { code: 'negative-value' },
    });
  });

  it('rejects units from another quantity family', () => {
    expect(convertQuantity({ family: 'mass', value: 10, from: 'ml', to: 'g' })).toMatchObject({
      ok: false,
      error: { code: 'unknown-source-unit' },
    });
    expect(convertQuantity({ family: 'volume', value: 10, from: 'ml', to: 'mg' })).toMatchObject({
      ok: false,
      error: { code: 'unknown-target-unit' },
    });
  });
});

describe('unitsForFamily', () => {
  it('returns only units accepted by the selected family', () => {
    expect(unitsForFamily('mass')).toEqual(['kg', 'g', 'mg', 'mcg']);
    expect(unitsForFamily('length')).toEqual(['m', 'cm', 'mm']);
    expect(unitsForFamily('volume')).toEqual(['l', 'ml']);
  });
});
