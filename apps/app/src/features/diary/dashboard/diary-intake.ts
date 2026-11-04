/**
 * Medicine intake per day for the doctor's charts (owner 2026-11-02): for each plan item, the dose
 * taken that day (a skipped or missed intake counts as 0) and the dose the plan prescribes that
 * day (its intakes on course, each with its own dose when it has one). Days before the diary began
 * have no point at all: no data is not a 0. A marked intake counts at the dose it was marked at
 * (the mark records it), so a later dose change does not rewrite the past; an intake nobody marked
 * counts at the dose of the plan in force that day (`planFor`, from the plan's versions, DIARY20),
 * else at the current plan's dose. An intake the patient marked as skipped is kept with its time,
 * dose, reason and note (`skipped`): the charts cross it out in red (DIARY23).
 */
import { addDays, dayKey, dayPlan, diaryStarted, doseValue } from '@/features/diary/diary-care';
import type { DiaryEntry, DiaryInvitation, DiaryMissReason } from '@/features/diary/diary-model';

export interface ParsedDose {
  readonly amount: number;
  /** What the amount counts: «мг», «таблетки»; «приём» when the dose has no number. */
  readonly unit: string;
}

const FRACTIONS: Readonly<Record<string, number>> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3 };

/** «10 мг» → 10 мг, «1/2 таблетки» → 0.5, «½ табл.» → 0.5; a dose in words counts as one intake. */
export function parseDose(text: string | undefined): ParsedDose {
  const source = (text ?? '').trim();
  const match = /^(\d+(?:[.,]\d+)?)?\s*(?:\/\s*(\d+))?\s*([½¼¾⅓])?\s*(.*)$/u.exec(source);
  if (!match || (match[1] === undefined && match[3] === undefined))
    return { amount: 1, unit: 'приём' };
  const whole = match[1] === undefined ? 0 : Number(match[1].replace(',', '.'));
  const divided = match[2] === undefined ? whole : whole / Number(match[2]);
  const amount = divided + (match[3] ? (FRACTIONS[match[3]] ?? 0) : 0);
  if (!Number.isFinite(amount) || amount <= 0) return { amount: 1, unit: 'приём' };
  return { amount, unit: (match[4] ?? '').trim() || 'приём' };
}

/** An intake the patient marked as not taken (not one nobody marked). */
export interface IntakeSkip {
  /** Planned time `HH:MM`. */
  readonly time: string;
  readonly dose?: string;
  readonly reason?: DiaryMissReason;
  readonly note?: string;
}

export interface IntakeDay {
  /** Local day `YYYY-MM-DD`. */
  readonly day: string;
  readonly taken: number;
  /** What the plan asks for that day; absent for a medicine taken when needed or off course. */
  readonly prescribed?: number;
  /** Intakes the patient marked as skipped that day; absent when none. */
  readonly skipped?: readonly IntakeSkip[];
}

export interface MedicineIntake {
  readonly itemId: string;
  readonly name: string;
  readonly unit: string;
  readonly days: readonly IntakeDay[];
}

/** The last `days` days up to today, per plan item, oldest first. */
export function medicineIntake(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  days: number,
  now: Date = new Date(),
  planFor?: (day: string) => DiaryInvitation,
): MedicineIntake[] {
  const today = dayKey(now);
  const started = diaryStarted(invitation, entries);
  const result = new Map<string, { name: string; unit: string; days: IntakeDay[] }>();
  const series = (id: string, name: string, dose: string | undefined) => {
    let current = result.get(id);
    if (!current) {
      current = { name, unit: parseDose(dose).unit, days: [] };
      result.set(id, current);
    }
    return current;
  };
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    if (day < started) continue;
    const plan = dayPlan(planFor?.(day) ?? invitation, entries, day, now);
    const totals = new Map<
      string,
      { taken: number; prescribed?: number; skipped?: readonly IntakeSkip[] }
    >();
    for (const task of plan.doses) {
      const text =
        (task.entry && doseValue(task.entry)?.dose) || (task.time.dose ?? task.item.dose);
      const dose = parseDose(text).amount;
      const total = totals.get(task.item.id) ?? { taken: 0, prescribed: 0 };
      const value = task.entry ? doseValue(task.entry) : undefined;
      const note = task.entry?.note?.trim();
      const skip: IntakeSkip | undefined =
        task.state === 'skipped'
          ? {
              time: task.time.time,
              ...(text ? { dose: text } : {}),
              ...(value?.reason ? { reason: value.reason } : {}),
              ...(note ? { note } : {}),
            }
          : undefined;
      const skipped = skip ? [...(total.skipped ?? []), skip] : total.skipped;
      totals.set(task.item.id, {
        taken: total.taken + (task.state === 'done' ? dose : 0),
        prescribed: (total.prescribed ?? 0) + dose,
        ...(skipped ? { skipped } : {}),
      });
      series(task.item.id, task.item.name, task.item.dose);
    }
    for (const { item, entries: taken } of plan.asNeeded) {
      const amount = taken
        .filter((entry) => doseValue(entry)?.done !== false)
        .reduce((sum, entry) => sum + parseDose(doseValue(entry)?.dose ?? item.dose).amount, 0);
      totals.set(item.id, { taken: amount });
      series(item.id, item.name, item.dose);
    }
    for (const [id, total] of totals) {
      result.get(id)?.days.push({
        day,
        taken: total.taken,
        ...(total.prescribed === undefined ? {} : { prescribed: total.prescribed }),
        ...(total.skipped ? { skipped: total.skipped } : {}),
      });
    }
  }
  return [...result].map(([itemId, value]) => ({ itemId, ...value }));
}
