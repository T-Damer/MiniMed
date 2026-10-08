import { describe, expect, it } from 'vitest';

import {
  type ChildInput,
  childBirthDate,
  handoutSubjectFor,
  hasChild,
  NO_CHILD,
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
  return { profile: PROFILE, typedBirthDate: '', ...overrides };
}

describe('child of the vaccination calendar', () => {
  it('takes the birth date and the full name from the card', () => {
    expect(handoutSubjectFor(input({}))).toEqual({ name: 'Иванова Анна', birthDate: '2025-03-15' });
    const { fullName: _fullName, ...withoutFullName } = PROFILE;
    expect(handoutSubjectFor(input({ profile: withoutFullName })).name).toBe('Аня');
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

  it('is nobody until a card or a valid date is given', () => {
    expect(hasChild(NO_CHILD)).toBe(false);
    expect(hasChild(input({ profile: undefined, typedBirthDate: '2025-02-30' }))).toBe(false);
    expect(hasChild(input({ profile: BARE }))).toBe(true);
    expect(hasChild(input({ profile: undefined, typedBirthDate: '2025-02-28' }))).toBe(true);
  });

  it('works from a typed date alone, with no name on the sheet', () => {
    const quick = input({ profile: undefined, typedBirthDate: '2024-02-29' });
    expect(handoutSubjectFor(quick)).toEqual({ name: null, birthDate: '2024-02-29' });
    expect(needsBirthDateInCard(quick)).toBe(false);
  });
});
