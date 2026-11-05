import { addDays, dayKey, dayStart } from '@/features/diary/diary-care';
import type {
  DiaryAppointment,
  DiaryEntry,
  DiaryInvitation,
  DiaryLabRequest,
} from '@/features/diary/diary-model';

/**
 * Visits the doctor booked and lab tests the doctor asks for (DIARY27, owner 2026-11-04): what the
 * patient's day says about them, and how a plan change names them.
 */

/** «5 ноября», «сегодня», «завтра». */
export function dayWords(day: string, today: string): string {
  if (day === today) return 'сегодня';
  if (day === addDays(today, 1)) return 'завтра';
  return dayStart(day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** «завтра в 14:30», «5 ноября». */
export function appointmentWhen(appointment: DiaryAppointment, today: string): string {
  const day = dayWords(appointment.day, today);
  return appointment.time ? `${day} в ${appointment.time}` : day;
}

/** How long after its start a visit still counts as today's (it may run late). */
const VISIT_GRACE_MS = 2 * 60 * 60 * 1000;

/**
 * The next visit to show: the earliest one not yet over, within `days` days. A visit without a time
 * lasts its whole day.
 */
export function nextAppointment(
  invitation: DiaryInvitation,
  now: Date,
  days = 14,
): DiaryAppointment | undefined {
  const today = dayKey(now);
  const last = addDays(today, days);
  return (invitation.appointments ?? [])
    .filter((appointment) => {
      if (appointment.day < today || appointment.day > last) return false;
      if (appointment.day > today || !appointment.time) return true;
      const [hours = 0, minutes = 0] = appointment.time.split(':').map(Number);
      const start = dayStart(appointment.day);
      start.setHours(hours, minutes, 0, 0);
      return now.getTime() < start.getTime() + VISIT_GRACE_MS;
    })
    .toSorted((left, right) =>
      `${left.day}T${left.time ?? ''}`.localeCompare(`${right.day}T${right.time ?? ''}`),
    )[0];
}

/** The first heading line: «Завтра у вас приём в 14:30». */
export function appointmentHeadline(appointment: DiaryAppointment, today: string): string {
  const when = appointmentWhen(appointment, today);
  return `${when[0]?.toUpperCase() ?? ''}${when.slice(1)} у вас приём`.replace(
    / в (\d\d:\d\d) у вас приём$/u,
    ' у вас приём в $1',
  );
}

/** The latest result the patient typed in for this lab test, if any. */
export function labResult(
  lab: DiaryLabRequest,
  entries: readonly DiaryEntry[],
): { readonly value: number; readonly at: string; readonly entry: DiaryEntry } | undefined {
  let found: { value: number; at: string; entry: DiaryEntry } | undefined;
  for (const entry of entries) {
    const value = entry.values[lab.field];
    if (typeof value !== 'number') continue;
    if (!found || entry.at > found.at) found = { value, at: entry.at, entry };
  }
  return found;
}

/** The plan change lines of visits and lab tests, for the patient's «что изменилось». */
export function visitChanges(before: DiaryInvitation, after: DiaryInvitation): string[] {
  const today = dayKey(new Date());
  const lines: string[] = [];
  const old = new Map((before.appointments ?? []).map((one) => [one.id, one]));
  const kept = new Set((after.appointments ?? []).map((one) => one.id));
  for (const appointment of after.appointments ?? []) {
    const previous = old.get(appointment.id);
    if (!previous) lines.push(`Приём: ${appointmentWhen(appointment, today)}`);
    else if (previous.day !== appointment.day || previous.time !== appointment.time) {
      lines.push(`Приём перенесён: ${appointmentWhen(appointment, today)}`);
    }
  }
  for (const appointment of before.appointments ?? []) {
    if (!kept.has(appointment.id) && appointment.day >= today) {
      lines.push(`Приём отменён: ${appointmentWhen(appointment, today)}`);
    }
  }
  const labs = new Set((before.labs ?? []).map((lab) => lab.id));
  for (const lab of after.labs ?? []) {
    if (!labs.has(lab.id)) lines.push(`Сдать анализ: ${lab.name}`);
  }
  return lines;
}
