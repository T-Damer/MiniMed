/**
 * Reminders of a connected care diary (DIARY_PLAN D4), worked out on the patient's phone. The
 * server gets only the moments (`reminderMoments`); the phone's worker reads the notices kept here
 * (`reminderNotices`) to say what is due when a moment's push arrives, and its «Принял» button
 * queues a `ReminderAction` the diary applies the next time it is open.
 */
import { DIARY_REMINDER_DAYS, DIARY_REMINDER_MAX } from '@localmed/contracts';

import { addDays, atTime, CARE_DOSE_FIELD, dayKey, dayPlan } from '@/features/diary/diary-care';
import {
  createDiaryId,
  type DiaryInvitation,
  type DiaryResults,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { withEntry } from '@/features/diary/diary-storage';

/** One intake a reminder is about. */
export interface ReminderDose {
  readonly item: string;
  /** The intake's time `HH:MM`, as the dose mark records it. */
  readonly slot: string;
  readonly name: string;
  readonly dose?: string;
}

/** Everything due at one moment of one day. */
export interface ReminderSlot {
  /** The moment, ISO. */
  readonly at: string;
  readonly doses: readonly ReminderDose[];
  /** Labels of the timed checkpoints (wellbeing, vitals…) due then. */
  readonly checks: readonly string[];
}

/** What the worker shows for a moment. */
export interface ReminderNotice {
  readonly at: string;
  readonly title: string;
  readonly body: string;
  /** What «Принял» marks; empty when only checkpoints are due. */
  readonly doses: readonly { readonly item: string; readonly slot: string }[];
}

/** «Принял» pressed in a notification: the diary marks these intakes taken at `takenAt`. */
export interface ReminderAction {
  readonly diary: string;
  readonly at: string;
  readonly takenAt: string;
  readonly doses: readonly { readonly item: string; readonly slot: string }[];
}

/**
 * The open timed tasks of the next days, grouped by moment, soonest first. Intakes and
 * checkpoints already marked are left out, so a ticked intake rings no more.
 */
export function reminderSlots(
  invitation: DiaryInvitation,
  entries: DiaryResults['entries'],
  now: Date = new Date(),
  days: number = DIARY_REMINDER_DAYS,
): ReminderSlot[] {
  const slots = new Map<string, { doses: ReminderDose[]; checks: string[] }>();
  const slotAt = (at: string) => {
    let slot = slots.get(at);
    if (!slot) {
      slot = { doses: [], checks: [] };
      slots.set(at, slot);
    }
    return slot;
  };
  const today = dayKey(now);
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(today, offset);
    const plan = dayPlan(invitation, entries, day, now);
    for (const task of plan.doses) {
      if (task.state === 'done' || task.state === 'skipped') continue;
      const at = atTime(day, task.time.time);
      if (Date.parse(at) <= now.getTime()) continue;
      const dose = task.time.dose ?? task.item.dose;
      slotAt(at).doses.push({
        item: task.item.id,
        slot: task.time.time,
        name: task.item.name,
        ...(dose ? { dose } : {}),
      });
    }
    for (const task of plan.checks) {
      if (task.state === 'done' || task.time === undefined) continue;
      const at = atTime(day, task.time);
      if (Date.parse(at) <= now.getTime()) continue;
      slotAt(at).checks.push(task.checkpoint.label);
    }
  }
  return [...slots]
    .map(([at, slot]) => ({ at, ...slot }))
    .toSorted((left, right) => left.at.localeCompare(right.at))
    .slice(0, DIARY_REMINDER_MAX);
}

/** The moments the server needs, nothing else. */
export function reminderMoments(slots: readonly ReminderSlot[]): string[] {
  return slots.map((slot) => slot.at);
}

/**
 * The notification texts. Medicine names show on the lock screen only when the patient asked for
 * them (`names`); otherwise the text says «приём лекарств».
 */
export function reminderNotices(slots: readonly ReminderSlot[], names: boolean): ReminderNotice[] {
  return slots.map((slot) => {
    const medicines = names
      ? slot.doses.map((dose) => (dose.dose ? `${dose.name} ${dose.dose}` : dose.name))
      : slot.doses.length
        ? ['Приём лекарств']
        : [];
    return {
      at: slot.at,
      title: slot.doses.length ? 'Пора принять лекарство' : 'Пора сделать отметку',
      body: [...medicines, ...slot.checks].join(' · '),
      doses: slot.doses.map(({ item, slot: time }) => ({ item, slot: time })),
    };
  });
}

/**
 * Marks the intakes of a «Принял» from a notification, unless the patient marked them meanwhile.
 * Intakes no longer in the plan are skipped.
 */
export function applyReminderAction(results: DiaryResults, action: ReminderAction): DiaryResults {
  const day = dayKey(action.at);
  const plan = dayPlan(results.invitation, results.entries, day, new Date(action.takenAt));
  // Pressed after midnight: the mark stays on the reminder's day, at its moment.
  const at = dayKey(action.takenAt) === day ? action.takenAt : action.at;
  let next = results;
  for (const dose of action.doses) {
    const task = plan.doses.find(
      (candidate) => candidate.item.id === dose.item && candidate.time.time === dose.slot,
    );
    if (!task || task.entry) continue;
    next = withEntry(
      next,
      parseDiaryEntry(results.invitation, {
        id: createDiaryId(),
        at,
        values: { [CARE_DOSE_FIELD]: { item: dose.item, done: true, slot: dose.slot } },
      }),
    );
  }
  return next;
}
