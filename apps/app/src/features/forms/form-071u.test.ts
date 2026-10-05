import { parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import { fieldRuleView, ruleCitation } from '@/features/forms/form-view-model';
import schemaJson from '@/features/forms/schemas/ru-minzdrav-395n-071u.json';

const schema = parseFormSchema(schemaJson);

describe('form 071/у (order 395н, no filling rules)', () => {
  it('parses without a rules appendix and keeps the two clauses of the order', () => {
    expect(schema.id).toBe('ru.minzdrav.395n.071u');
    expect(schema.source.rulesAppendix).toBeUndefined();
    expect(schema.rules.map((rule) => rule.id)).toEqual(['1', '2']);
  });

  it('leaves every field undefined with a note and no cited paragraph', () => {
    for (const field of schema.fields) {
      const view = fieldRuleView(schema, field);
      expect(view.status).toBe('undefined');
      expect(view.paragraphs).toEqual([]);
      expect(view.note).toBeTruthy();
    }
  });

  it('cites a clause of the order itself, not an appendix, when there is no rules appendix', () => {
    const first = schema.rules[0];
    if (!first) throw new Error('no clause');
    expect(ruleCitation(schema, first)).toBe('Приказ № 395н, п. 1; стр. 1 официального PDF');
  });

  it('prints two A4 sheets: the certificate with its footnote, then the tables', () => {
    const html = renderFormPrintHtml(schema, {});
    expect(html).toContain('size: A4 portrait');
    expect((html.match(/form-print__block--page-break"/gu) ?? []).length).toBe(1);
    expect(html).toContain('¹ Постановление Правительства Российской Федерации');
    expect(html).toContain('Форма № 071/у');
    expect(html).toContain('от «9» июня 2022 г. № 395н');
  });

  it('prints the marks typed in the tables as they are written', () => {
    const html = renderFormPrintHtml(schema, { categoryB: 'x', restrictionF: 'x' });
    expect((html.match(/<td class="form-print__cell-body">x<\/td>/gu) ?? []).length).toBe(2);
  });
});
