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
