import type { FormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { resolveFieldPrefill, surnameWithInitials } from '@/features/forms/form-prefill';
import { datePart, renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

function base(): FormSchema {
  const schema = findFormSchema('ru.minzdrav.274n.070u');
  if (!schema) throw new Error('schema missing');
  return structuredClone(schema) as FormSchema;
}

/** A small schema using the layout vocabulary of the prescription blanks (order 1094н). */
function blankSchema(): FormSchema {
  const schema = base();
  const first = schema.layout.blocks[0];
  if (!first) throw new Error('block missing');
  first.columnGapMm = 2;
  first.columns = [
    {
      widthPercent: 100,
      rows: [
        {
          segments: [
            { kind: 'text', text: 'от', underline: true, indentMm: 4 },
            { kind: 'text', text: 'РЕЦЕПТ', large: true },
            { kind: 'text', text: 'Отметка\nна две строки' },
          ],
          heightMm: 3.4,
          paddingTopMm: 2.2,
        },
        {
          segments: [
            {
              kind: 'field',
              fieldId: 'formNumber',
              length: 20,
              lines: 2,
              lineStyle: 'dotted',
              pitch: 4.15,
            },
          ],
        },
        {
          segments: [{ kind: 'field', fieldId: 'formNumber', length: 12, plain: true }],
          minHeightMm: 10,
        },
        {
          segments: [
            {
              kind: 'field',
              fieldId: 'regionCode',
              length: 2,
              charCells: { count: 4, widthMm: 6 },
            },
            {
              kind: 'field',
              fieldId: 'formDate',
              length: 2,
              part: 'monthNumber',
              charCells: { count: 2, widthMm: 5, heightMm: 8 },
            },
            { kind: 'rule', length: 20, grow: true, lineStyle: 'dashed', indentMm: 3 },
          ],
        },
        { segments: [{ kind: 'field', fieldId: 'patientBirthDate', length: 20 }] },
      ],
    },
  ];
  return schema;
}

describe('form print: the vocabulary of the prescription blanks', () => {
  it('keeps indents, underline, large words and line feeds in text', () => {
    const html = renderFormPrintHtml(blankSchema(), {});
    expect(html).toContain('form-print__text--underline');
    expect(html).toContain('form-print__text--large');
    expect(html).toContain('style="margin-left:4mm;"');
    expect(html).toContain('Отметка\nна две строки');
    expect(html).toContain('.form-print__text { flex: 0 1 auto; white-space: pre-line; }');
  });

  it('gives a row an exact height, a top padding and a block its own column gap', () => {
    const html = renderFormPrintHtml(blankSchema(), {});
    expect(html).toContain('height:3.4mm');
    expect(html).toContain('padding-top:2.2mm');
    expect(html).toContain('min-height:10mm');
    expect(html).toContain('form-print__row--tall');
    expect(html).toContain('style="column-gap:2mm"');
  });

  it('draws dotted ruled lines a given pitch apart and unruled stamp areas', () => {
    const html = renderFormPrintHtml(blankSchema(), { formNumber: 'Rp.: tab. 10' });
    expect(html).toContain('form-print__line--dotted');
    expect(html).toContain('--ruled:4.15mm');
    expect(html).toContain('min-height:calc(2 * 4.15mm)');
    expect(html).toContain('form-print__blank--plain');
    expect(html).toContain('Rp.: tab. 10');
  });

  it('prints a dashed rule as a row of hyphens', () => {
    const html = renderFormPrintHtml(blankSchema(), {});
    expect(html).toContain('form-print__rule--hyphens');
    expect(html).toContain('-'.repeat(60));
  });

  it('writes a value one character per ruled cell and cuts or leaves cells blank', () => {
    const html = renderFormPrintHtml(blankSchema(), { regionCode: ['45'], formDate: '2026-10-05' });
    expect(html.match(/class="form-print__charcell[ "]/gu)?.length).toBe(4 + 2);
    expect(html).toContain('form-print__charcell form-print__charcell--first" style="width:6mm">4');
    expect(html).toContain('style="width:5mm;height:8mm">1');
    expect(html).toContain('style="width:5mm;height:8mm">0');
  });

  it('prints a date in one blank as day.month.year and the month as a number', () => {
    expect(datePart('2026-10-05', 'monthNumber')).toBe('10');
    const html = renderFormPrintHtml(blankSchema(), { patientBirthDate: '1980-03-04' });
    expect(html).toContain('04.03.1980');
  });
});

describe('prefill: surname and initials', () => {
  it('writes «Иванов И.И.» from a full name', () => {
    expect(surnameWithInitials('Иванов Иван Иванович')).toBe('Иванов И.И.');
    expect(surnameWithInitials('  петрова   анна-мария  ')).toBe('петрова А.-М.');
    expect(surnameWithInitials('Сидоров')).toBe('Сидоров');
    expect(surnameWithInitials('')).toBe('');
  });

  it('applies the binding format to each source value', () => {
    const field = {
      ...(base().fields[0] as FormSchema['fields'][number]),
      id: 'doctor',
      type: 'text' as const,
      prefill: { sources: ['clinician.fullName' as const], format: 'initials' as const },
    };
    expect(resolveFieldPrefill(field, { 'clinician.fullName': 'Сидорова Мария Петровна' })).toBe(
      'Сидорова М.П.',
    );
  });
});
