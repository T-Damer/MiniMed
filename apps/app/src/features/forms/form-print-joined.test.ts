import type { FormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

function schemaWithBrackets(): FormSchema {
  const base = findFormSchema('ru.minzdrav.274n.070u');
  if (!base) throw new Error('schema missing');
  const schema = structuredClone(base) as FormSchema;
  const first = schema.layout.blocks[0];
  if (!first) throw new Error('block missing');
  first.columns = [
    {
      widthPercent: 100,
      rows: [
        {
          segments: [
            { kind: 'text', text: 'сезоны' },
            { kind: 'text', text: '(', joined: true },
            { kind: 'options', fieldId: 'seasons', separator: ', ', joined: true },
            { kind: 'text', text: ')', joined: true },
          ],
        },
      ],
    },
  ];
  return schema;
}

describe('form print: a joined segment continues the previous one', () => {
  it('marks a joined text and a joined option list so no gap separates them', () => {
    const html = renderFormPrintHtml(schemaWithBrackets(), { seasons: ['1'] });
    expect(html).toContain('<span class="form-print__text form-print__joined">(</span>');
    expect(html).toContain('<span class="form-print__options form-print__joined">');
    expect(html).toContain('<span class="form-print__text form-print__joined">)</span>');
    expect(html).toContain('.form-print__joined { margin-left: -0.45em; }');
    // in a running-text row the items are separated by a space (0.25em), which the join removes
    expect(html).toContain(
      '.form-print__row--flow > .form-print__joined { margin-left: -0.25em; }',
    );
  });

  it('leaves ordinary segments with their gap', () => {
    const html = renderFormPrintHtml(schemaWithBrackets(), {});
    expect(html).toContain('<span class="form-print__text">сезоны</span>');
  });
});
