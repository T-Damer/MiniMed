/**
 * What a new plan from the doctor changed, in the patient's words (DIARY19): the patient's phone
 * applies a new plan silently, so the diary keeps these lines and shows them once on «Сегодня»
 * until the patient closes them. Tips are left out: each new tip already carries its own «?».
 */
import {
  DIARY_MEAL_LABEL,
  type DiaryInvitation,
  type DiaryPlanItem,
} from '@/features/diary/diary-model';
import { visitChanges } from '@/features/diary/diary-visits';

/** Lines kept at most: a long run of edits keeps its newest lines. */
export const MAX_PLAN_CHANGE_LINES = 12;

/** A plan change the patient has not closed yet. */
export interface DiaryPlanChange {
  /** When the newest change arrived (ISO). */
  readonly at: string;
  readonly lines: readonly string[];
}

function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}.${month}`;
}

function itemName(item: DiaryPlanItem): string {
  return [item.name, item.dose].filter(Boolean).join(' ');
}

/** When the item is taken: «08:00, 20:00 (½ табл.)», «при необходимости» or the doctor's words. */
function intakeText(item: DiaryPlanItem): string {
  if (item.asNeeded) return 'при необходимости';
  if (item.times?.length) {
    return item.times
      .map((time) =>
        [
          time.time,
          time.meal ? DIARY_MEAL_LABEL[time.meal] : '',
          time.dose && time.dose !== item.dose ? `(${time.dose})` : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      .join(', ');
  }
  return item.schedule ?? '';
}

function courseText(item: DiaryPlanItem): string {
  if (!item.course?.length) return 'без даты окончания';
  return item.course
    .map((range) =>
      range.from === range.to
        ? shortDay(range.from)
        : `${shortDay(range.from)}–${shortDay(range.to)}`,
    )
    .join(', ');
}

function itemChanges(before: DiaryPlanItem, after: DiaryPlanItem): string[] {
  const lines: string[] = [];
  if ((before.dose ?? '') !== (after.dose ?? '')) {
    lines.push(`${after.name}: ${before.dose || 'без дозы'} → ${after.dose || 'без дозы'}`);
  }
  const was = intakeText(before);
  const now = intakeText(after);
  if (was !== now) lines.push(`${after.name}: приём ${now || 'без расписания'}`);
  if (JSON.stringify(before.course ?? []) !== JSON.stringify(after.course ?? [])) {
    lines.push(`${after.name}: курс ${courseText(after)}`);
  }
  if ((before.signa ?? '') !== (after.signa ?? '') && after.signa) {
    lines.push(`${after.name}: ${after.signa}`);
  }
  if ((before.form ?? '') !== (after.form ?? '') && after.form) {
    lines.push(`${after.name}: ${after.form}`);
  }
  return lines;
}

/** Everything but the tips and the issue time, to tell a real change from a tip-only one. */
function withoutTips({ tips: _tips, issuedAt: _issued, ...rest }: DiaryInvitation): string {
  return JSON.stringify(rest);
}

/** The patient-facing lines for a plan replacing `before`; empty when nothing they see changed. */
export function planChanges(before: DiaryInvitation, after: DiaryInvitation): string[] {
  const lines: string[] = [];
  const old = new Map((before.plan ?? []).map((item) => [item.id, item]));
  const current = new Set((after.plan ?? []).map((item) => item.id));
  for (const item of after.plan ?? []) {
    const previous = old.get(item.id);
    if (!previous || previous.ended) {
      if (!item.ended) lines.push(`Новое: ${itemName(item)}`);
      continue;
    }
    if (item.ended) {
      lines.push(`Отменено: ${previous.name}`);
      continue;
    }
    lines.push(...itemChanges(previous, item));
  }
  for (const item of before.plan ?? []) {
    if (!current.has(item.id) && !item.ended) lines.push(`Отменено: ${item.name}`);
  }

  const checks = new Map((before.checkpoints ?? []).map((check) => [check.id, check]));
  const nextChecks = new Set((after.checkpoints ?? []).map((check) => check.id));
  for (const check of after.checkpoints ?? []) {
    const previous = checks.get(check.id);
    if (!previous) lines.push(`Новая отметка: ${check.label}`);
    else if ((previous.times ?? []).join() !== (check.times ?? []).join()) {
      lines.push(`${check.label}: ${check.times?.length ? check.times.join(', ') : 'раз в день'}`);
    }
  }
  for (const check of before.checkpoints ?? []) {
    if (!nextChecks.has(check.id)) lines.push(`Больше не нужно: ${check.label}`);
  }

  // CBT1: worksheets given, changed and taken off.
  const tasks = new Map((before.assignments ?? []).map((task) => [task.id, task]));
  for (const task of after.assignments ?? []) {
    const previous = tasks.get(task.id);
    const title = task.worksheet.title;
    if (task.ended) {
      if (previous && !previous.ended) lines.push(`Задание завершено: ${title}`);
    } else if (!previous || previous.ended) {
      lines.push(`Новое задание: ${title}`);
    } else if (JSON.stringify(previous) !== JSON.stringify(task)) {
      lines.push(`Задание изменено: ${title}`);
    }
  }
  lines.push(...visitChanges(before, after));
  if ((after.note ?? '') !== (before.note ?? '') && after.note) lines.push('Новая заметка врача');
  if (JSON.stringify(after.contacts ?? []) !== JSON.stringify(before.contacts ?? [])) {
    lines.push('Контакты врача обновлены');
  }
  if (!lines.length && withoutTips(before) !== withoutTips(after)) {
    lines.push('Врач обновил дневник');
  }
  return lines;
}

/** Adds new lines to a change not yet closed; repeated lines are kept once, the newest last. */
export function mergePlanChange(
  open: DiaryPlanChange | undefined,
  lines: readonly string[],
  at: string,
): DiaryPlanChange | undefined {
  if (!lines.length) return open;
  const merged = [...(open?.lines ?? []).filter((line) => !lines.includes(line)), ...lines];
  return { at, lines: merged.slice(-MAX_PLAN_CHANGE_LINES) };
}
