import { type FormSchema, parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { buildFormPrefillContext, prefillFormValues } from '@/features/forms/form-prefill';
import { renderFormPrintHtml } from '@/features/forms/form-print';
import { ruleCitation } from '@/features/forms/form-view-model';
import f107 from '@/features/forms/schemas/ru-minzdrav-1094n-107-1u.json';
import f04l from '@/features/forms/schemas/ru-minzdrav-1094n-148-1u-04l.json';
import f88 from '@/features/forms/schemas/ru-minzdrav-1094n-148-1u-88.json';
import type { ClinicalEpisode, PatientProfile } from '@/state/patient-domain';

const schemas: Record<string, FormSchema> = {
  '107-1/у': parseFormSchema(f107),
  '148-1/у-88': parseFormSchema(f88),
  '148-1/у-04(л)': parseFormSchema(f04l),
};

const profile: PatientProfile = {
  id: 'p1',
  displayName: 'Тестовый пациент',
  fullName: 'Иванов Иван Иванович',
  birthDate: '1980-03-04T00:00:00.000Z',
  biologicalSex: 'male',
  snils: '123-456-789 01',
  address: { subject: 'Московская область', locality: 'Химки', street: 'Ленина', house: '5' },
  omsPolicy: { number: '7700000000000001' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const episode = {
  id: 'e1',
  patientId: 'p1',
  status: 'open',
  startedAt: '2026-10-01T00:00:00.000Z',
  diagnosis: { text: 'Бронхиальная астма', icd10: 'J45.0' },
} as unknown as ClinicalEpisode;
const clinician = {
  clinicianFullName: 'Сидорова Мария Петровна',
  clinicianPosition: 'врач-терапевт',
  organizationName: 'ГБУЗ «Поликлиника № 1»',
  organizationAddress: 'г. Москва, ул. Тверская, д. 1',
  ogrn: '1027700132195',
};

function prefilled(schema: FormSchema): Record<string, unknown> {
  const context = buildFormPrefillContext({
    profile,
    episode,
    clinician,
    now: new Date('2026-10-05T12:00:00'),
  });
  return prefillFormValues(schema, context).values;
}

describe('prescription blanks of order 1094н', () => {
  it('parses the three schemas of the order with the pages of the blank', () => {
    expect(Object.keys(schemas)).toHaveLength(3);
    for (const schema of Object.values(schemas)) {
      expect(schema.source.orderNumber).toBe('1094н');
      expect(schema.source.effectiveUntil).toBe('2028-03-01');
      expect(schema.layout.blocks.filter((block) => block.pageBreakBefore)).toHaveLength(1);
    }
  });

  it('fills the surname with initials, the birth date and today from the patient and the doctor', () => {
    for (const schema of Object.values(schemas)) {
      const values = prefilled(schema);
      expect(values['patientFullName']).toBe('Иванов И.И.');
      expect(values['doctorFullName']).toBe('Сидорова М.П.');
      expect(values['patientBirthDate']).toBe('1980-03-04');
      expect(values['recipeDate']).toBe('2026-10-05');
    }
    expect(prefilled(schemas['107-1/у'] as FormSchema)['organizationStamp']).toBe(
      'ГБУЗ «Поликлиника № 1», г. Москва, ул. Тверская, д. 1',
    );
    const talon = prefilled(schemas['148-1/у-04(л)'] as FormSchema);
    expect(talon['nosologyCode']).toBe('J45.0');
    expect(talon['snils']).toBe('123-456-789 01');
    expect(talon['omsPolicyNumber']).toBe('7700000000000001');
    expect(talon['organizationCode']).toBe('1027700132195');
    expect(prefilled(schemas['148-1/у-88'] as FormSchema)['addressOrCard']).toBe(
      'Московская область, Химки, Ленина, 5',
    );
  });

  it('prints the Latin captions of the blanks as in the order', () => {
    const rp = renderFormPrintHtml(schemas['107-1/у'] as FormSchema, {});
    expect(rp).toContain('руб.|коп.| Rp.');
    const talon = renderFormPrintHtml(schemas['148-1/у-04(л)'] as FormSchema, {});
    expect(talon).toContain('D.t.d.');
    expect(talon).toContain('Signa:');
    expect(talon).toContain('Rp:');
    expect(talon).toContain('Министерство здравоохранения');
    expect(talon).toContain('&lt;*&gt; В случае изготовления рецептурного бланка');
  });

  it('writes digits of the talon into ruled cells and underlines the picked choice', () => {
    const talon = schemas['148-1/у-04(л)'] as FormSchema;
    const html = renderFormPrintHtml(talon, {
      ...prefilled(talon),
      fundingSource: ['2'],
      paymentPercent: ['1'],
      validity: ['30'],
    });
    expect(html.match(/form-print__charcell[ "]/gu)?.length).toBeGreaterThan(80);
    expect(html).toContain('form-print__option form-print__option--underlined">2. Бюджет субъекта');
    expect(html).toContain('form-print__option form-print__option--underlined">1. Бесплатно');
    expect(html).toContain('form-print__option form-print__option--underlined">30 дней');
    expect(html).toContain('>J</span>');
    // SNILS: only the digits fill the cells, the separators do not
    expect(html).not.toContain('>-</span>');
  });

  it('cites the paragraph with the appendix it stands in', () => {
    const schema = schemas['107-1/у'] as FormSchema;
    const validity = schema.fields.find((field) => field.id === 'validity');
    const paragraph = schema.rules.find((rule) => rule.id === validity?.rule.paragraphIds[0]);
    if (!paragraph) throw new Error('paragraph missing');
    expect(ruleCitation(schema, paragraph)).toContain(
      'Порядок назначения лекарственных препаратов (приложение № 1 к приказу № 1094н), п. 23;',
    );
    const name = schema.rules.find((rule) => rule.id === '3.6');
    if (!name) throw new Error('paragraph missing');
    expect(ruleCitation(schema, name)).toContain(
      'Порядок оформления рецептурных бланков на лекарственные препараты (приложение № 3 к приказу № 1094н), п. 6;',
    );
  });
});
