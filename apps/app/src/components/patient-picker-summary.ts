import { ageDaysBetween } from '@/features/tools/tool-age-scope';
import { pluralRu } from '@/i18n/labels';
import { calculateAgeOnDate } from '@/state/patient-domain';

/** `YYYY-MM-DD` as `ДД.ММ.ГГГГ`; any other text is returned as it is. */
export function patientBirthDateText(birthDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(birthDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : birthDate;
}

/** «5 лет», «8 мес.», «12 дн.» by calendar birthdays, so the fifth birthday is already «5 лет». */
function ageText(birthDate: string, onDate: string): string {
  const { years, months, days } = calculateAgeOnDate(birthDate, onDate);
  if (years >= 2) return `${years} ${pluralRu(years, 'год', 'года', 'лет')}`;
  const totalMonths = years * 12 + months;
  if (totalMonths >= 2) return `${totalMonths} мес.`;
  const totalDays = totalMonths > 0 ? totalMonths * 30 + days : days;
  return `${totalDays} дн.`;
}

/** The second line of a chosen patient: «04.03.1980 · 46 лет», or nothing without a birth date. */
export function patientRowSummary(
  birthDate: string | undefined,
  onDate: string,
): string | undefined {
  if (!birthDate) return undefined;
  const date = patientBirthDateText(birthDate);
  // A date that is not a real calendar date or lies in the future has no age to show.
  if (ageDaysBetween(birthDate, onDate) === undefined) return date;
  return `${date} · ${ageText(birthDate, onDate)}`;
}
