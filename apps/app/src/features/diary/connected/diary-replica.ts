/**
 * What the encrypted records of a connected diary mean, and the diary they add up to. A record id
 * names one thing (`plan`, `profile`, `consent`, `e-<entry id>`, `read-<tip id>`); its latest
 * revision wins. Payloads are validated here because they come from another device.
 */
import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  DiaryFormatError,
  type DiaryInvitation,
  type DiaryResults,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

export const PLAN_RECORD = 'plan';
export const PROFILE_RECORD = 'profile';
export const CONSENT_RECORD = 'consent';

export function entryRecordId(entryId: string): string {
  return `e-${entryId}`;
}

export function tipReadRecordId(tipId: string): string {
  return `read-${tipId}`;
}

/** The doctor's label for a patient (pseudonym, emoji). Encrypted like everything else. */
export interface DiaryProfile {
  readonly label: string;
  readonly emoji?: string;
}

export type DiaryPayload =
  | { readonly kind: 'plan'; readonly invitation: unknown }
  | { readonly kind: 'profile'; readonly label: string; readonly emoji?: string }
  | { readonly kind: 'entry'; readonly entry: unknown }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'consent'; readonly at: string; readonly version: string }
  | { readonly kind: 'tip-read'; readonly tip: string; readonly at: string };

/** One decrypted record revision as the sync session hands it over. */
export interface DiaryRecordRevision {
  readonly id: string;
  readonly rev: number;
  readonly author: string;
  /** Server time the revision arrived. */
  readonly at: string;
  readonly payload: unknown;
}

export interface DiaryReplica {
  readonly invitation: DiaryInvitation | undefined;
  readonly profile: DiaryProfile | undefined;
  /** Entry id → entry, without deleted ones. */
  readonly entries: ReadonlyMap<string, DiaryEntry>;
  /** Entry id → who wrote its latest revision (`d:` doctor, `p:` device). */
  readonly entryAuthors: ReadonlyMap<string, string>;
  readonly tipsRead: ReadonlySet<string>;
  readonly consentAt: string | undefined;
  /** Record id → latest revision applied. */
  readonly revs: ReadonlyMap<string, number>;
  /** Records that could not be read (bad payload); kept out of the diary. */
  readonly rejected: number;
}

export const EMPTY_REPLICA: DiaryReplica = {
  invitation: undefined,
  profile: undefined,
  entries: new Map(),
  entryAuthors: new Map(),
  tipsRead: new Set(),
  consentAt: undefined,
  revs: new Map(),
  rejected: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Applies revisions in server order; an older revision than the one applied is ignored. */
export function applyRevisions(
  replica: DiaryReplica,
  revisions: readonly DiaryRecordRevision[],
): DiaryReplica {
  let invitation = replica.invitation;
  let profile = replica.profile;
  let consentAt = replica.consentAt;
  let rejected = replica.rejected;
  const entries = new Map(replica.entries);
  const entryAuthors = new Map(replica.entryAuthors);
  const tipsRead = new Set(replica.tipsRead);
  const revs = new Map(replica.revs);
  // Plans first: entries are validated against the plan they answer.
  const ordered = [
    ...revisions.filter((revision) => revision.id === PLAN_RECORD),
    ...revisions.filter((revision) => revision.id !== PLAN_RECORD),
  ];
  for (const revision of ordered) {
    if ((revs.get(revision.id) ?? 0) >= revision.rev) continue;
    const payload = revision.payload;
    try {
      if (!isRecord(payload)) throw new DiaryFormatError('Запись без содержимого.');
      if (revision.id === PLAN_RECORD && payload['kind'] === 'plan') {
        // Only a doctor writes the plan.
        if (!revision.author.startsWith('d:')) throw new DiaryFormatError('План не от врача.');
        invitation = parseDiaryInvitation(payload['invitation']);
      } else if (revision.id === PROFILE_RECORD && payload['kind'] === 'profile') {
        if (!revision.author.startsWith('d:')) throw new DiaryFormatError('Профиль не от врача.');
        const label = payload['label'];
        const emoji = payload['emoji'];
        if (typeof label !== 'string' || label.length > 120) throw new DiaryFormatError('Профиль.');
        profile = {
          label,
          ...(typeof emoji === 'string' && emoji.length <= 16 ? { emoji } : {}),
        };
      } else if (revision.id === CONSENT_RECORD && payload['kind'] === 'consent') {
        if (typeof payload['at'] !== 'string') throw new DiaryFormatError('Согласие.');
        consentAt = payload['at'];
      } else if (revision.id.startsWith('read-') && payload['kind'] === 'tip-read') {
        if (typeof payload['tip'] !== 'string') throw new DiaryFormatError('Подсказка.');
        tipsRead.add(payload['tip']);
      } else if (revision.id.startsWith('e-')) {
        const entryId = revision.id.slice(2);
        if (payload['kind'] === 'deleted') {
          entries.delete(entryId);
          entryAuthors.delete(entryId);
        } else if (payload['kind'] === 'entry') {
          if (!invitation) throw new DiaryFormatError('Запись пришла раньше плана.');
          const entry = parseDiaryEntry(invitation, payload['entry']);
          if (entry.id !== entryId) throw new DiaryFormatError('Запись не совпадает с ключом.');
          entries.set(entryId, entry);
          entryAuthors.set(entryId, revision.author);
        } else {
          throw new DiaryFormatError('Неизвестная запись.');
        }
      } else {
        throw new DiaryFormatError('Неизвестная запись.');
      }
      revs.set(revision.id, revision.rev);
    } catch (cause) {
      if (!(cause instanceof DiaryFormatError)) throw cause;
      rejected += 1;
      revs.set(revision.id, revision.rev);
    }
  }
  return { invitation, profile, entries, entryAuthors, tipsRead, consentAt, revs, rejected };
}

/** The diary in the shape every existing screen reads. */
export function replicaResults(replica: DiaryReplica): DiaryResults | undefined {
  if (!replica.invitation) return undefined;
  return {
    v: DIARY_FORMAT_VERSION,
    invitation: replica.invitation,
    entries: [...replica.entries.values()].toSorted((left, right) =>
      left.at.localeCompare(right.at),
    ),
  };
}
