import { describe, expect, it } from 'vitest';

import { segmentTextWithCalculatorLinks } from '@/features/calculators/calculator-links';

describe('calculator document links', () => {
  it('links calculator names and abbreviations without changing text', () => {
    const text = 'Рассчитайте ППТ Mosteller, затем оцените СКФ CKD-EPI 2021.';
    const segments = segmentTextWithCalculatorLinks(text);

    expect(segments.map((segment) => segment.value).join('')).toBe(text);
    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'calculator', slug: 'body-surface-area-mosteller' }),
        expect.objectContaining({ kind: 'calculator', slug: 'adult-egfr-ckd-epi-2021' }),
      ]),
    );
  });

  it('does not link a calculator alias inside a longer word', () => {
    expect(segmentTextWithCalculatorLinks('ППТобразный фрагмент')).toEqual([
      { kind: 'text', value: 'ППТобразный фрагмент' },
    ]);
  });
});
