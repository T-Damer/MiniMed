import { describe, expect, it } from 'vitest';

import { formatPatientAge, patientAgeMismatch } from '@/features/tools/patient-age-notice';

const adults = { groups: ['adults' as const], basis: 'Тест' };
const schwartz = {
  groups: ['children' as const],
  minAge: { value: 1, unit: 'years' as const },
  maxAge: { value: 16, unit: 'years' as const },
  basis: 'Тест',
};

describe('patient age notice', () => {
  it('stays silent when the patient fits the tool or the age is unknown', () => {
    expect(patientAgeMismatch(adults, '1980-05-01', '2026-10-05')).toBeUndefined();
    expect(patientAgeMismatch(schwartz, '2018-05-01', '2026-10-05')).toBeUndefined();
    expect(patientAgeMismatch(adults, undefined, '2026-10-05')).toBeUndefined();
    expect(patientAgeMismatch(adults, '2030-01-01', '2026-10-05')).toBeUndefined();
  });

  it('names the group of the tool and the age of the patient when they differ', () => {
    expect(patientAgeMismatch(adults, '2021-01-01', '2026-10-05')).toBe(
      'Инструмент рассчитан на другую группу: взрослые. Возраст пациента — 5 лет.',
    );
    expect(patientAgeMismatch(schwartz, '2026-03-01', '2026-10-05')).toBe(
      'Инструмент рассчитан на другую группу: дети 1–16 лет. Возраст пациента — 7 мес.',
    );
  });

  it('says the age the way a doctor does', () => {
    expect(formatPatientAge(10)).toBe('10 дней');
    expect(formatPatientAge(21)).toBe('21 день');
    expect(formatPatientAge(200)).toBe('6 мес.');
    expect(formatPatientAge(366 * 3)).toBe('3 года');
    expect(formatPatientAge(366 * 11)).toBe('11 лет');
  });
});
