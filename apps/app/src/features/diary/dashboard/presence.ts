/**
 * Presence of a patient's phone as the doctor sees it (green dot, «в сети …»). Pure: the summary
 * comes from the diary service (`online`, `lastSeenAt`); the clock is passed in. Texts avoid
 * gendered verbs («в сети 5 минут назад», not «был(а)»).
 */
import { DIARY_ONLINE_WINDOW_MS, type DiaryPatientSummary } from '@localmed/contracts';

import { pluralRu } from '@/i18n/labels';

export type PresenceSummary = Pick<DiaryPatientSummary, 'online' | 'lastSeenAt'>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Up to here the label counts hours; beyond it names the day. */
const RELATIVE_LIMIT = 6 * HOUR;

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/**
 * Online now. The service's flag is trusted only while the last sighting is fresh, so a dropped
 * live stream cannot leave the dot green for hours.
 */
export function isOnline(summary: PresenceSummary, now: Date | number = Date.now()): boolean {
  if (!summary.online || !summary.lastSeenAt) return false;
  const age = toMs(now) - Date.parse(summary.lastSeenAt);
  return Number.isFinite(age) && age < DIARY_ONLINE_WINDOW_MS + MINUTE;
}

/** «в сети», «в сети 5 минут назад», «в сети вчера в 21:40», «в сети 12 октября»; none if never seen. */
export function presenceLabel(
  summary: PresenceSummary,
  now: Date | number = Date.now(),
): string | undefined {
  if (isOnline(summary, now)) return 'в сети';
  if (!summary.lastSeenAt) return undefined;
  const seen = new Date(summary.lastSeenAt);
  if (Number.isNaN(seen.getTime())) return undefined;
  const current = new Date(toMs(now));
  const age = Math.max(0, current.getTime() - seen.getTime());
  if (age < MINUTE) return 'в сети только что';
  if (age < HOUR) {
    const minutes = Math.floor(age / MINUTE);
    return `в сети ${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')} назад`;
  }
  if (age < RELATIVE_LIMIT) {
    const hours = Math.floor(age / HOUR);
    return `в сети ${hours} ${pluralRu(hours, 'час', 'часа', 'часов')} назад`;
  }
  const time = `${two(seen.getHours())}:${two(seen.getMinutes())}`;
  const dayGap = dayNumber(current) - dayNumber(seen);
  if (dayGap === 0) return `в сети сегодня в ${time}`;
  if (dayGap === 1) return `в сети вчера в ${time}`;
  const date = `${seen.getDate()} ${MONTHS[seen.getMonth()]}`;
  return seen.getFullYear() === current.getFullYear()
    ? `в сети ${date}`
    : `в сети ${date} ${seen.getFullYear()}`;
}

function toMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** Calendar day in local time as a whole number (DST-safe: built from the local date parts). */
function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}
