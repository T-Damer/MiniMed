/**
 * The plan's versions as the doctor's calendar reads them (DIARY20): which version was in force on
 * a day (charts draw the prescribed dose of that day, a day shows what it asked for then), and
 * which days a doctor changed it, by whom and how (a yellow dot on the calendar day).
 */
import type { DiaryPlanRevision } from '@/features/diary/connected/diary-replica';
import { dayKey } from '@/features/diary/diary-care';
import type { DiaryInvitation } from '@/features/diary/diary-model';
import { planChanges } from '@/features/diary/plan-changes';

export interface PlanEdit {
  readonly at: string;
  /** `d:<doctor id>`. */
  readonly author: string;
  readonly rev: number;
  /** In the patient's words (`planChanges`), tips included; the first version says it began. */
  readonly lines: readonly string[];
  /** The diary's first version (nothing to compare with). */
  readonly first: boolean;
}

/** The version in force at the end of `day`; `fallback` (the current plan) before any is known. */
export function planOn(
  history: readonly DiaryPlanRevision[],
  day: string,
  fallback: DiaryInvitation,
): DiaryInvitation {
  let found: DiaryInvitation | undefined;
  for (const version of history) {
    if (dayKey(version.at) > day) break;
    found = version.invitation;
  }
  // Before the first version read (a pruned history): the oldest one known.
  return found ?? history[0]?.invitation ?? fallback;
}

function tipLines(before: DiaryInvitation, after: DiaryInvitation): string[] {
  const old = new Map((before.tips ?? []).map((tip) => [tip.id, tip.text]));
  const current = new Set((after.tips ?? []).map((tip) => tip.id));
  return [
    ...(after.tips ?? []).flatMap((tip) => {
      const was = old.get(tip.id);
      if (was === undefined) return [`Новая подсказка: ${tip.text}`];
      return was === tip.text ? [] : [`Подсказка изменена: ${tip.text}`];
    }),
    ...[...old].filter(([id]) => !current.has(id)).map(([, text]) => `Подсказка убрана: ${text}`),
  ];
}

/** Every version that changed something, newest last; a save that changed nothing is left out. */
export function planEdits(history: readonly DiaryPlanRevision[]): PlanEdit[] {
  const edits: PlanEdit[] = [];
  history.forEach((version, index) => {
    const before = history[index - 1]?.invitation;
    const lines = before
      ? [...planChanges(before, version.invitation), ...tipLines(before, version.invitation)]
      : ['Дневник начат'];
    if (!lines.length) return;
    edits.push({ at: version.at, author: version.author, rev: version.rev, lines, first: !before });
  });
  return edits;
}

/** Day key → that day's edits, oldest first. */
export function planEditDays(history: readonly DiaryPlanRevision[]): Map<string, PlanEdit[]> {
  const days = new Map<string, PlanEdit[]>();
  for (const edit of planEdits(history)) {
    const day = dayKey(edit.at);
    days.set(day, [...(days.get(day) ?? []), edit]);
  }
  return days;
}
