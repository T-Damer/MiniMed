import { expect, it } from 'vitest';
import {
  createPatientProfile,
  emptyPatientVaultSnapshot,
  normalizePatientVaultSnapshot,
} from './patient-domain';
import { normalizePatientAvatar, patientInitials } from './patientAvatar';

it('round-trips a patient symbol and rejects remote or executable avatar payloads', () => {
  const profile = createPatientProfile({
    displayName: 'Тест',
    avatar: { kind: 'symbol', value: '👩‍⚕️' },
  }).profile;
  const snapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
  expect(normalizePatientVaultSnapshot(snapshot).profiles[0]?.avatar).toEqual(profile.avatar);
  expect(
    normalizePatientAvatar({ kind: 'photo', value: 'data:image/jpeg;base64,/9j/2Q==' }).kind,
  ).toBe('photo');
  for (const avatar of [
    { kind: 'symbol', value: 'AB' },
    { kind: 'photo', value: 'https://example.com/photo.jpg' },
    { kind: 'photo', value: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { kind: 'photo', value: `data:image/jpeg;base64,${'A'.repeat(128 * 1024)}` },
  ]) {
    expect(() =>
      normalizePatientVaultSnapshot({ ...snapshot, profiles: [{ ...profile, avatar }] }),
    ).toThrow();
  }
});

it('derives initials from the patient name without a separate stored value', () => {
  expect(patientInitials('  Иванов   Иван Иванович ')).toBe('ИИ');
  expect(patientInitials('Анна')).toBe('А');
  expect(patientInitials('')).toBe('');
});
