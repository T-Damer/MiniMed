import { FormLayoutSchema, type FormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

/** 070/у with its first block replaced by rows that use the fitting capabilities. */
function fitted(): FormSchema {
  const base = findFormSchema('ru.minzdrav.274n.070u');
  if (!base) throw new Error('schema missing');
  const schema = structuredClone(base) as FormSchema;
  const first = schema.layout.blocks[0];
  if (!first) throw new Error('block missing');
  first.insetMm = { left: 4.6, right: 1.2 };
  first.columns = [
    {
      widthPercent: 100,
      rows: [
        {
          align: 'stretch',
          segments: [
            { kind: 'field', fieldId: 'formNumber', length: 10 },
            { kind: 'text', text: 'код по Международной статистической классификации' },
          ],
        },
        { align: 'stretch', segments: [{ kind: 'text', text: 'строка без бланка' }] },
        { size: 'caption', segments: [{ kind: 'text', text: 'мелкий шрифт шапки' }] },
      ],
    },
  ];
  return schema;
}

describe('fitting capabilities of the print layout', () => {
  it('accepts the caption size and the side insets in the contract', () => {
    expect(FormLayoutSchema.safeParse(fitted().layout).success).toBe(true);
  });

  it('stretches the first text of a row even when a blank comes first', () => {
    const html = renderFormPrintHtml(fitted(), {});
    expect(html).toContain(
      'form-print__text form-print__text--stretchy">код по Международной статистической классификации',
    );
    expect(html).toContain('form-print__text form-print__text--stretchy">строка без бланка');
  });

  it('sets the small print of a row and the side insets of a block', () => {
    const html = renderFormPrintHtml(fitted(), {});
    expect(html).toContain('form-print__row form-print__row--caption');
    expect(html).toContain('.form-print__row--caption { font-size: 0.72em; }');
    expect(html).toContain('style="padding-left:4.6mm;padding-right:1.2mm"');
  });
});
