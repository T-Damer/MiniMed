import {
  type CalendarDate,
  compareDates,
  daysBetween,
  formatIsoDate,
  parseIsoDate,
} from '@/features/vaccination/vaccination-plan';
import { pluralRu } from '@/i18n/labels';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** `2026-10-05` as `05.10.2026`. */
export function displayIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

export function displayDate(date: CalendarDate): string {
  return displayIsoDate(formatIsoDate(date));
}

/** Today as an ISO date in the device's time zone. */
export function todayIso(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole calendar months from `birth` to `today`. */
function wholeMonths(birth: CalendarDate, today: CalendarDate): number {
  const months = (today.year - birth.year) * 12 + (today.month - birth.month);
  return today.day < birth.day ? months - 1 : months;
}

/**
 * The age of a child in words: «5 дней», «5 мес.», «1 год 7 мес.», «3 года». Empty when the dates
 * are not usable or the birth date is after `today`.
 */
export function childAgeLabel(birthDate: string, today: string): string {
  const birth = parseIsoDate(birthDate);
  const now = parseIsoDate(today);
  if (!birth || !now || compareDates(birth, now) > 0) return '';
  const months = wholeMonths(birth, now);
  if (months < 1) {
    const days = daysBetween(birth, now);
    return `${days} ${pluralRu(days, 'день', 'дня', 'дней')}`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} мес.`;
  const yearsText = `${years} ${pluralRu(years, 'год', 'года', 'лет')}`;
  return rest === 0 ? yearsText : `${yearsText} ${rest} мес.`;
}
