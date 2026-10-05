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

  it('starts the reverse side on a new page and keeps «обратная сторона» out of the first sheet', () => {
    const card = findFormSchema('ru.minzdrav.274n.072u');
    if (!card) throw new Error('schema missing');
    const html = renderFormPrintHtml(card, { complaints: 'Боли в суставах' });
    expect(html).toContain(
      'form-print__block form-print__block--page-break" data-block="clinical"',
    );
    expect(html).toContain('Боли в суставах');
    expect(html).toContain('оборотная сторона ф. № 072/у');
    expect(html).toContain('form-print__blank--lines');
    expect(html).toContain('size: A4 portrait');
  });

  it('prints the talon on a landscape sheet with framed groups and the tables of the blank', () => {
    const talon = findFormSchema('ru.minzdrav.274n.025-1u');
    if (!talon) throw new Error('schema missing');
    const html = renderFormPrintHtml(talon, {
      visitDate1: '2026-10-05',
      visitDate9: '2026-10-07',
      prescription1Name: 'Амоксициллин',
      prescription1Date: '2026-10-05',
      visitPurposeDisease: ['1', '1.2'],
      prelimDiagnosisIcd: 'J45.0',
    });
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('form-print__block form-print__block--framed');
    expect(html).toContain('<table class="form-print__table">');
    expect(html).toContain('25. Даты посещений');
    expect(html).toContain('>05.10.2026<');
    expect(html).toContain('>07.10.2026<');
    expect(html).toContain('Амоксициллин');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain(
      'form-print__option form-print__option--picked">активное посещение – 1.2',
    );
    expect(html).toContain('J45.0');
  });

  it('underlines the applicable words when the blank says «нужное подчеркнуть»', () => {
    const certificate = findFormSchema('ru.minzdrav.274n.079u');
    if (!certificate) throw new Error('schema missing');
    const html = renderFormPrintHtml(certificate, { anthropometryNote: ['2'] });
    expect(html).toContain(
      'form-print__option form-print__option--underlined">избыток массы тела<',
    );
    expect(html).not.toContain('избыток массы тела – 2');
  });
});
