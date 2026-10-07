import { describe, expect, it } from 'vitest';

import {
  type ChildInput,
  childBirthDate,
  diarySubjectFor,
  needsBirthDateInCard,
} from '@/features/vaccination/vaccination-child';
import type { PatientProfile } from '@/state/patient-domain';

const PROFILE: PatientProfile = {
  id: 'patient-1',
  displayName: 'Аня',
  fullName: 'Иванова Анна',
  birthDate: '2025-03-15',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const BARE: PatientProfile = {
  id: 'patient-2',
  displayName: 'Миша',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function input(overrides: Partial<ChildInput>): ChildInput {
  return {
    mode: 'patient',
    profile: PROFILE,
    typedBirthDate: '',
    typedName: '',
    printName: true,
    ...overrides,
  };
}

describe('child of the vaccination plan', () => {
  it('takes the birth date and the full name from the card', () => {
    expect(diarySubjectFor(input({}))).toEqual({ name: 'Иванова Анна', birthDate: '2025-03-15' });
    expect(diarySubjectFor(input({ printName: false }))?.name).toBeNull();
  });

  it('prefers the card date over one typed beside it', () => {
    expect(childBirthDate(input({ typedBirthDate: '2020-01-01' }))).toBe('2025-03-15');
  });

  it('uses a typed date for a card without one, and says the card needs it', () => {
    const state = input({ profile: BARE, typedBirthDate: '2025-04-01' });
    expect(childBirthDate(state)).toBe('2025-04-01');
    expect(needsBirthDateInCard(state)).toBe(true);
    expect(needsBirthDateInCard(input({}))).toBe(false);
  });

  it('has no subject until a card is chosen in patient mode', () => {
    expect(diarySubjectFor(input({ profile: undefined }))).toBeNull();
  });

  it('calculates from a typed date alone, keeping the optional name for the sheet only', () => {
    const quick = input({ mode: 'quick', typedBirthDate: '2024-02-29', typedName: ' Миша ' });
    expect(diarySubjectFor(quick)).toEqual({ name: 'Миша', birthDate: '2024-02-29' });
    // The card of patient mode is ignored in quick mode.
    expect(childBirthDate({ ...quick, typedBirthDate: '' })).toBeNull();
  });

  it('rejects a date that is not on the calendar', () => {
    expect(childBirthDate(input({ mode: 'quick', typedBirthDate: '2025-02-30' }))).toBeNull();
  });
});
