import { describe, expect, it } from 'vitest';

import {
  diagnosisFromDraft,
  diagnosisToDraft,
  draftsEqual,
  draftToPatch,
  profileToDraft,
} from '@/features/notes/patient-form-data';
import {
  createPatientProfile,
  emptyPatientVaultSnapshot,
  updatePatientProfileData,
} from '@/state/patient-domain';

function emptyDraft() {
  return profileToDraft(createPatientProfile({ displayName: 'Пациент' }).profile);
}

describe('patient form data draft', () => {
  it('round-trips a stored profile through the draft', () => {
    const profile = createPatientProfile({
      id: 'p1',
      displayName: 'Пациент',
      fullName: 'Иванов Иван',
      snils: '123-456-789 01',
      omsPolicy: { number: '77', issuedAt: '2020-01-02', insurer: 'СК' },
      address: { locality: 'Москва', house: '5' },
    }).profile;
    const draft = profileToDraft(profile);
    expect(draft.omsIssuedAt).toBe('2020-01-02');
    expect(draft.address.locality).toBe('Москва');
    expect(draft.address.street).toBe('');
    expect(draft.stayAddress.phone).toBe('');
    const result = draftToPatch(draft);
    if (!result.patch) throw new Error('expected a patch');
    const base = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    const updated = updatePatientProfileData(base, 'p1', result.patch);
    expect(updated.profiles[0]).toMatchObject({
      fullName: 'Иванов Иван',
      snils: '123-456-789 01',
      omsPolicy: { number: '77', issuedAt: '2020-01-02', insurer: 'СК' },
      address: { locality: 'Москва', house: '5' },
    });
    expect(updated.profiles[0]).not.toHaveProperty('stayAddress');
    expect(draftsEqual(draft, profileToDraft(updated.profiles[0] ?? profile))).toBe(true);
  });

  it('normalises 11-digit SNILS and flags a malformed one', () => {
    const ok = draftToPatch({ ...emptyDraft(), snils: '12345678901' });
    expect(ok.patch?.snils).toBe('123-456-789 01');
    const bad = draftToPatch({ ...emptyDraft(), snils: '123' });
    expect(bad.errors?.snils).toMatch(/СНИЛС/u);
    expect(bad.patch).toBeUndefined();
  });

  it('requires a policy number when other policy fields are set', () => {
    const bad = draftToPatch({ ...emptyDraft(), omsInsurer: 'СК' });
    expect(bad.errors?.omsNumber).toMatch(/номер полиса/u);
    const empty = draftToPatch(emptyDraft());
    expect(empty.patch?.omsPolicy).toBeUndefined();
  });
});

describe('episode diagnosis draft', () => {
  it('normalises the code, clears on empty input and rejects bad input', () => {
    expect(diagnosisFromDraft(' Астма ', 'j45.0').diagnosis).toEqual({
      text: 'Астма',
      icd10: 'J45.0',
    });
    expect(diagnosisFromDraft('Астма', '').diagnosis).toEqual({ text: 'Астма' });
    expect(diagnosisFromDraft('', '').diagnosis).toBeUndefined();
    expect(diagnosisFromDraft('', '').errors).toBeUndefined();
    expect(diagnosisFromDraft('Астма', '45').errors?.icd10).toMatch(/МКБ-10/u);
    expect(diagnosisFromDraft('', 'J45').errors?.text).toMatch(/формулировку/u);
    expect(diagnosisToDraft(undefined)).toEqual({ text: '', icd10: '' });
  });
});
