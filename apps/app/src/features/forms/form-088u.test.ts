import { type FormSchema, parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { buildFormPrefillContext, prefillFormValues } from '@/features/forms/form-prefill';
import { renderFormPrintHtml } from '@/features/forms/form-print';
import raw from '@/features/forms/schemas/ru-mintrud-minzdrav-488n-551n-088u.json';

// The schema is registered in form-registry by the coordinator; this test reads the file itself.
const form: FormSchema = parseFormSchema(raw);

describe('form 088/у (joint order 488н/551н)', () => {
  it('validates against the contract and carries the joint issuer', () => {
    expect(form.formNumber).toBe('088/у');
    expect(form.source.issuer).toContain('Министерство труда и социальной защиты');
    expect(form.source.issuer).toContain('Министерство здравоохранения');
    expect(form.source.registration.number).toBe('70900');
    expect(form.fields.length).toBeGreaterThan(200);
    expect(form.layout.blocks.filter((block) => block.pageBreakBefore)).toHaveLength(12);
  });

  it('prefills the sex boxes, the address, the diagnosis and the date from the patient data', () => {
    const context = buildFormPrefillContext({
      profile: {
        id: 'p1',
        displayName: 'Т',
        fullName: 'Иванова Мария Петровна',
        birthDate: '1980-03-04T00:00:00.000Z',
        biologicalSex: 'female',
        address: { subject: 'Тверская область', locality: 'Тверь', house: '5', building: '2' },
        workplace: 'ООО «Тест»',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      episode: {
        id: 'e1',
        patientId: 'p1',
        title: 'Осмотр',
        startedAt: '2026-10-01T00:00:00.000Z',
        text: '',
        eventIds: [],
        status: 'open',
        diagnosis: { text: 'Бронхиальная астма', icd10: 'J45.0' },
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      now: new Date('2026-10-05T10:00:00'),
    });
    const { values } = prefillFormValues(form, context);
    expect(values['sexFemale']).toBe(true);
    expect(values['sexMale']).toBeUndefined();
    expect(values['patientFullName']).toBe('Иванова Мария Петровна');
    expect(values['residenceHouse']).toBe('5, 2');
    expect(values['workPlace']).toBe('ООО «Тест»');
    expect(values['diagnosisMainIcd']).toBe('J45.0');
    expect(values['fillDate']).toBe('2026-10-05');
    // not stored by the app: left for the commission
    expect(values['citizenshipRussian']).toBeUndefined();
    expect(values['commissionChairName']).toBeUndefined();
  });

  it('prints ticked boxes inside the table cells and the underlined prognosis words', () => {
    const html = renderFormPrintHtml(form, {
      sexFemale: true,
      purposeDisabilityGroup: true,
      clinicalPrognosis: ['2'],
      patientFullName: 'Иванова Мария Петровна',
      tempDisability1Start: '2026-02-03',
    });
    expect(html).toContain('form-print__cell-flow');
    expect(html).toContain('Женский');
    expect(html.match(/form-print__check--in-cell[^>]*>✓</gu)).toHaveLength(2);
    expect(html).toContain('form-print__option--underlined">относительно благоприятный');
    expect(html).not.toContain('form-print__option--underlined">благоприятный');
    expect(html).toContain('Иванова Мария Петровна');
    expect(html).toContain('03.02.2026');
    // each of the 13 sheets starts a new page, as the official blank does
    expect(html.match(/<section class="[^"]*form-print__block--page-break/gu)).toHaveLength(12);
  });
});
