import { describe, expect, it } from 'vitest';

import { parseAgeInput, restoredAgeText } from './prescription-age';
import { ageText } from './prescription-safety';

const DAY_MS = 86_400_000;

function patient(ageDays: number | null, ageInput?: string | null) {
  return {
    ageDays,
    ...(ageInput === undefined ? {} : { ageInput }),
    group: null,
    weightKg: null,
    heightCm: null,
    pregnant: false,
    lactating: false,
  };
}

describe('the age field after a reload', () => {
  it('shows the typed years of every child age 0-18 again', () => {
    for (let years = 1; years <= 18; years += 1) {
      for (const typed of [String(years), `${years} лет`, `${years} года`]) {
        const days = parseAgeInput(typed);
        expect(days, typed).not.toBeNull();
        expect(restoredAgeText(patient(days, typed)), typed).toBe(typed);
      }
    }
  });

  it('shows the typed months of every age 1-36 months again', () => {
    for (let months = 1; months <= 36; months += 1) {
      const typed = `${months} мес`;
      expect(restoredAgeText(patient(parseAgeInput(typed), typed)), typed).toBe(typed);
    }
  });

  it('does not show the typed text when the age was changed since (a card or a seed)', () => {
    expect(restoredAgeText(patient(parseAgeInput('9'), '5'))).toBe('9 лет');
    expect(restoredAgeText(patient(null, '5'))).toBe('');
  });

  it('words the days of a typed age by what was typed, with no typed text too', () => {
    for (let years = 2; years <= 18; years += 1) {
      const days = parseAgeInput(String(years));
      expect(ageText(days ?? 0)).toMatch(new RegExp(`^${years} (год|года|лет)$`));
    }
    for (let months = 1; months <= 23; months += 1) {
      expect(ageText(parseAgeInput(`${months} мес`) ?? 0)).toBe(`${months} мес.`);
    }
    expect(ageText(12)).toBe('12 дн.');
  });

  it('words a birth-date age as the whole years across leap and common years', () => {
    // 2024 and 2028 are leap years: five years hold 1 or 2 leap days, so 1825 to 1827 days.
    for (let birthYear = 2018; birthYear <= 2027; birthYear += 1) {
      for (const [month, day] of [
        [0, 1],
        [1, 28],
        [2, 1],
        [11, 31],
      ] as const) {
        const birth = Date.UTC(birthYear, month, day);
        for (let years = 2; years <= 18; years += 1) {
          const birthday = Date.UTC(birthYear + years, month, day);
          const onBirthday = Math.floor((birthday - birth) / DAY_MS);
          expect(ageText(onBirthday), `${birthYear}-${month + 1}-${day} +${years}`).toMatch(
            new RegExp(`^${years} `),
          );
          expect(ageText(onBirthday + 200), 'half a year later').toMatch(new RegExp(`^${years} `));
          if (years > 2) {
            expect(ageText(onBirthday - 10), '10 days before').toMatch(
              new RegExp(`^${years - 1} `),
            );
          }
        }
      }
    }
  });
});
