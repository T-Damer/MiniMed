import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

describe('form print: the blocks of the two sides keep the edges of their scan', () => {
  it('pads the sanatorium card front and reverse differently', () => {
    const schema = findFormSchema('ru.minzdrav.274n.072u');
    if (!schema) throw new Error('schema missing');
    const html = renderFormPrintHtml(schema, {});
    expect(html).toMatch(/data-block="header" style="padding-left:[\d.]+mm"/u);
    expect(html).toMatch(
      /data-block="clinical" style="padding-left:[\d.]+mm;padding-right:[\d.]+mm"/u,
    );
  });

  it('leaves a block without an inset unstyled', () => {
    const schema = findFormSchema('ru.minzdrav.274n.070u');
    if (!schema) throw new Error('schema missing');
    expect(renderFormPrintHtml(schema, {})).not.toContain('padding-left');
  });
});
