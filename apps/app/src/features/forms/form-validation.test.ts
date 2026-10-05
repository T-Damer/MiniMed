import { describe, expect, it } from 'vitest';

import { findFormSchema } from '@/features/forms/form-registry';
import { fieldError, isCalendarDate, validateForm } from '@/features/forms/form-validation';

const form = (() => {
  const schema = findFormSchema('ru.minzdrav.274n.070u');
  if (!schema) throw new Error('schema missing');
  return schema;
})();
const field = (id: string) => {
  const found = form.fields.find((candidate) => candidate.id === id);
  if (!found) throw new Error(id);
  return found;
};
const options = { today: '2026-10-05' } as const;

describe('form validation', () => {
  it('checks calendar dates', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2025-02-29')).toBe(false);
    expect(isCalendarDate('1850-01-01')).toBe(false);
    expect(isCalendarDate('05.10.2026')).toBe(false);
  });

  it('rejects a birth date in the future, as the schema declares', () => {
    expect(fieldError(field('patientBirthDate'), '2027-01-01', options)).toBe(
      'Дата не может быть в будущем.',
    );
    expect(fieldError(field('patientBirthDate'), '1980-03-04', options)).toBeUndefined();
    expect(fieldError(field('formDate'), '2027-01-01', options)).toBeUndefined();
  });

  it('checks the ICD-10 shape and, when МКБ data is on the device, the code itself', () => {
    expect(fieldError(field('diagnosisIcd'), 'J45.0', options)).toBeUndefined();
    expect(fieldError(field('diagnosisIcd'), 'j45', options)).toBe('Код МКБ-10 в формате J45.0');
    expect(fieldError(field('diagnosisIcd'), 'J451', options)).toBeDefined();
    const known = (code: string) => (code === 'J45.0' ? true : false);
    expect(fieldError(field('diagnosisIcd'), 'Z99.9', { ...options, icdKnown: known })).toBe(
      'Такого кода нет в МКБ.',
    );
    expect(
      fieldError(field('diagnosisIcd'), 'Z99.9', { ...options, icdKnown: () => undefined }),
    ).toBeUndefined();
  });

  it('checks the SNILS format, choices and the OGRN pattern from the schema', () => {
    expect(fieldError(field('snils'), '123-456-789 01', options)).toBeUndefined();
    expect(fieldError(field('snils'), '12345678901', options)).toBe(
      'СНИЛС в формате 123-456-789 01',
    );
    expect(fieldError(field('patientSex'), '3', options)).toBeDefined();
    expect(fieldError(field('seasons'), ['1', '3'], options)).toBeUndefined();
    expect(fieldError(field('seasons'), ['1', '9'], options)).toBeDefined();
    expect(fieldError(field('organizationOgrn'), '123', options)).toBeDefined();
  });

  it('lists required fields that are still empty, in schema order', () => {
    const result = validateForm(
      form,
      { patientFullName: 'Иванов И. И.', noContraindications: false },
      options,
    );
    expect(result.missing).not.toContain('patientFullName');
    expect(result.missing).toContain('patientBirthDate');
    expect(result.missing).toContain('diagnosisIcd');
    expect(result.missing).not.toContain('comorbidities');
    expect(result.missing.indexOf('patientBirthDate')).toBeLessThan(
      result.missing.indexOf('diagnosisIcd'),
    );
    expect(result.missing).not.toContain('attendingDoctorSignature');
  });
});
