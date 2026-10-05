import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

function card() {
  const schema = findFormSchema('ru.minzdrav.274n.079u');
  if (!schema) throw new Error('schema missing');
  return schema;
}

describe('079/у print layout fitted to the official scan', () => {
  it('spreads the first text of a stretched line even when a blank comes before it', () => {
    const html = renderFormPrintHtml(card(), {});
    // «______ код по Международной статистической классификации» is one justified printed line
    expect(html).toMatch(
      /form-print__text form-print__text--stretchy">код по Международной статистической классификации</u,
    );
  });

  it('sets the side margins of each sheet and the small print of the header block', () => {
    const html = renderFormPrintHtml(card(), {});
    expect(html).toContain('data-block="child" style="padding-left:4.6mm"');
    expect(html).toContain('data-block="back" style="padding-right:4.4mm"');
    expect(html).toContain('form-print__row form-print__row--caption');
  });

  it('keeps the reverse side on its own sheet', () => {
    const html = renderFormPrintHtml(card(), {});
    expect(html).toContain('form-print__block form-print__block--page-break" data-block="back"');
    expect(html).not.toContain('form-print__block--page-break" data-block="child"');
  });
});
