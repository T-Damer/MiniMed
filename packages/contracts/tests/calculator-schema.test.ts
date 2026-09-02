import { describe, expect, it } from 'vitest';

import { CalculatorSourceReferenceSchema } from '../src/calculator-schema';

describe('calculator source contract', () => {
  it('rejects script and data source URLs', () => {
    const source = {
      title: 'Источник',
      publisher: 'Издатель',
      version: '1',
      reviewedAt: '2026-08-29',
    };
    expect(
      CalculatorSourceReferenceSchema.safeParse({ ...source, url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      CalculatorSourceReferenceSchema.safeParse({ ...source, url: 'data:text/plain,alert(1)' })
        .success,
    ).toBe(false);
  });
});
