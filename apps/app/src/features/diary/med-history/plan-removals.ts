/**
 * Medicines the doctor took off the plan, offered for the history (MEDHIST1): «Сертралин убран из
 * плана — перенести в историю?». Read from the plan versions the replica keeps; a medicine already
 * in the history (by its plan item), put back on the plan, or put aside by the doctor is not offered.
 */
import { createContext, useContext } from 'solid-js';

import { dayKey } from '@/features/diary/diary-care';
import {
  emptyPastMedDraft,
  type PastMedDraft,
  type PastMedication,
  whenInputText,
} from '@/features/diary/diary-med-history';
import type { DiaryInvitation, DiaryPlanItem } from '@/features/diary/diary-model';

export interface PlanRemoval {
  readonly item: DiaryPlanItem;
  /** First day the item was on the plan, `YYYY-MM-DD`. */
  readonly since: string;
  /** Day of the version that took it off. */
  readonly removedOn: string;
}

/** Removals older than this are history already; nobody wants an old prompt. */
export const PLAN_REMOVAL_DAYS = 60;

function activeItems(invitation: DiaryInvitation): Map<string, DiaryPlanItem> {
  return new Map(
    (invitation.plan ?? []).filter((item) => !item.ended).map((item) => [item.id, item]),
  );
}

/** Every plan item that was on the plan and is off it in the newest version, oldest version first. */
export function planRemovals(
  versions: readonly { readonly at: string; readonly invitation: DiaryInvitation }[],
): PlanRemoval[] {
  const firstSeen = new Map<string, string>();
  const removed = new Map<string, PlanRemoval>();
  let before = new Map<string, DiaryPlanItem>();
  for (const version of versions) {
    const day = dayKey(version.at);
    const now = activeItems(version.invitation);
    for (const [id, item] of now) {
      if (!firstSeen.has(id)) {
        const course = item.course?.map((range) => range.from).toSorted()[0];
        firstSeen.set(id, course && course < day ? course : day);
      }
      removed.delete(id);
    }
    for (const [id, item] of before) {
      if (!now.has(id)) removed.set(id, { item, since: firstSeen.get(id) ?? day, removedOn: day });
    }
    before = now;
  }
  return [...removed.values()];
}

/** What to offer now: recent, not in the history, not put aside. */
export function offeredRemovals(
  removals: readonly PlanRemoval[],
  history: readonly PastMedication[],
  dismissed: ReadonlySet<string>,
  today: Date = new Date(),
): PlanRemoval[] {
  const moved = new Set(history.flatMap((item) => (item.planItem ? [item.planItem] : [])));
  const oldest = dayKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - PLAN_REMOVAL_DAYS, 12),
  );
  return removals.filter(
    (removal) =>
      !moved.has(removal.item.id) && !dismissed.has(removal.item.id) && removal.removedOn >= oldest,
  );
}

/** The editor's draft for a removed medicine: name, dose and dates filled in. */
export function draftFromRemoval(removal: PlanRemoval): PastMedDraft {
  return {
    ...emptyPastMedDraft(),
    name: removal.item.name,
    dose: removal.item.dose ?? '',
    fromText: whenInputText(removal.since),
    toText: whenInputText(removal.removedOn),
    planItem: removal.item.id,
  };
}

const DISMISSED_PREFIX = 'minimed.diary.history-offer.v1.';

/** Plan items whose offer the doctor put aside on this device (a convenience, not shared). */
export function readDismissed(patientId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_PREFIX + patientId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch (cause) {
    console.warn('The put-aside history offers could not be read.', cause);
    return new Set();
  }
}

export function writeDismissed(patientId: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(DISMISSED_PREFIX + patientId, JSON.stringify([...ids]));
  } catch (cause) {
    console.warn('The put-aside history offer could not be kept.', cause);
  }
}

/** The patient's history where the plan editor checks a new prescription against it. */
export const MedHistoryContext = createContext<() => readonly PastMedication[]>(() => []);

export function useMedHistory(): () => readonly PastMedication[] {
  return useContext(MedHistoryContext);
}
