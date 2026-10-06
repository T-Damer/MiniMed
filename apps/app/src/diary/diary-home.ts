/**
 * Plain-Russian wording and grouping for the patient diary's home, «Мои записи» and the send step.
 * No DOM and no storage: every function takes `now` so the text is the same in tests and on screen.
 */
import { entriesLabel, formatDate, formatTime, isSameLocalDay } from '@/diary/diary-format';
import type { DiaryShareStatus } from '@/features/diary/diary-merge';
import type { DiaryEntry } from '@/features/diary/diary-model';

export type SendTone = 'empty' | 'pending' | 'done';

export interface SendSummary {
  readonly tone: SendTone;
  /** One short line for the «Отправить врачу» button. */
  readonly text: string;
  /** How many entries the doctor has not received (new or edited since). */
  readonly pending: number;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** «Не отправлено: 3 записи» / «Всё отправлено 5 окт.» / «Записей пока нет». */
export function sendSummary(status: DiaryShareStatus): SendSummary {
  if (status.total === 0) return { tone: 'empty', text: 'Записей пока нет', pending: 0 };
  const pending = status.unsent + status.changed;
  if (pending === 0 && status.sentAt) {
    return { tone: 'done', text: `Всё отправлено ${shortDate(status.sentAt)}`, pending: 0 };
  }
  return { tone: 'pending', text: `Не отправлено: ${entriesLabel(pending)}`, pending };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export interface DayLabel {
  /** «Сегодня», «Вчера» or the weekday. */
  readonly title: string;
  /** «6 октября». */
  readonly date: string;
  readonly today: boolean;
}

export function dayLabel(iso: string, now: Date): DayLabel {
  const date = new Date(iso);
  const day = formatDate(iso);
  if (isSameLocalDay(date, now)) return { title: 'Сегодня', date: day, today: true };
  if (isSameLocalDay(date, addDays(now, -1))) return { title: 'Вчера', date: day, today: false };
  const weekday = date.toLocaleDateString('ru-RU', { weekday: 'long' });
  return {
    title: `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`,
    date: day,
    today: false,
  };
}

/** «сегодня в 07:55», «вчера в 08:10», «3 октября в 08:10». */
export function whenLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const time = formatTime(iso);
  if (isSameLocalDay(date, now)) return `сегодня в ${time}`;
  if (isSameLocalDay(date, addDays(now, -1))) return `вчера в ${time}`;
  return `${formatDate(iso)} в ${time}`;
}

export interface EntryDay {
  readonly key: string;
  readonly label: DayLabel;
  /** Newest first. */
  readonly entries: readonly DiaryEntry[];
}

/** Days newest first, entries inside a day newest first: the order a patient looks for them. */
export function groupEntriesByDay(entries: readonly DiaryEntry[], now: Date): EntryDay[] {
  const sorted = entries.toSorted((left, right) => right.at.localeCompare(left.at));
  const days: { key: string; label: DayLabel; entries: DiaryEntry[] }[] = [];
  for (const entry of sorted) {
    const date = new Date(entry.at);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const last = days.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, label: dayLabel(entry.at, now), entries: [entry] });
  }
  return days;
}

/** The status line under «Записать показания». */
export function todaySummary(entries: readonly DiaryEntry[], now: Date): string {
  const today = entries
    .filter((entry) => isSameLocalDay(new Date(entry.at), now))
    .toSorted((left, right) => left.at.localeCompare(right.at));
  const last = today.at(-1);
  if (!last) return 'Сегодня записей ещё нет';
  return `Сегодня: ${entriesLabel(today.length)}, последняя в ${formatTime(last.at)}`;
}

/** The status line under «Мои записи»: when the newest entry was made. */
export function lastEntrySummary(entries: readonly DiaryEntry[], now: Date): string {
  const last = entries.toSorted((left, right) => right.at.localeCompare(left.at))[0];
  return last ? `Последняя: ${whenLabel(last.at, now)}` : 'Пока пусто';
}

/** «6 октября» for one day, «2 окт. – 6 окт.» for a span. */
export function periodLabel(entries: readonly DiaryEntry[]): string {
  const times = entries.map((entry) => entry.at).toSorted();
  const first = times[0];
  const last = times.at(-1);
  if (!first || !last) return '';
  if (isSameLocalDay(new Date(first), new Date(last))) return formatDate(first);
  return `${shortDate(first)} – ${shortDate(last)}`;
}

function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** What the send step says will go to the doctor, and what the doctor already has. */
export function sendDescription(status: DiaryShareStatus, entries: readonly DiaryEntry[]): string {
  const summary = sendSummary(status);
  const all = sentence(`Все записи: ${entriesLabel(status.total)}, за ${periodLabel(entries)}`);
  if (!status.sentAt) return `${all} Врачу пока ничего не отправлено.`;
  const since = shortDate(status.sentAt);
  return summary.pending === 0
    ? `${all} ${sentence(`Всё это уже отправлено ${since}`)} Отправляйте ещё раз, только если врач просит.`
    : `${all} ${sentence(`Врач получил записи ${since}`)} С тех пор новых или изменённых: ${summary.pending}.`;
}
