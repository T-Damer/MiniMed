import { describe, expect, it } from 'vitest';

import {
  applyDiagnosisDraft,
  applyFormDraft,
  diagnosisFromDraft,
  diagnosisToDraft,
  draftsEqual,
  draftToPatch,
  parseDiagnosisDraft,
  parseFormDraft,
  parseNewPatientDraft,
  profileToDraft,
  serializeDiagnosisDraft,
  serializeFormDraft,
  serializeNewPatientDraft,
} from '@/features/notes/patient-form-data';
import {
  appendEpisode,
  createClinicalEpisode,
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
    expect(result.errors).toEqual({});
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
    expect(ok.patch.snils).toBe('123-456-789 01');
    const bad = draftToPatch({ ...emptyDraft(), snils: '123' });
    expect(bad.errors.snils).toMatch(/СНИЛС/u);
    // The invalid group is left out of the patch; the rest is still saved as typed.
    expect(bad.patch).not.toHaveProperty('snils');
    expect(bad.patch).toHaveProperty('fullName');
  });

  it('requires a policy number when other policy fields are set', () => {
    const bad = draftToPatch({ ...emptyDraft(), omsInsurer: 'СК' });
    expect(bad.errors.omsNumber).toMatch(/номер полиса/u);
    expect(bad.patch).not.toHaveProperty('omsPolicy');
    const empty = draftToPatch(emptyDraft());
    expect(empty.patch.omsPolicy).toBeUndefined();
    expect(empty.patch).toHaveProperty('omsPolicy');
  });

  it('applies the valid part of a draft and keeps the stored value of an invalid group', () => {
    const profile = createPatientProfile({
      id: 'p1',
      displayName: 'Пациент',
      snils: '123-456-789 01',
      workplace: 'Школа',
    }).profile;
    const base = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    const typed = { ...profileToDraft(profile), snils: '123-4', workplace: 'Лицей 5' };
    const { snapshot, errors } = applyFormDraft(base, 'p1', typed);
    expect(errors.snils).toMatch(/СНИЛС/u);
    expect(snapshot.profiles[0]).toMatchObject({ snils: '123-456-789 01', workplace: 'Лицей 5' });
  });

  it('returns the same snapshot when the draft changes nothing', () => {
    const profile = createPatientProfile({
      id: 'p1',
      displayName: 'Пациент',
      fullName: 'Иванов Иван',
    }).profile;
    const base = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    expect(applyFormDraft(base, 'p1', profileToDraft(profile)).snapshot).toBe(base);
    // Only an invalid group differs: nothing is written either.
    const invalidOnly = { ...profileToDraft(profile), snils: 'abc' };
    expect(applyFormDraft(base, 'p1', invalidOnly).snapshot).toBe(base);
    expect(() => applyFormDraft(base, 'missing', profileToDraft(profile))).toThrow(/не найден/u);
  });

  it('round-trips a draft through its sealed text and refuses anything else', () => {
    const draft = {
      ...emptyDraft(),
      snils: '12',
      address: { ...emptyDraft().address, street: 'Ленина' },
    };
    expect(parseFormDraft(serializeFormDraft(draft))).toEqual(draft);
    expect(parseFormDraft('не json')).toBeUndefined();
    expect(parseFormDraft('{"fullName":1}')).toBeUndefined();
    expect(parseFormDraft(JSON.stringify({ ...draft, address: { street: 1 } }))).toBeUndefined();
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

describe('new patient draft', () => {
  const typed = {
    name: 'Анна',
    recordNumber: '',
    birthDate: '2020-01-02',
    sex: 'female',
    weight: '12.5',
    height: '',
  };

  it('round-trips the typed fields and treats an untouched or foreign text as no draft', () => {
    expect(parseNewPatientDraft(serializeNewPatientDraft(typed))).toEqual(typed);
    expect(
      parseNewPatientDraft(
        serializeNewPatientDraft({ ...typed, name: '', birthDate: '', sex: '', weight: '' }),
      ),
    ).toBeUndefined();
    expect(parseNewPatientDraft('не json')).toBeUndefined();
    expect(parseNewPatientDraft('{"name":1}')).toBeUndefined();
  });
});

describe('episode diagnosis draft applied to a visit', () => {
  const base = () => {
    const profile = createPatientProfile({ id: 'p1', displayName: 'Пациент' }).profile;
    const episode = createClinicalEpisode({
      patientId: 'p1',
      startedAt: '2026-10-14T10:00:00.000Z',
    });
    return {
      episodeId: episode.id,
      snapshot: appendEpisode({ ...emptyPatientVaultSnapshot(), profiles: [profile] }, episode),
    };
  };

  it('stores a well-formed diagnosis and is a no-op for the same one', () => {
    const { snapshot, episodeId } = base();
    const applied = applyDiagnosisDraft(snapshot, episodeId, ' Астма ', 'j45.0');
    expect(applied.errors).toEqual({});
    expect(applied.snapshot.episodes[0]?.diagnosis).toEqual({ text: 'Астма', icd10: 'J45.0' });
    expect(applyDiagnosisDraft(applied.snapshot, episodeId, 'Астма', 'J45.0').snapshot).toBe(
      applied.snapshot,
    );
  });

  it('leaves the stored diagnosis alone while the code or the wording is invalid', () => {
    const { snapshot, episodeId } = base();
    const stored = applyDiagnosisDraft(snapshot, episodeId, 'Астма', 'J45.0').snapshot;
    const badCode = applyDiagnosisDraft(stored, episodeId, 'Бронхит', 'J4');
    expect(badCode.errors.icd10).toMatch(/МКБ-10/u);
    expect(badCode.snapshot).toBe(stored);
    const noText = applyDiagnosisDraft(stored, episodeId, '', 'J45.0');
    expect(noText.errors.text).toMatch(/формулировку/u);
    expect(noText.snapshot).toBe(stored);
    // Emptying both fields clears the diagnosis.
    expect(applyDiagnosisDraft(stored, episodeId, '', '').snapshot.episodes[0]).not.toHaveProperty(
      'diagnosis',
    );
    expect(() => applyDiagnosisDraft(stored, 'missing', 'А', '')).toThrow(/не найден/u);
  });

  it('round-trips the typed pair through its sealed text', () => {
    expect(parseDiagnosisDraft(serializeDiagnosisDraft('Астма', 'J4'))).toEqual({
      text: 'Астма',
      icd10: 'J4',
    });
    expect(parseDiagnosisDraft('{"text":1,"icd10":""}')).toBeUndefined();
    expect(parseDiagnosisDraft('х')).toBeUndefined();
  });
});
