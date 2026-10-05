import { describe, expect, it } from 'vitest';

import {
  buildFormPrefillContext,
  localIsoDate,
  prefillFormValues,
} from '@/features/forms/form-prefill';
import { findFormSchema } from '@/features/forms/form-registry';
import type { ClinicalEpisode, PatientProfile } from '@/state/patient-domain';

const form = (() => {
  const schema = findFormSchema('ru.minzdrav.274n.070u');
  if (!schema) throw new Error('schema missing');
  return schema;
})();

const profile: PatientProfile = {
  id: 'p1',
  displayName: 'Тестовый пациент',
  fullName: 'Иванов Иван Иванович',
  birthDate: '1980-03-04T00:00:00.000Z',
  biologicalSex: 'male',
  snils: '123-456-789 01',
  workplace: 'ООО «Тест»',
  address: { subject: 'Московская область', locality: 'Химки', street: 'Ленина', house: '5' },
  omsPolicy: { number: '7700000000000001', issuedAt: '2020-01-15', insurer: 'СМО «Тест»' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const episode: ClinicalEpisode = {
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
};

const clinician = {
  organizationName: 'ГБУЗ «Поликлиника № 1»',
  organizationAddress: 'г. Москва, ул. Тестовая, 1',
  ogrn: '1027700132195',
  clinicianFullName: 'Петров Пётр Петрович',
  clinicianPosition: 'врач-терапевт',
};

describe('form prefill', () => {
  const now = new Date(2026, 9, 5, 12);

  it('formats today in the local calendar', () => {
    expect(localIsoDate(now)).toBe('2026-10-05');
  });

  it('fills the declared bindings from patient, episode, clinician and today', () => {
    const context = buildFormPrefillContext({ profile, episode, clinician, now });
    const { values, prefilled } = prefillFormValues(form, context);
    expect(values['patientFullName']).toBe('Иванов Иван Иванович');
    expect(values['patientBirthDate']).toBe('1980-03-04');
    expect(values['patientSex']).toBe('1');
    expect(values['residenceLocality']).toBe('Химки');
    expect(values['omsPolicyIssueDate']).toBe('2020-01-15');
    expect(values['diagnosisIcd']).toBe('J45.0');
    expect(values['organization']).toBe('ГБУЗ «Поликлиника № 1», г. Москва, ул. Тестовая, 1');
    expect(values['organizationOgrn']).toBe('1027700132195');
    expect(values['attendingDoctor']).toBe('врач-терапевт Петров Пётр Петрович');
    expect(values['formDate']).toBe('2026-10-05');
    expect(prefilled.has('patientSex')).toBe(true);
  });

  it('leaves unknown values empty instead of inventing them', () => {
    const { snils: _snils, ...withoutSnils } = profile;
    const context = buildFormPrefillContext({
      profile: { ...withoutSnils, biologicalSex: 'intersex' },
      now,
    });
    const { values, prefilled } = prefillFormValues(form, context);
    expect(values['patientSex']).toBeUndefined();
    expect(values['snils']).toBeUndefined();
    expect(values['organization']).toBeUndefined();
    expect(values['diagnosis']).toBeUndefined();
    expect(prefilled.has('snils')).toBe(false);
    // Only the date is known without a patient or clinician.
    expect(Object.keys(prefillFormValues(form, buildFormPrefillContext({ now })).values)).toEqual([
      'formDate',
    ]);
  });

  it('does not prefill a signature, a stamp or a code the schema does not list', () => {
    const context = buildFormPrefillContext({ profile, episode, clinician, now });
    const { values } = prefillFormValues(form, context);
    for (const field of form.fields.filter((f) => f.type === 'signature' || f.type === 'stamp')) {
      expect(values[field.id]).toBeUndefined();
    }
    const unknownSex = prefillFormValues(
      form,
      buildFormPrefillContext({ profile: { ...profile, biologicalSex: 'female' }, now }),
    );
    expect(unknownSex.values['patientSex']).toBe('2');
  });
});
