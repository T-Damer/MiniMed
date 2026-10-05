import { parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import schemaJson from '@/features/forms/schemas/ru-minzdrav-1092n-003-vu.json';

const schema = parseFormSchema(schemaJson);

describe('form 003-В/у (order 1092н)', () => {
  it('parses against the contract and prints as one A4 portrait sheet', () => {
    expect(schema.id).toBe('ru.minzdrav.1092n.003-vu');
    const html = renderFormPrintHtml(schema, {});
    expect(html).toContain('size: A4 portrait');
    expect(html).not.toContain('form-print__block--page-break"');
    expect(html).toContain('Форма № 003-В/у');
  });

  it('prints the V and Z marks in the category cells and V in the restriction rows', () => {
    const html = renderFormPrintHtml(schema, {
      categoryB: 'V',
      categoryM: 'Z',
      restrictionCar: 'V',
    });
    expect(html).toMatch(/<td class="form-print__cell-body">V<\/td>/u);
    expect(html).toMatch(/<td class="form-print__cell-body">Z<\/td>/u);
    expect((html.match(/<td class="form-print__cell-body">V<\/td>/gu) ?? []).length).toBe(2);
  });

  it('rules the tables with the row heights and top alignment of the blank', () => {
    const html = renderFormPrintHtml(schema, {});
    expect(html).toContain('--cell-h:8.5mm;--cell-va:top');
    expect(html).toContain('--cell-h:4.4mm;--cell-va:top');
  });

  it('underlines the picked answer of line 5.2 without a gap before the bracket', () => {
    const html = renderFormPrintHtml(schema, { contraindications: 'present' });
    expect(html).toContain(
      '<span class="form-print__option form-print__option--underlined">наличие</span>',
    );
    expect(html).toContain('form-print__text form-print__joined">) медицинских противопоказаний');
  });

  it('names the sub-item of item 6 that governs a field', () => {
    const rule = schema.rules.find((candidate) => candidate.id === '6.1');
    expect(rule?.clause).toBe('6, подпункт 1');
    expect(rule?.appendix?.title).toBe('Порядок выдачи медицинского заключения');
  });
});
