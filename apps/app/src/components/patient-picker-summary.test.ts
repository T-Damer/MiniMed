import { describe, expect, it } from 'vitest';

import { patientBirthDateText, patientRowSummary } from '@/components/patient-picker-summary';

describe('second line of a chosen patient', () => {
  it('writes the birth date the Russian way', () => {
    expect(patientBirthDateText('1980-03-04')).toBe('04.03.1980');
    expect(patientBirthDateText('1980-03-04T00:00:00Z')).toBe('04.03.1980');
    expect(patientBirthDateText('unknown')).toBe('unknown');
  });

  it('adds the age the way a doctor says it', () => {
    expect(patientRowSummary('1980-03-04', '2026-10-08')).toBe('04.03.1980 · 46 лет');
    expect(patientRowSummary('2021-10-08', '2026-10-08')).toBe('08.10.2021 · 5 лет');
    expect(patientRowSummary('2026-01-08', '2026-10-08')).toBe('08.01.2026 · 9 мес.');
    expect(patientRowSummary('2025-07-08', '2026-10-08')).toBe('08.07.2025 · 15 мес.');
    expect(patientRowSummary('2026-10-01', '2026-10-08')).toBe('01.10.2026 · 7 дн.');
    expect(patientRowSummary('2024-10-08', '2026-10-08')).toBe('08.10.2024 · 2 года');
  });

  it('shows only the date for a date in the future and nothing without one', () => {
    expect(patientRowSummary('2030-01-01', '2026-10-08')).toBe('01.01.2030');
    expect(patientRowSummary(undefined, '2026-10-08')).toBeUndefined();
    expect(patientRowSummary('', '2026-10-08')).toBeUndefined();
  });
});
