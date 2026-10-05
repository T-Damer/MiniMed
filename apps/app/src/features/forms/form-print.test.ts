import { describe, expect, it } from 'vitest';

import {
  datePart,
  displayDate,
  escapeHtml,
  renderFormPrintHtml,
} from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';

const form = (() => {
  const schema = findFormSchema('ru.minzdrav.274n.070u');
  if (!schema) throw new Error('schema missing');
  return schema;
})();

describe('form print', () => {
  it('splits a date into the three blanks of «__» ______ 20__ г.', () => {
    expect(datePart('2026-10-05', 'day')).toBe('05');
    expect(datePart('2026-10-05', 'month')).toBe('октября');
    expect(datePart('2026-10-05', 'year2')).toBe('26');
    expect(datePart('', 'day')).toBe('');
    expect(displayDate('2026-10-05')).toBe('05.10.2026');
  });

  it('prints the blank with captions as printed, values in blanks and the picked option marked', () => {
    const html = renderFormPrintHtml(form, {
      patientFullName: 'Иванов Иван Иванович',
      patientBirthDate: '1980-03-04',
      patientSex: '1',
      seasons: ['2', '3'],
      noContraindications: true,
      regionCode: '45',
    });
    expect(html).toContain('Справка №');
    expect(html).toContain('для получения путевки на санаторно-курортное лечение');
    expect(html).toContain('Иванов Иван Иванович');
    expect(html).toContain('марта');
    expect(html).toContain('form-print__option form-print__option--picked">муж. – 1');
    expect(html).toContain('form-print__option">жен. – 2');
    expect(html).toContain('form-print__option form-print__option--picked">весна – 2');
    expect(html).toContain('form-print__option form-print__option--picked">лето – 3');
    expect(html).not.toContain('form-print__option--picked">зима');
    expect(html).toContain('>✓<');
    expect(html).toContain('>45<');
    expect(html).toContain('М.П. (при наличии)');
    expect(html).toContain('size: A4 portrait');
  });

  it('escapes user text so a value can never inject markup', () => {
    const html = renderFormPrintHtml(form, { patientFullName: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#039;&amp;');
  });

  it('prints every field of the schema somewhere on the blank', () => {
    const empty = renderFormPrintHtml(form, {});
    expect(empty).toContain('Лечащий врач, должность врача-специалиста');
    expect(empty).toContain('подпись');
  });
});
