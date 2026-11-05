/**
 * The line under the list's title (owner 2026-11-03: the header felt empty): a short, warm word for
 * the doctor, chosen from a set by the time of day. One is picked per session, so it does not
 * change under the doctor's eyes while they work.
 */

export type DayPart = 'morning' | 'day' | 'evening' | 'night';

const MORNING = [
  'Доброе утро! Пусть день будет спокойным',
  'С добрым утром. Начнём с самого важного',
  'Хорошего утра и лёгкого приёма',
  'Новое утро, новые хорошие новости',
  'Доброго утра, доктор',
  'Утро. Чай, дневники и ясная голова',
  'Пусть сегодня всё складывается',
  'Доброе утро. Пациенты уже на связи',
] as const;

const DAY = [
  'Добрый день! Всё под рукой',
  'Середина дня. Вы справляетесь отлично',
  'Хорошего дня и спокойного приёма',
  'Не забудьте про перерыв, дневники подождут',
  'Добрый день, доктор',
  'День идёт хорошо. Так держать',
  'Тихой работы и добрых новостей',
  'Пациенты в надёжных руках',
] as const;

const EVENING = [
  'Добрый вечер. Вы сегодня славно поработали',
  'Вечер добрый. Скоро можно выдохнуть',
  'Спокойного вечера, доктор',
  'Тёплого вечера и мягкого конца дня',
  'День почти позади. Спасибо вам',
  'Добрый вечер. Дневники в порядке',
  'Пусть вечер будет тихим',
  'Отдохнуть тоже часть работы',
] as const;

const NIGHT = [
  'Поздно уже. Берегите себя, доктор',
  'Ночь на дворе. Дневники подождут до утра',
  'Тихой ночи. Вы многое сделали',
] as const;

/** Fit any time of day. */
const ANY = [
  'Рады вас видеть',
  'С возвращением, доктор',
  'Всё готово к работе',
  'Спасибо, что заботитесь о пациентах',
  'Вы делаете важное дело',
  'Пусть сегодня будет больше хорошего',
  'Здравствуйте! Чем займёмся?',
  'Приятной работы',
] as const;

export const GREETINGS: Readonly<Record<DayPart, readonly string[]>> = {
  morning: MORNING,
  day: DAY,
  evening: EVENING,
  night: NIGHT,
};

export const ANY_TIME_GREETINGS: readonly string[] = ANY;

/** Every line, for the count and the length checks. */
export const ALL_GREETINGS: readonly string[] = [...MORNING, ...DAY, ...EVENING, ...NIGHT, ...ANY];

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'night';
}

/** The line for this hour: from the part of the day's own set and the lines for any time. */
export function pickGreeting(hour: number, seed: number): string {
  const pool = [...GREETINGS[dayPart(hour)], ...ANY];
  const index = Math.abs(Math.floor(seed)) % pool.length;
  return pool[index] ?? ANY[0];
}

let sessionSeed: number | undefined;
let sessionGreeting: string | undefined;

/** The session's line: the first call decides it, the rest repeat it. */
export function sessionGreetingLine(now: Date = new Date()): string {
  sessionSeed ??= Math.floor(Math.random() * 1_000_000);
  sessionGreeting ??= pickGreeting(now.getHours(), sessionSeed);
  return sessionGreeting;
}
