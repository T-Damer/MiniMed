import { describe, expect, it } from 'vitest';

import { plainFieldLabel } from '@/features/forms/form-field-labels';
import { findFormSchema } from '@/features/forms/form-registry';

describe('plain labels of form fields', () => {
  it('shortens the legal wording of the 070/у fields the doctor fills', () => {
    const schema = findFormSchema('ru.minzdrav.274n.070u');
    if (!schema) throw new Error('Form 070/у is not registered');
    const plain = new Map(schema.fields.map((field) => [field.id, plainFieldLabel(field.label)]));
    expect(plain.get('organization')).toBe('Медицинская организация и её адрес');
    expect(plain.get('organizationOgrn')).toBe('ОГРН');
    expect(plain.get('patientFullName')).toBe('ФИО пациента');
    expect(plain.get('omsPolicyNumber')).toBe('Полис ОМС');
    expect(plain.get('omsInsurer')).toBe('Страховая компания');
    expect(plain.get('snils')).toBe('СНИЛС');
    expect(plain.get('diagnosisIcd')).toBe('Код МКБ');
    expect(plain.get('comorbiditiesIcd')).toBe('Код МКБ (сопутствующие заболевания)');
    // No field of the form keeps a label that reads as a paragraph of the order.
    for (const [id, label] of plain) {
      if (!['stamp'].includes(id)) expect(label.length, `${id}: ${label}`).toBeLessThanOrEqual(60);
    }
  });

  it('keeps the official wording where the order has no short name for it', () => {
    expect(plainFieldLabel('Дата справки')).toBe('Дата справки');
    expect(plainFieldLabel('Фамилия, имя, отчество (при наличии) ребенка')).toBe('ФИО ребенка');
  });
});
