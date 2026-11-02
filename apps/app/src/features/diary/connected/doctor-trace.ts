/**
 * What the patient's phone keeps of the doctor's edits (DIARY19): a deleted mark stays visible as
 * removed, and a new plan leaves a «what changed» note until the patient closes it. Pure, so the
 * sync (`patient-connection.ts`) only gathers what a pull brought and stores the result.
 */
import { CARE_DOSE_FIELD } from '@/features/diary/diary-care';
import {
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryPlanValue,
  describeDiaryEntry,
} from '@/features/diary/diary-model';
import {
  type DiaryMeta,
  type DiaryMetaPatch,
  type DiaryRemoval,
  MAX_DIARY_REMOVALS,
} from '@/features/diary/diary-storage';
import { mergePlanChange, planChanges } from '@/features/diary/plan-changes';

/** How a mark the doctor deleted is remembered: its words and time, and the intake it answered. */
export function removalOf(
  invitation: DiaryInvitation,
  entry: DiaryEntry,
  removedAt: string,
): DiaryRemoval {
  const mark = entry.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
  return {
    id: entry.id,
    at: entry.at,
    line: describeDiaryEntry(invitation, entry),
    ...(mark?.item ? { item: mark.item } : {}),
    ...(mark?.slot ? { slot: mark.slot } : {}),
    removedAt,
  };
}

export interface PulledDoctorEdits {
  /** The plan before the pull (absent on a fresh phone: it is told nothing). */
  readonly planBefore: DiaryInvitation | undefined;
  readonly planAfter: DiaryInvitation | undefined;
  /** Marks the doctor deleted in this pull. */
  readonly removals: readonly DiaryRemoval[];
  /** Entries a revision in this pull brought back: no longer shown as removed. */
  readonly restored: ReadonlySet<string>;
  readonly at: string;
}

/** The meta update a pull calls for; `undefined` when the patient sees nothing new. */
export function doctorTrace(
  meta: DiaryMeta,
  pulled: PulledDoctorEdits,
): DiaryMetaPatch | undefined {
  const lines =
    pulled.planBefore && pulled.planAfter ? planChanges(pulled.planBefore, pulled.planAfter) : [];
  const planChange = mergePlanChange(meta.planChange, lines, pulled.at);
  const before = meta.removedByDoctor ?? [];
  const kept = before.filter(
    (removal) =>
      !pulled.restored.has(removal.id) && !pulled.removals.some((next) => next.id === removal.id),
  );
  const removalsChanged = pulled.removals.length > 0 || kept.length !== before.length;
  if (planChange === meta.planChange && !removalsChanged) return undefined;
  return {
    ...(planChange === meta.planChange ? {} : { planChange }),
    ...(removalsChanged
      ? { removedByDoctor: [...kept, ...pulled.removals].slice(-MAX_DIARY_REMOVALS) }
      : {}),
  };
}
