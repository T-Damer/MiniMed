/**
 * What the patient's day screen says about each section of a care draft, as plain data: the icon of
 * a kind, the line under a title, the intake rows grouped by part of the day. Shared by the doctor's
 * form (PatientScreenEditor) and the read-only preview of the patient's screen (PatientView).
 */
import type { AppGlyphName } from '@/components/AppGlyph';
import { describeRanges } from '@/components/date-ranges';
import { heatmapRange } from '@/diary/diary-heatmap-range';
import { assignmentScheduleWords } from '@/features/diary/diary-assignments';
import { addDays, type DayPeriod, dayPeriod, type HeatDay } from '@/features/diary/diary-care';
import {
  CARE_SECTION_LABEL,
  type CareAppointmentDraft,
  type CareAssignmentDraft,
  type CareDoseDraft,
  type CareLabDraft,
  type CareSectionDraft,
  type CareSectionKind,
} from '@/features/diary/diary-care-draft';
import { DIARY_MEAL_LABEL } from '@/features/diary/diary-model';
import { diaryQuestionnaire } from '@/features/diary/diary-questionnaires';
import { substanceById } from '@/features/diary/diary-substances';
import { appointmentWhen, dayWords } from '@/features/diary/diary-visits';

export const KIND_ICON: Readonly<Record<CareSectionKind, AppGlyphName>> = {
  drug: 'pill',
  score: 'smiley',
  mood: 'brain',
  vitals: 'heartbeat',
  body: 'scales',
  glucose: 'drop-half',
  activity: 'sneaker-move',
  meals: 'fork-knife',
  text: 'note-pencil',
  choice: 'list-checks',
  use: 'drop',
  questionnaire: 'list-numbers',
};

/** The kinds of «Что отмечает пациент», in the order the doctor is offered them. */
export const CHECK_KINDS: readonly CareSectionKind[] = [
  'score',
  'mood',
  'vitals',
  'body',
  'glucose',
  'activity',
  'meals',
  'text',
  'choice',
  'use',
];

/** Glucose, activity and meals ask fields with fixed ids: one section of each. */
export const ONE_OF: readonly CareSectionKind[] = ['glucose', 'activity', 'meals'];

export function timesText(times: readonly CareDoseDraft[]): string {
  return times
    .filter((time) => time.time)
    .map((time) => (time.meal ? `${time.time} ${DIARY_MEAL_LABEL[time.meal]}` : time.time))
    .join(', ');
}

/** What the patient's row says under the title. */
export function sectionDetail(section: CareSectionDraft): string {
  switch (section.kind) {
    case 'drug':
      return [
        [section.dose, section.form].filter((part) => part.trim()).join(' · '),
        section.asNeeded || !section.times.length ? 'при необходимости' : timesText(section.times),
        section.course.length ? describeRanges(section.course) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'choice':
      return section.options.filter((option) => option.trim()).join(' / ');
    case 'use':
      return [
        section.substances.flatMap((id) => substanceById(id)?.short ?? []).join(', '),
        section.craving ? 'тяга' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'questionnaire':
      return `${diaryQuestionnaire(section.quiz)?.about ?? 'свой опросник'} · раз в ${section.everyDays} дн.`;
    default:
      // The row shows the first time; the detail adds the others, or says it has none.
      return section.times.filter((time) => time.time).length > 1
        ? timesText(section.times)
        : section.times.some((time) => time.time)
          ? ''
          : 'в любое время дня';
  }
}

/** The title a section shows: its own, or what it is while the doctor has not named it yet. */
export function sectionTitle(section: CareSectionDraft | undefined): string {
  return !section
    ? ''
    : section.title.trim() ||
        (section.kind === 'drug' ? 'Выберите препарат' : CARE_SECTION_LABEL[section.kind]);
}

/** A medicine's title with its dose, as the patient's checklist writes it. */
export function drugTitle(section: CareSectionDraft | undefined): string {
  return [sectionTitle(section), section?.dose.trim()].filter(Boolean).join(' ');
}

/** An empty month calendar: the patient's own, with its title, before anything is marked. */
export function emptyHeat(today: string): HeatDay[] {
  const range = heatmapRange(today, today);
  const days: HeatDay[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    days.push({ day, level: 0, symptoms: 0, done: 0, total: 0, entries: 0 });
  }
  return days;
}

/** One row per intake time, grouped by part of day, as the patient's checklist shows them. */
export function drugRows(sections: readonly CareSectionDraft[]) {
  const timed: { period: DayPeriod; rows: { key: string; time: CareDoseDraft }[] }[] = [];
  const asNeeded: string[] = [];
  for (const section of sections) {
    if (section.kind !== 'drug') continue;
    const times = section.times.filter((time) => time.time);
    if (section.asNeeded || !times.length) {
      asNeeded.push(section.key);
      continue;
    }
    for (const time of times) {
      const period = dayPeriod(time.time);
      const group = timed.find((candidate) => candidate.period === period);
      const row = { key: section.key, time };
      if (group) group.rows.push(row);
      else timed.push({ period, rows: [row] });
    }
  }
  const order: readonly DayPeriod[] = ['morning', 'day', 'evening', 'night'];
  for (const group of timed) group.rows.sort((a, b) => a.time.time.localeCompare(b.time.time));
  timed.sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period));
  return { timed, asNeeded };
}

/** The line a visit shows: «Завтра, 14:30», or the ask to choose a day. */
export function visitTitle(visit: CareAppointmentDraft, today: string): string {
  if (!visit.day) return 'Выберите день приёма';
  const when = appointmentWhen(
    { id: '', day: visit.day, ...(visit.time ? { time: visit.time } : {}) },
    today,
  );
  return `${when[0]?.toUpperCase() ?? ''}${when.slice(1)}`;
}

/** What a lab test says under its name: the deadline and the reason. */
export function labDetail(lab: CareLabDraft, today: string): string | undefined {
  return (
    [lab.by ? `сдать до ${dayWords(lab.by, today)}` : '', lab.why.trim()]
      .filter(Boolean)
      .join(' · ') || undefined
  );
}

/** How often a task comes, in words. */
export function taskDetail(task: CareAssignmentDraft): string {
  return assignmentScheduleWords({
    repeat: task.repeat,
    days: task.days,
    time: task.time || undefined,
    until: task.until || undefined,
  });
}
