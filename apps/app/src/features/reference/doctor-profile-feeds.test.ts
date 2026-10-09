import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCTOR_PROFILE_KEY,
  EMPTY_DOCTOR_PROFILE,
  getDoctorProfile,
  resetDoctorProfile,
} from './doctor-profile';
import {
  doctorProfileSummary,
  fieldsForSpecialtySlugs,
  noteRecommendationOpened,
  noteSectionsInstalled,
  RECOMMENDATION_OPENED_WEIGHT,
  resetFedRecommendations,
  SECTION_INSTALLED_WEIGHT,
  topProfileFields,
} from './doctor-profile-feeds';
import { fieldForSpecialtySlug, fieldsForSpecialty } from './medical-fields';

const LABELS: Readonly<Record<string, string>> = {
  otorhinolaryngology: 'Оториноларингология',
  gynecology: 'Акушерство и гинекология',
  prevention: 'Профилактика',
};
const labelOf = (slug: string): string => LABELS[slug] ?? slug;

function installWindowMock(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return store;
}

describe('medical field lookup', () => {
  it('reads catalogue slugs by their words', () => {
    expect(fieldForSpecialtySlug('child-psychiatry')).toBe('psychiatry');
    expect(fieldForSpecialtySlug('infectious-diseases')).toBe('infectious');
    expect(fieldForSpecialtySlug('prevention')).toBeUndefined();
  });

  it('lists every field a section title mentions', () => {
    expect(fieldsForSpecialty('Гематология и онкология')).toEqual(['hematology', 'oncology']);
    expect(fieldsForSpecialty('Терапия')).toEqual([]);
  });

  it('falls back to the Russian label when the slug is not a field id', () => {
    expect(fieldsForSpecialtySlugs(['otorhinolaryngology', 'prevention'], labelOf)).toEqual([
      'otolaryngology',
    ]);
    expect(fieldsForSpecialtySlugs(['gynecology', 'obstetrics'], labelOf)).toEqual([
      'gynecology',
      'obstetrics',
    ]);
  });
});

describe('doctor profile feeds', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installWindowMock();
    resetFedRecommendations();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('learns the specialty of an opened recommendation with a small weight', () => {
    noteRecommendationOpened(
      { id: 'kr-1', sourceType: 'clinical_recommendation_summary', specialties: ['psychiatry'] },
      labelOf,
    );
    expect(getDoctorProfile().fields['psychiatry']).toBeCloseTo(RECOMMENDATION_OPENED_WEIGHT);
  });

  it('counts a recommendation once per session and ignores other documents', () => {
    const kr = {
      id: 'kr-2',
      sourceType: 'clinical_recommendation',
      specialties: ['neurology'],
    } as const;
    noteRecommendationOpened(kr, labelOf);
    noteRecommendationOpened(kr, labelOf);
    expect(getDoctorProfile().fields['neurology']).toBeCloseTo(RECOMMENDATION_OPENED_WEIGHT);
    noteRecommendationOpened(
      { id: 'drug-1', sourceType: 'drug_instruction', specialties: ['cardiology'] },
      labelOf,
    );
    noteRecommendationOpened(
      { id: 'kr-3', sourceType: 'clinical_recommendation', specialties: ['prevention'] },
      labelOf,
    );
    expect(Object.keys(getDoctorProfile().fields)).toEqual(['neurology']);
  });

  it('splits the weight of a recommendation across at most two fields', () => {
    noteRecommendationOpened(
      {
        id: 'kr-4',
        sourceType: 'clinical_recommendation',
        specialties: ['cardiology', 'nephrology', 'urology'],
      },
      labelOf,
    );
    const { fields } = getDoctorProfile();
    expect(Object.keys(fields).toSorted()).toEqual(['cardiology', 'nephrology']);
    expect(fields['cardiology']).toBeCloseTo(RECOMMENDATION_OPENED_WEIGHT / 2, 1);
  });

  it('learns from installed sections', () => {
    noteSectionsInstalled(['Психиатрия и наркология', 'Терапия']);
    const profile = getDoctorProfile();
    expect(topProfileFields(profile, 3)).toEqual(['psychiatry', 'narcology']);
    expect(profile.fields['psychiatry'] ?? 0).toBeGreaterThan(0);
    expect(profile.fields['psychiatry'] ?? 0).toBeLessThanOrEqual(SECTION_INSTALLED_WEIGHT);
  });

  it('forgets everything on reset', () => {
    noteSectionsInstalled(['Неврология']);
    expect(store.has(DOCTOR_PROFILE_KEY)).toBe(true);
    resetDoctorProfile();
    expect(getDoctorProfile()).toEqual(EMPTY_DOCTOR_PROFILE);
    expect(store.has(DOCTOR_PROFILE_KEY)).toBe(false);
  });

  it('lists the heaviest fields first', () => {
    noteSectionsInstalled(['Кардиология']);
    noteSectionsInstalled(['Кардиология']);
    noteSectionsInstalled(['Урология']);
    expect(topProfileFields(getDoctorProfile(), 1)).toEqual(['cardiology']);
  });

  it('summarises the profile for the settings row', () => {
    expect(doctorProfileSummary(EMPTY_DOCTOR_PROFILE)).toBe('Профиль врача: пока пуст');
    expect(doctorProfileSummary({ version: 1, fields: { psychiatry: 3, neurology: 2 } })).toBe(
      'Профиль врача: психиатрия, неврология',
    );
    expect(
      doctorProfileSummary({
        version: 1,
        fields: { psychiatry: 4, neurology: 3, cardiology: 2, oncology: 1 },
      }),
    ).toBe('Профиль врача: психиатрия, неврология, кардиология…');
  });
});
