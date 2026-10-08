import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCTOR_PROFILE_KEY,
  EMPTY_DOCTOR_PROFILE,
  getDoctorProfile,
  leadingField,
  normalizeDoctorProfile,
  noteDoctorField,
  profileInterest,
  resetDoctorProfile,
  subscribeDoctorProfile,
  withSignal,
} from './doctor-profile';
import { fieldForSpecialty } from './medical-fields';

describe('doctor profile model', () => {
  it('is empty until the doctor does something', () => {
    expect(profileInterest(EMPTY_DOCTOR_PROFILE, 'psychiatry')).toBe(0);
    expect(leadingField(EMPTY_DOCTOR_PROFILE)).toBeUndefined();
  });

  it('grows with repeated signals and fades older interests', () => {
    let profile = EMPTY_DOCTOR_PROFILE;
    for (let index = 0; index < 6; index += 1) profile = withSignal(profile, 'cardiology');
    const before = profile.fields['cardiology'] ?? 0;
    profile = withSignal(profile, 'neurology');
    expect(profile.fields['cardiology']).toBeLessThan(before);
    expect(leadingField(profile)).toBe('cardiology');
    expect(profileInterest(profile, 'cardiology')).toBeGreaterThan(0.8);
    expect(profileInterest(profile, 'psychiatry')).toBe(0);
  });

  it('scales a thin profile down so one tap decides nothing', () => {
    const oneTap = withSignal(EMPTY_DOCTOR_PROFILE, 'psychiatry');
    expect(profileInterest(oneTap, 'psychiatry')).toBeLessThan(0.2);
  });

  it('ignores malformed fields and weights from storage', () => {
    expect(
      normalizeDoctorProfile({
        fields: { psychiatry: 2, 'Bad Id': 1, neurology: -1, oncology: 'x', ok: Number.NaN },
      }),
    ).toEqual({ version: 1, fields: { psychiatry: 2 } });
    expect(normalizeDoctorProfile('nope')).toEqual(EMPTY_DOCTOR_PROFILE);
  });

  it('recognises a field from a specialty name', () => {
    expect(fieldForSpecialty('Психиатр-нарколог')).toBe('psychiatry');
    expect(fieldForSpecialty('Кардиология')).toBe('cardiology');
    expect(fieldForSpecialty('Терапия')).toBeUndefined();
  });
});

function installWindowMock(): Map<string, string> {
  const store = new Map<string, string>();
  const listeners = new Set<(event: Event) => void>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) listener(event);
      return true;
    },
    addEventListener: (_type: string, listener: (event: Event) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: Event) => void) =>
      listeners.delete(listener),
  });
  return store;
}

describe('doctor profile storage', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installWindowMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists signals on this device, notifies listeners and resets completely', () => {
    const seen: number[] = [];
    const stop = subscribeDoctorProfile((profile) => seen.push(Object.keys(profile.fields).length));
    noteDoctorField('psychiatry');
    noteDoctorField('neurology', 2);
    expect(getDoctorProfile().fields['neurology']).toBe(2);
    expect(store.get(DOCTOR_PROFILE_KEY)).toContain('psychiatry');
    resetDoctorProfile();
    expect(getDoctorProfile()).toEqual(EMPTY_DOCTOR_PROFILE);
    expect(store.has(DOCTOR_PROFILE_KEY)).toBe(false);
    stop();
    noteDoctorField('oncology');
    expect(seen).toEqual([1, 2, 0]);
  });

  it('survives unreadable storage', () => {
    store.set(DOCTOR_PROFILE_KEY, '{broken');
    expect(getDoctorProfile()).toEqual(EMPTY_DOCTOR_PROFILE);
  });
});
