import type { FormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { buildFormPrefillContext, prefillFormValues } from '@/features/forms/form-prefill';
import { renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

function base(): FormSchema {
  const schema = findFormSchema('ru.minzdrav.274n.070u');
  if (!schema) throw new Error('schema missing');
  return schema;
}

/** A small schema carrying the new layout capabilities, derived from a real one. */
function flowSchema(): FormSchema {
  const schema = structuredClone(base()) as FormSchema;
  const optionsField = schema.fields.find((field) => field.id === 'seasons');
  if (!optionsField) throw new Error('seasons missing');
  const first = schema.layout.blocks[0];
  if (!first) throw new Error('block missing');
  first.columns = [
    {
      widthPercent: 100,
      rows: [
        {
          segments: [
            { kind: 'text', text: 'на дому' },
            { kind: 'check', fieldId: 'noContraindications', inline: true },
          ],
        },
        {
          segments: [
            { kind: 'options', fieldId: 'seasons', separator: ', ', range: [0, 2] },
            { kind: 'text', text: 'конец первой строки' },
          ],
        },
        {
          segments: [
            { kind: 'options', fieldId: 'seasons', separator: ', ', range: [2, 4] },
            {
              kind: 'table',
              header: [[{ text: 'Графа' }]],
              cellPaddingMm: { x: 1.5, y: 1 },
              rows: [
                [
                  {
                    segments: [
                      { kind: 'text', text: '5.1.' },
                      { kind: 'check', fieldId: 'noContraindications' },
                      { kind: 'text', text: 'Установление группы инвалидности' },
                    ],
                    align: 'justify',
                    colSpan: 2,
                  },
                ],
              ],
            },
          ],
        },
      ],
    },
  ];
  return schema;
}

describe('form print: running-text cells, inline boxes and split option lists', () => {
  it('puts text, the box and the rest of a flow cell in one table cell', () => {
    const html = renderFormPrintHtml(flowSchema(), { noContraindications: true });
    expect(html).toContain('form-print__cell-flow form-print__cell-flow--justify');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('form-print__check form-print__check--in-cell');
    expect(html).toContain('--cell-px:1.5mm;--cell-py:1mm');
    expect(html).toContain('Установление группы инвалидности');
  });

  it('marks an inline box so it follows the text instead of the line end', () => {
    const html = renderFormPrintHtml(flowSchema(), {});
    expect(html).toContain('form-print__check form-print__check--inline');
  });

  it('prints only the options of the range, keeping the separator at a split point', () => {
    const html = renderFormPrintHtml(flowSchema(), { seasons: ['2'] });
    const options = [
      ...html.matchAll(/<span class="form-print__options">(.*?)<\/span><\/span>(?=<)/gu),
    ];
    expect(html).toContain('зима – 1');
    expect(html).toContain('весна – 2');
    expect(html).toContain('лето – 3');
    expect(html).toContain('осень – 4');
    // the first slice ends with its separator (the comma before the line break)
    expect(html).toMatch(
      /весна – 2<\/span><span class="form-print__separator">, <\/span><\/span>/u,
    );
    expect(options.length).toBeGreaterThan(0);
  });
});

describe('form prefill: a mapped «true» ticks a checkbox', () => {
  it('ticks only the box whose mapped value matches the stored source', () => {
    const schema = structuredClone(base()) as FormSchema;
    schema.fields = schema.fields.map((field) => {
      if (field.id === 'noContraindications') {
        return { ...field, prefill: { sources: ['patient.sex'], map: { male: 'true' } } };
      }
      if (field.id === 'escort') return field;
      return field;
    });
    const male = prefillFormValues(
      schema,
      buildFormPrefillContext({
        profile: {
          id: 'p',
          displayName: 'Т',
          biologicalSex: 'male',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        now: new Date('2026-10-05T10:00:00'),
      }),
    );
    expect(male.values['noContraindications']).toBe(true);
    const female = prefillFormValues(
      schema,
      buildFormPrefillContext({
        profile: {
          id: 'p',
          displayName: 'Т',
          biologicalSex: 'female',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        now: new Date('2026-10-05T10:00:00'),
      }),
    );
    expect(female.values['noContraindications']).toBeUndefined();
  });
});
