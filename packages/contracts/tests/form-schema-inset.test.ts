import { describe, expect, it } from 'vitest';

import { FormLayoutBlockSchema } from '../src/form-schema';

const rows = [{ segments: [{ kind: 'text', text: 'Жалобы' }] }];

describe('form layout: a block inset', () => {
  it('accepts a left and a right inset in millimetres', () => {
    const block = FormLayoutBlockSchema.parse({
      id: 'clinical',
      insetMm: { left: 0.9, right: 4.2 },
      columns: [{ widthPercent: 100, rows }],
    });
    expect(block.insetMm).toEqual({ left: 0.9, right: 4.2 });
  });

  it('is optional and rejects a negative inset', () => {
    expect(
      FormLayoutBlockSchema.safeParse({ id: 'a', columns: [{ widthPercent: 100, rows }] }).success,
    ).toBe(true);
    expect(
      FormLayoutBlockSchema.safeParse({
        id: 'a',
        insetMm: { left: -1 },
        columns: [{ widthPercent: 100, rows }],
      }).success,
    ).toBe(false);
  });
});
