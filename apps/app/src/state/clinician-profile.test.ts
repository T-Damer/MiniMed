import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLINICIAN_PROFILE_KEY,
  getClinicianProfile,
  normalizeClinicianProfile,
  setClinicianProfile,
  subscribeClinicianProfile,
  validateOgrn,
} from '@/state/clinician-profile';

const VALID_OGRN = '1027700132195';

function installWindowMock(options: { readonly failWrites?: boolean } = {}): Map<string, string> {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<(event: Event) => void>>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.failWrites) throw new Error('quota');
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const bucket = listeners.get(type) ?? new Set<(event: Event) => void>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
  });
  return store;
}

describe('validateOgrn', () => {
  it('accepts an empty value and valid 13- and 15-digit numbers', () => {
    expect(validateOgrn(undefined)).toBeUndefined();
    expect(validateOgrn('  ')).toBeUndefined();
    expect(validateOgrn(VALID_OGRN)).toBeUndefined();
    expect(validateOgrn('304012345000011')).toBeUndefined();
  });

  it('rejects wrong length, non-digits and a wrong control digit', () => {
    expect(validateOgrn('12345')).toMatch(/13 цифр/u);
    expect(validateOgrn('10277001321a5')).toMatch(/цифр/u);
    expect(validateOgrn('1027700132196')).toMatch(/Контрольная цифра/u);
    expect(validateOgrn('304012345000010')).toMatch(/Контрольная цифра/u);
  });
});

describe('clinician profile', () => {
  beforeEach(() => {
    installWindowMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalises unknown input to a clean profile', () => {
    expect(normalizeClinicianProfile(null)).toEqual({});
    expect(normalizeClinicianProfile([])).toEqual({});
    expect(
      normalizeClinicianProfile({
        organizationName: '  ГБУЗ «Поликлиника»  ',
        organizationAddress: '   ',
        ogrn: VALID_OGRN,
        clinicianFullName: 5,
        clinicianPosition: 'Терапевт',
        extra: 'drop me',
      }),
    ).toEqual({
      organizationName: 'ГБУЗ «Поликлиника»',
      ogrn: VALID_OGRN,
      clinicianPosition: 'Терапевт',
    });
    expect(normalizeClinicianProfile({ ogrn: '123' })).toEqual({});
  });

  it('merges patches, removes emptied fields and persists under the versioned key', () => {
    const store = installWindowMock();
    expect(getClinicianProfile()).toEqual({});
    setClinicianProfile({ organizationName: 'Клиника', clinicianFullName: 'Петров П. П.' });
    const next = setClinicianProfile({ clinicianFullName: '', ogrn: VALID_OGRN });
    expect(next).toEqual({ organizationName: 'Клиника', ogrn: VALID_OGRN });
    expect(JSON.parse(store.get(CLINICIAN_PROFILE_KEY) ?? 'null')).toEqual(next);
    expect(getClinicianProfile()).toEqual(next);
  });

  it('refuses an invalid ОГРН without writing', () => {
    const store = installWindowMock();
    expect(() => setClinicianProfile({ ogrn: '1027700132196' })).toThrow(/Контрольная/u);
    expect(store.has(CLINICIAN_PROFILE_KEY)).toBe(false);
  });

  it('degrades to an empty profile when storage is unreadable or unwritable', () => {
    const store = installWindowMock({ failWrites: true });
    store.set(CLINICIAN_PROFILE_KEY, '{broken');
    expect(getClinicianProfile()).toEqual({});
    expect(setClinicianProfile({ organizationName: 'Клиника' })).toEqual({
      organizationName: 'Клиника',
    });
  });

  it('notifies subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeClinicianProfile(listener);
    setClinicianProfile({ organizationName: 'Клиника' });
    expect(listener).toHaveBeenCalledWith({ organizationName: 'Клиника' });
    unsubscribe();
    setClinicianProfile({ organizationName: 'Другая' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
