/**
 * The day plan of a care diary: which intakes, checkpoints and questionnaires a day asks for, what
 * the patient has already marked, and the heatmap level of each day. Pure functions over the
 * invitation and the entries; the patient page and the doctor preview share them.
 */
import type {
  DiaryCheckpoint,
  DiaryDoseTime,
  DiaryEntry,
  DiaryInvitation,
  DiaryPlanItem,
  DiaryPlanValue,
} from '@/features/diary/diary-model';
import { activePlanItems } from '@/features/diary/diary-model';

/** Field of the care template that holds intake marks. */
export const CARE_DOSE_FIELD = 'medication';
/** A questionnaire without its own period is offered once a week. */
export const DEFAULT_QUESTIONNAIRE_DAYS = 7;
/** An open intake turns «late» this long after its time. */
const LATE_AFTER_MINUTES = 60;

export type TaskState = 'done' | 'skipped' | 'open' | 'late' | 'missed';

export interface DoseTask {
  readonly key: string;
  readonly item: DiaryPlanItem;
  readonly time: DiaryDoseTime;
  readonly entry: DiaryEntry | undefined;
  readonly state: TaskState;
}

export interface CheckTask {
  readonly key: string;
  readonly checkpoint: DiaryCheckpoint;
  readonly time: string | undefined;
  readonly entry: DiaryEntry | undefined;
  readonly state: TaskState;
}

export interface QuestionnaireTask {
  readonly checkpoint: DiaryCheckpoint;
  /** The answers of this day, when given. */
  readonly entry: DiaryEntry | undefined;
  /** Last answers before or on this day. */
  readonly last: DiaryEntry | undefined;
  /** The day asks for it (period elapsed or answered on this day). */
  readonly due: boolean;
  /** Local day key when it is next due, after the last answers. */
  readonly nextDay: string | undefined;
}

export interface DayPlan {
  readonly day: string;
  readonly doses: readonly DoseTask[];
  /** Intakes taken when needed on this day. */
  readonly asNeeded: readonly {
    readonly item: DiaryPlanItem;
    readonly entries: readonly DiaryEntry[];
  }[];
  readonly checks: readonly CheckTask[];
  readonly questionnaires: readonly QuestionnaireTask[];
  /** Free descriptions of the patient's state on this day, oldest first. */
  readonly notes: readonly DiaryEntry[];
  readonly done: number;
  readonly total: number;
}

export interface HeatDay {
  readonly day: string;
  readonly level: 0 | 1 | 2 | 3 | 4;
  /**
   * How many symptoms the day shows, 0 (none) to 4 (severe): a low wellbeing score. Missed intakes
   * are not symptoms. Questionnaire results need their schema, so the caller adds those.
   */
  readonly symptoms: 0 | 1 | 2 | 3 | 4;
  readonly done: number;
  readonly total: number;
  readonly entries: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` of a moment in the device's time zone. */
export function dayKey(moment: Date | string): string {
  const date = typeof moment === 'string' ? new Date(moment) : moment;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a day key. */
export function dayStart(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

export function addDays(day: string, count: number): string {
  const start = dayStart(day);
  start.setDate(start.getDate() + count);
  return dayKey(start);
}

/** The moment `HH:MM` on a day, local time, as ISO. */
export function atTime(day: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const start = dayStart(day);
  start.setHours(hours, minutes, 0, 0);
  return start.toISOString();
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

export type DayPeriod = 'morning' | 'day' | 'evening' | 'night';

export const DAY_PERIOD_LABEL: Readonly<Record<DayPeriod, string>> = {
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
  night: 'Ночь',
};

export function dayPeriod(time: string): DayPeriod {
  const hour = Math.floor(minutesOf(time) / 60);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'day';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'night';
}

function doseValue(entry: DiaryEntry): DiaryPlanValue | undefined {
  const value = entry.values[CARE_DOSE_FIELD];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as DiaryPlanValue)
    : undefined;
}

/** Entries of one local day, oldest first. */
export function entriesOfDay(entries: readonly DiaryEntry[], day: string): DiaryEntry[] {
  return entries
    .filter((entry) => dayKey(entry.at) === day)
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function openState(day: string, time: string | undefined, now: Date): TaskState {
  const today = dayKey(now);
  if (day < today) return 'missed';
  if (day > today || time === undefined) return 'open';
  const current = now.getHours() * 60 + now.getMinutes();
  return current > minutesOf(time) + LATE_AFTER_MINUTES ? 'late' : 'open';
}

function questionnaireTask(
  checkpoint: DiaryCheckpoint,
  entries: readonly DiaryEntry[],
  day: string,
): QuestionnaireTask {
  const answered = entries
    .filter((entry) => entry.check === checkpoint.id && entry.answers)
    .toSorted((left, right) => left.at.localeCompare(right.at));
  const entry = answered.findLast((candidate) => dayKey(candidate.at) === day);
  const last = answered.findLast((candidate) => dayKey(candidate.at) <= day);
  const period = checkpoint.everyDays ?? DEFAULT_QUESTIONNAIRE_DAYS;
  const before = answered.findLast((candidate) => dayKey(candidate.at) < day);
  const nextDay = last ? addDays(dayKey(last.at), period) : undefined;
  const due = entry !== undefined || !before || addDays(dayKey(before.at), period) <= day;
  return { checkpoint, entry, last, due, nextDay };
}

/**
 * The first day of the diary: when it was issued or the earliest entry, whichever is first. A
 * re-issued plan carries a new `issuedAt`, so the issue date alone would forget earlier days.
 */
export function diaryStarted(invitation: DiaryInvitation, entries: readonly DiaryEntry[]): string {
  return entries.reduce(
    (earliest, entry) => (dayKey(entry.at) < earliest ? dayKey(entry.at) : earliest),
    dayKey(invitation.issuedAt),
  );
}

/** The item is taken on this day: no course dates, or the day falls in one of its ranges. */
export function onCourse(item: DiaryPlanItem, day: string): boolean {
  if (!item.course?.length) return true;
  return item.course.some((range) => range.from <= day && day <= range.to);
}

/** What a day asks for and what the patient marked on it. */
export function dayPlan(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  day: string,
  now: Date = new Date(),
): DayPlan {
  const ofDay = entriesOfDay(entries, day);
  const doses: DoseTask[] = [];
  const asNeeded: { item: DiaryPlanItem; entries: DiaryEntry[] }[] = [];
  for (const item of activePlanItems(invitation)) {
    if (item.asNeeded) {
      if (!onCourse(item, day)) continue;
      asNeeded.push({
        item,
        entries: ofDay.filter((entry) => doseValue(entry)?.item === item.id),
      });
      continue;
    }
    if (!onCourse(item, day)) continue;
    for (const time of item.times ?? []) {
      const entry = ofDay.findLast((candidate) => {
        const value = doseValue(candidate);
        return value?.item === item.id && value.slot === time.time;
      });
      const done = entry ? doseValue(entry)?.done : undefined;
      doses.push({
        key: `${item.id}@${time.time}`,
        item,
        time,
        entry,
        state:
          entry === undefined
            ? openState(day, time.time, now)
            : done === false
              ? 'skipped'
              : 'done',
      });
    }
  }
  doses.sort((left, right) => left.time.time.localeCompare(right.time.time));

  const checks: CheckTask[] = [];
  const questionnaires: QuestionnaireTask[] = [];
  for (const checkpoint of invitation.checkpoints ?? []) {
    if (checkpoint.ended) continue;
    if (checkpoint.kind === 'questionnaire') {
      questionnaires.push(questionnaireTask(checkpoint, entries, day));
      continue;
    }
    const marks = ofDay.filter((entry) => entry.check === checkpoint.id);
    const times = checkpoint.times?.length ? checkpoint.times : [undefined];
    times.forEach((time, index) => {
      const entry = marks[index];
      checks.push({
        key: `${checkpoint.id}@${time ?? 'day'}`,
        checkpoint,
        time,
        entry,
        state: entry ? 'done' : openState(day, time, now),
      });
    });
  }
  checks.sort((left, right) => (left.time ?? '99').localeCompare(right.time ?? '99'));

  const notes = ofDay.filter(
    (entry) =>
      entry.check === undefined &&
      doseValue(entry) === undefined &&
      (entry.note !== undefined || typeof entry.values['state'] === 'string'),
  );

  const counted = [
    ...doses.map((task) => task.state === 'done' || task.state === 'skipped'),
    ...checks.map((task) => task.state === 'done'),
    ...questionnaires.filter((task) => task.due).map((task) => task.entry !== undefined),
  ];
  return {
    day,
    doses,
    asNeeded,
    checks,
    questionnaires,
    notes,
    done: counted.filter(Boolean).length,
    total: counted.length,
  };
}

/**
 * Heatmap level of a day: the share of the day's plan that was marked. A day with nothing planned
 * but with entries counts as level 2; mood is deliberately not encoded.
 */
export function heatLevel(done: number, total: number, entries: number): HeatDay['level'] {
  if (total === 0) return entries > 0 ? 2 : 0;
  if (done === 0) return entries > 0 ? 1 : 0;
  const share = done / total;
  if (share < 0.25) return 1;
  if (share < 0.5) return 2;
  if (share < 0.75) return 3;
  return 4;
}

/** A part of the day plan the heatmap can count (the doctor's and the patient's filter). */
export type HeatPart = 'doses' | 'scores' | 'vitals' | 'answers' | 'questionnaires' | 'notes';

export const HEAT_PART_LABEL: Readonly<Record<HeatPart, string>> = {
  doses: 'Лекарства',
  scores: 'Самочувствие',
  vitals: 'Показатели',
  answers: 'Описания',
  questionnaires: 'Опросники',
  notes: 'Заметки',
};

const HEAT_PART_ORDER: readonly HeatPart[] = [
  'doses',
  'scores',
  'vitals',
  'answers',
  'questionnaires',
  'notes',
];

const CHECK_PART: Readonly<Record<DiaryCheckpoint['kind'], HeatPart>> = {
  score: 'scores',
  vitals: 'vitals',
  text: 'answers',
  choice: 'answers',
  questionnaire: 'questionnaires',
};

/**
 * The heatmap parts this diary actually has, in display order: intakes when the doctor planned
 * any, one part per kind of checkpoint, and free notes (every diary takes them).
 */
export function heatParts(invitation: DiaryInvitation): readonly HeatPart[] {
  const present = new Set<HeatPart>(['notes']);
  if (activePlanItems(invitation).length > 0) present.add('doses');
  for (const checkpoint of invitation.checkpoints ?? []) {
    if (!checkpoint.ended) present.add(CHECK_PART[checkpoint.kind]);
  }
  return HEAT_PART_ORDER.filter((part) => present.has(part));
}

/** Wellbeing scores up to this one count as a symptom. */
export const SYMPTOM_WELLBEING_MAX = 3;

/**
 * Symptom level of a day from its wellbeing and mood scores: the lowest score sets it (3 gives 1, 0 gives 4)
 * and a second low score the same day adds one.
 */
export function symptomLevel(scores: readonly number[]): HeatDay['symptoms'] {
  const low = scores.filter((score) => score <= SYMPTOM_WELLBEING_MAX);
  if (low.length === 0) return 0;
  const base = Math.max(1, SYMPTOM_WELLBEING_MAX + 1 - Math.max(0, Math.min(...low)));
  return Math.min(4, base + (low.length > 1 ? 1 : 0)) as HeatDay['symptoms'];
}

/** The part an entry belongs to; entries of an unknown checkpoint count as free notes. */
function entryPart(
  entry: DiaryEntry,
  kinds: ReadonlyMap<string, DiaryCheckpoint['kind']>,
): HeatPart {
  if (entry.check !== undefined) {
    const kind = kinds.get(entry.check);
    return kind ? CHECK_PART[kind] : 'notes';
  }
  return doseValue(entry) === undefined ? 'notes' : 'doses';
}

/** Marked and planned tasks of a day, restricted to the chosen parts. */
function planCounts(
  plan: DayPlan,
  include: ReadonlySet<HeatPart>,
): { readonly done: number; readonly total: number } {
  const counted = [
    ...(include.has('doses')
      ? plan.doses.map((task) => task.state === 'done' || task.state === 'skipped')
      : []),
    ...plan.checks
      .filter((task) => include.has(CHECK_PART[task.checkpoint.kind]))
      .map((task) => task.state === 'done'),
    ...(include.has('questionnaires')
      ? plan.questionnaires.filter((task) => task.due).map((task) => task.entry !== undefined)
      : []),
  ];
  return { done: counted.filter(Boolean).length, total: counted.length };
}

/**
 * Heatmap days from `from` to `to` inclusive (day keys). `include` limits the counted parts of the
 * plan and of the entries; absent (or empty) it counts everything.
 */
export function heatmapDays(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  from: string,
  to: string,
  now: Date = new Date(),
  include?: ReadonlySet<HeatPart>,
): HeatDay[] {
  const only = include && include.size > 0 ? include : undefined;
  const kinds = new Map((invitation.checkpoints ?? []).map((item) => [item.id, item.kind]));
  const days: HeatDay[] = [];
  const counts = new Map<string, number>();
  const wellbeing = new Map<string, number[]>();
  for (const entry of entries) {
    if (only && !only.has(entryPart(entry, kinds))) continue;
    const key = dayKey(entry.at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    // Low mood is a symptom the same way a low wellbeing score is.
    for (const field of ['wellbeing', 'mood']) {
      const score = entry.values[field];
      if (typeof score === 'number') wellbeing.set(key, [...(wellbeing.get(key) ?? []), score]);
    }
  }
  const issued = diaryStarted(invitation, entries);
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const count = counts.get(day) ?? 0;
    const symptoms = symptomLevel(wellbeing.get(day) ?? []);
    // Before the diary was issued nothing was asked; those days only show what was written.
    if (day < issued || day > dayKey(now)) {
      days.push({ day, level: count > 0 ? 2 : 0, symptoms, done: 0, total: 0, entries: count });
      continue;
    }
    const plan = dayPlan(invitation, entries, day, now);
    const { done, total } = only ? planCounts(plan, only) : plan;
    days.push({ day, level: heatLevel(done, total, count), symptoms, done, total, entries: count });
  }
  return days;
}
