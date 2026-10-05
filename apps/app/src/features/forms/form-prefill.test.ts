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

  it('splits the full name into surname, name and patronymic by declared word bindings', () => {
    const talon = findFormSchema('ru.minzdrav.274n.025-1u');
    if (!talon) throw new Error('schema missing');
    const context = buildFormPrefillContext({
      profile: {
        ...profile,
        fullName: 'Иванов Иван Иванович оглы',
        workplace: 'ООО «Тест»',
        citizenship: 'Российская Федерация',
      },
      episode,
      clinician,
      now: new Date(2026, 9, 5),
    });
    const { values, prefilled } = prefillFormValues(talon, context);
    expect(values['surname']).toBe('Иванов');
    expect(values['firstName']).toBe('Иван');
    expect(values['patronymic']).toBe('Иванович оглы');
    expect(values['workplace']).toBe('ООО «Тест»');
    expect(values['citizenship']).toBe('Российская Федерация');
    expect(values['patientSex']).toBe('1');
    expect(values['prelimDiagnosisIcd']).toBe('J45.0');
    expect(values['openDate']).toBe('2026-10-05');
    expect(values['doctorPosition']).toBe('врач-терапевт');
    expect(prefilled.has('surname')).toBe(true);
    expect(values['visitDate1']).toBeUndefined();
  });

  it('leaves a name part empty when the full name has too few words', () => {
    const talon = findFormSchema('ru.minzdrav.274n.025-1u');
    if (!talon) throw new Error('schema missing');
    const context = buildFormPrefillContext({
      profile: { ...profile, fullName: 'Мононим' },
      now: new Date(2026, 9, 5),
    });
    const { values } = prefillFormValues(talon, context);
    expect(values['surname']).toBe('Мононим');
    expect(values['firstName']).toBeUndefined();
    expect(values['patronymic']).toBeUndefined();
  });

  it('fills the sanatorium cards: referral diagnosis, filler and the shared patient lines', () => {
    const card = findFormSchema('ru.minzdrav.274n.072u');
    if (!card) throw new Error('schema missing');
    const context = buildFormPrefillContext({
      profile,
      episode,
      clinician,
      now: new Date(2026, 9, 5),
    });
    const { values } = prefillFormValues(card, context);
    expect(values['mainDiagnosis']).toBe('Бронхиальная астма');
    expect(values['mainDiagnosisIcd']).toBe('J45.0');
    expect(values['referralMain']).toBe('Бронхиальная астма');
    expect(values['filledBy']).toBe('Петров Пётр Петрович');
    expect(values['residenceLocality']).toBe('Химки');
    expect(values['snils']).toBe('123-456-789 01');
    expect(values['treatmentDone']).toBeUndefined();
  });
  it('prefills the referral 057/у: policy, patient, address without a phone, diagnosis and the referring doctor', () => {
    const referral = findFormSchema('ru.minzdrav.519n.057u');
    if (!referral) throw new Error('schema missing');
    const context = buildFormPrefillContext({ profile, episode, clinician, now });
    const { values, prefilled } = prefillFormValues(referral, context);
    expect(values['formDate']).toBe('2026-10-05');
    expect(values['omsPolicyNumber']).toBe('7700000000000001');
    expect(values['omsPolicyIssueDate']).toBe('2020-01-15');
    expect(values['omsInsurer']).toBe('СМО «Тест»');
    expect(values['patientSex']).toBe('1');
    expect(values['residenceStreet']).toBe('Ленина');
    expect(values['diagnosis']).toBe('Бронхиальная астма, J45.0');
    expect(values['referrerPosition']).toBe('врач-терапевт');
    expect(values['referrerName']).toBe('Петров Пётр Петрович');
    // what the app does not store stays empty and is never invented
    for (const id of ['localityType', 'employment', 'purpose', 'justification', 'formNumber']) {
      expect(values[id]).toBeUndefined();
    }
    // paper-only fields are not bound
    expect(prefilled.has('referrerSignature')).toBe(false);
    expect(prefilled.has('stamp')).toBe(false);
  });
});
