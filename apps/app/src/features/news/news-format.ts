const TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const LONG_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Time of day inside the list (the group heading already names the day). */
export function itemTimeLabel(publishedAt: number): string {
  return TIME_FORMAT.format(publishedAt);
}

/** Full date for the viewer header. */
export function itemDateLabel(publishedAt: number): string {
  return `${LONG_DATE_FORMAT.format(publishedAt)}, ${TIME_FORMAT.format(publishedAt)}`;
}

export function shortDateLabel(time: number): string {
  return SHORT_DATE_FORMAT.format(time);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Twitter-like age for the account line: «сейчас», «5 мин», «3 ч», «вчера», «4 д», then the date. */
export function relativeTimeLabel(publishedAt: number, now: number): string {
  const age = Math.max(0, now - publishedAt);
  if (age < MINUTE) return 'сейчас';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} мин`;
  if (age < DAY) return `${Math.floor(age / HOUR)} ч`;
  if (age < 2 * DAY) return 'вчера';
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} д`;
  const sameYear = new Date(publishedAt).getFullYear() === new Date(now).getFullYear();
  return sameYear ? SHORT_DATE_FORMAT.format(publishedAt) : LONG_DATE_FORMAT.format(publishedAt);
}

/** A source's name for a tight header: «Росздравнадзор — новости» becomes «Росздравнадзор». */
export function shortSourceName(title: string): string {
  const head = title.split(/\s[—–-]\s/u)[0]?.trim();
  return head && head !== '' ? head : title;
}
