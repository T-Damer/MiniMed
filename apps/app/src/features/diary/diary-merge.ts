import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryPlanItem,
  type DiaryResults,
  parseDiaryEntry,
} from '@/features/diary/diary-model';

/**
 * What a link or a saved copy of the same diary does to the diary already on this device.
 * The patient's entries are never discarded: a link only ever refreshes the doctor's header.
 */
export type InvitationMergeOutcome =
  /** First time this diary is seen on the device. */
  | 'new'
  /** Same diary, nothing changed (the link was opened again). */
  | 'same'
  /** The doctor sent a newer version (a changed plan, instruction or title). */
  | 'updated'
  /** The link is older than the diary already stored; the stored version is kept. */
  | 'older'
  /** The link carries the same id but fields the stored entries do not fit; stored version is kept. */
  | 'incompatible';

export interface InvitationMerge {
  readonly invitation: DiaryInvitation;
  readonly outcome: InvitationMergeOutcome;
}

function withoutIssueTime(invitation: DiaryInvitation): string {
  const { issuedAt: _issuedAt, ...rest } = invitation;
  return JSON.stringify(rest);
}

/** Plan items of the new link, plus old items that entries still point at (marked ended). */
function mergedPlan(
  existing: DiaryInvitation,
  incoming: DiaryInvitation,
  entries: readonly DiaryEntry[],
): readonly DiaryPlanItem[] | undefined {
  const referenced = new Set<string>();
  for (const entry of entries) {
    for (const value of Object.values(entry.values)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const item = (value as { readonly item?: unknown }).item;
        if (typeof item === 'string') referenced.add(item);
      }
    }
  }
  const kept = incoming.plan ?? [];
  const keptIds = new Set(kept.map((item) => item.id));
  const retired = (existing.plan ?? [])
    .filter((item) => referenced.has(item.id) && !keptIds.has(item.id))
    .map((item) => ({ ...item, ended: true }));
  const all = [...kept, ...retired];
  return all.length > 0 ? all : undefined;
}

function fits(invitation: DiaryInvitation, entries: readonly DiaryEntry[]): boolean {
  try {
    for (const entry of entries) parseDiaryEntry(invitation, entry);
    return true;
  } catch {
    return false;
  }
}

export function mergeInvitation(
  existing: DiaryInvitation | undefined,
  incoming: DiaryInvitation,
  entries: readonly DiaryEntry[],
): InvitationMerge {
  if (!existing) return { invitation: incoming, outcome: 'new' };
  if (incoming.issuedAt < existing.issuedAt) return { invitation: existing, outcome: 'older' };
  const plan = mergedPlan(existing, incoming, entries);
  const { plan: _plan, ...rest } = incoming;
  const merged: DiaryInvitation = { ...rest, ...(plan ? { plan } : {}) };
  if (!fits(merged, entries)) return { invitation: existing, outcome: 'incompatible' };
  const unchanged = withoutIssueTime(existing) === withoutIssueTime(merged);
  return { invitation: merged, outcome: unchanged ? 'same' : 'updated' };
}

export interface ResultsMerge {
  readonly results: DiaryResults;
  readonly added: number;
  /** Entries present on both sides with different content: the copy on this device wins. */
  readonly kept: number;
  /** Entries of the copy that do not fit the header kept on this device (not added). */
  readonly skipped: number;
  readonly outcome: InvitationMergeOutcome;
}

/** Adds the entries of a saved copy to a diary on this device; same id and content is a no-op. */
export function mergeResults(
  existing: DiaryResults | undefined,
  incoming: DiaryResults,
): ResultsMerge {
  if (!existing) {
    return {
      results: incoming,
      added: incoming.entries.length,
      kept: 0,
      skipped: 0,
      outcome: 'new',
    };
  }
  const known = new Map(existing.entries.map((entry) => [entry.id, entry]));
  const fresh = incoming.entries.filter((entry) => !known.has(entry.id));
  const kept = incoming.entries.filter((entry) => {
    const local = known.get(entry.id);
    return local !== undefined && JSON.stringify(local) !== JSON.stringify(entry);
  }).length;
  const entries = [...existing.entries, ...fresh];
  const header = mergeInvitation(existing.invitation, incoming.invitation, entries);
  // Entries of the copy must also fit the header that survives the merge.
  const usable = fresh.filter((entry) => fits(header.invitation, [entry]));
  return {
    results: {
      v: DIARY_FORMAT_VERSION,
      invitation: header.invitation,
      entries: [...existing.entries, ...usable].toSorted((left, right) =>
        left.at.localeCompare(right.at),
      ),
    },
    added: usable.length,
    kept,
    skipped: fresh.length - usable.length,
    outcome: header.outcome,
  };
}

// --- What the doctor has already received -------------------------------------------------------

/** Cheap stable fingerprint of what the doctor would see for an entry. */
export function entryFingerprint(entry: DiaryEntry): string {
  const text = JSON.stringify([entry.at, entry.values, entry.note ?? '']);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export interface DiarySent {
  /** ISO time of the last confirmed hand-over. */
  readonly at: string;
  /** Fingerprint of every entry as it was when handed over. */
  readonly entries: Readonly<Record<string, string>>;
}

export interface DiaryShareStatus {
  readonly total: number;
  /** Entries never handed over. */
  readonly unsent: number;
  /** Entries edited after they were handed over. */
  readonly changed: number;
  readonly sentAt: string | undefined;
}

export function shareStatus(
  entries: readonly DiaryEntry[],
  sent: DiarySent | undefined,
): DiaryShareStatus {
  let unsent = 0;
  let changed = 0;
  for (const entry of entries) {
    const known = sent?.entries[entry.id];
    if (known === undefined) unsent += 1;
    else if (known !== entryFingerprint(entry)) changed += 1;
  }
  return { total: entries.length, unsent, changed, sentAt: sent?.at };
}

export function markAllSent(entries: readonly DiaryEntry[], now: string): DiarySent {
  return {
    at: now,
    entries: Object.fromEntries(entries.map((entry) => [entry.id, entryFingerprint(entry)])),
  };
}
