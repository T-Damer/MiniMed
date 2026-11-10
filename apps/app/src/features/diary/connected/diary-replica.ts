/**
 * What the encrypted records of a connected diary mean, and the diary they add up to. A record id
 * names one thing (`plan`, `profile`, `consent`, `e-<entry id>`, `read-<tip id>`, a carer's
 * `member-<device id>`); its latest
 * revision wins. Payloads are validated here because they come from another device.
 */

import { memberName } from '@/features/diary/connected/carer';
import {
  type JoiningAcceptance,
  parseJoiningAcceptances,
} from '@/features/diary/consent/joining-documents';
import { parseStudyAnswer, type StudyAnswer } from '@/features/diary/consent/study-consent';
import {
  authorMatches,
  isPastMedRecord,
  PAST_MED_RECORD_PREFIX,
  PastMedFormatError,
  type PastMedication,
  parsePastMedication,
  sortPastMedications,
} from '@/features/diary/diary-med-history';
import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  DiaryFormatError,
  type DiaryInvitation,
  type DiaryResults,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { isVisitRecord, parseVisitScaleEntry } from '@/features/diary/diary-visit-scales';

export const PLAN_RECORD = 'plan';
export const PROFILE_RECORD = 'profile';
export const CONSENT_RECORD = 'consent';

export function entryRecordId(entryId: string): string {
  return `e-${entryId}`;
}

export function tipReadRecordId(tipId: string): string {
  return `read-${tipId}`;
}

/**
 * The doctor's label for a patient (pseudonym, emoji) and, when the doctor wrote it down, the
 * patient's phone to call back. Encrypted like everything else.
 */
export interface DiaryProfile {
  readonly label: string;
  readonly emoji?: string;
  readonly phone?: string;
  /** `YYYY-MM-DD`, when the doctor wrote it down (owner 2026-10-28: optional). */
  readonly birthDate?: string;
  /** Moved out of the doctor's working list; nothing else changes. */
  readonly archived?: boolean;
}

const PHONE_PATTERN = /^\+?[\d\s()-]{5,24}$/u;

/** A phone number as the doctor may type it: digits, spaces, brackets, dashes, a leading +. */
export function isDiaryPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

/** A real calendar day `YYYY-MM-DD` from 1900 up to today. */
export function isDiaryBirthDate(value: string, today: Date = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return real && year >= 1900 && value <= todayKey;
}

export type DiaryPayload =
  | { readonly kind: 'plan'; readonly invitation: unknown }
  | ({ readonly kind: 'profile' } & DiaryProfile)
  | { readonly kind: 'entry'; readonly entry: unknown }
  | { readonly kind: 'deleted' }
  | {
      readonly kind: 'consent';
      readonly at: string;
      readonly version: string;
      readonly documents?: readonly JoiningAcceptance[];
      /** The patient's answer about the study of the plan, if the plan names one. */
      readonly study?: StudyAnswer;
    }
  | { readonly kind: 'visit-scale'; readonly entry: unknown }
  | { readonly kind: 'tip-read'; readonly tip: string; readonly at: string }
  | { readonly kind: 'member'; readonly name: string }
  | { readonly kind: 'past-med'; readonly item: unknown };

/** One decrypted record revision as the sync session hands it over. */
export interface DiaryRecordRevision {
  readonly id: string;
  readonly rev: number;
  readonly author: string;
  /** Server time the revision arrived. */
  readonly at: string;
  readonly payload: unknown;
}

/** One version of the plan as a doctor saved it (DIARY20: the calendar shows who changed what). */
export interface DiaryPlanRevision {
  readonly rev: number;
  /** `d:<doctor id>`. */
  readonly author: string;
  /** Server time the version arrived. */
  readonly at: string;
  readonly invitation: DiaryInvitation;
}

/** Plan versions kept on the device: a long-running diary keeps its newest ones. */
export const MAX_PLAN_HISTORY = 200;

export interface DiaryReplica {
  readonly invitation: DiaryInvitation | undefined;
  /** Every plan version read, oldest first (the last one is `invitation`). */
  readonly planHistory: readonly DiaryPlanRevision[];
  readonly profile: DiaryProfile | undefined;
  /** Entry id → entry, without deleted ones. */
  readonly entries: ReadonlyMap<string, DiaryEntry>;
  /** Entry id → who wrote its latest revision (`d:` doctor, `p:` device). */
  readonly entryAuthors: ReadonlyMap<string, string>;
  readonly tipsRead: ReadonlySet<string>;
  /** Carer's device id → the name the carer gave (DIARY25); copies saved before have none. */
  readonly carerNames?: Readonly<Record<string, string>>;
  readonly consentAt: string | undefined;
  /** The joining documents the patient accepted, with wording and time (none before DIARY26). */
  readonly consents?: readonly JoiningAcceptance[];
  /** The patient's latest answer about the plan's study (accepted, declined, withdrawn). */
  readonly study?: StudyAnswer;
  /** The doctors' ratings at visits, by entry id (never read by the patient's phone). */
  readonly visitScales?: Readonly<Record<string, DiaryEntry>>;
  /** Medicines taken before (MEDHIST1), by id; copies saved before have none. */
  readonly medHistory?: Readonly<Record<string, PastMedication>>;
  /** Record id → latest revision applied. */
  readonly revs: ReadonlyMap<string, number>;
  /** Records that could not be read (bad payload); kept out of the diary. */
  readonly rejected: number;
}

export const EMPTY_REPLICA: DiaryReplica = {
  invitation: undefined,
  planHistory: [],
  profile: undefined,
  entries: new Map(),
  entryAuthors: new Map(),
  tipsRead: new Set(),
  carerNames: {},
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
  // Copies saved before plan versions were kept have none.
  const planHistory = [...(replica.planHistory ?? [])];
  let profile = replica.profile;
  let consentAt = replica.consentAt;
  let consents = replica.consents ?? [];
  let study = replica.study;
  let rejected = replica.rejected;
  const entries = new Map(replica.entries);
  const entryAuthors = new Map(replica.entryAuthors);
  const tipsRead = new Set(replica.tipsRead);
  const carerNames: Record<string, string> = { ...replica.carerNames };
  const medHistory: Record<string, PastMedication> = { ...replica.medHistory };
  const visitScales: Record<string, DiaryEntry> = { ...replica.visitScales };
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
        planHistory.push({
          rev: revision.rev,
          author: revision.author,
          at: revision.at,
          invitation,
        });
      } else if (revision.id === PROFILE_RECORD && payload['kind'] === 'profile') {
        if (!revision.author.startsWith('d:')) throw new DiaryFormatError('Профиль не от врача.');
        const label = payload['label'];
        const emoji = payload['emoji'];
        const phone = payload['phone'];
        const birthDate = payload['birthDate'];
        if (typeof label !== 'string' || label.length > 120) throw new DiaryFormatError('Профиль.');
        profile = {
          label,
          ...(typeof emoji === 'string' && emoji.length <= 16 ? { emoji } : {}),
          ...(typeof phone === 'string' && isDiaryPhone(phone) ? { phone: phone.trim() } : {}),
          ...(typeof birthDate === 'string' && isDiaryBirthDate(birthDate) ? { birthDate } : {}),
          ...(payload['archived'] === true ? { archived: true } : {}),
        };
      } else if (revision.id === CONSENT_RECORD && payload['kind'] === 'consent') {
        if (typeof payload['at'] !== 'string') throw new DiaryFormatError('Согласие.');
        if (!revision.author.startsWith('p:'))
          throw new DiaryFormatError('Согласие не с телефона.');
        const accepted = parseJoiningAcceptances(payload['documents']);
        const answer = parseStudyAnswer(payload['study']);
        // A record that only carries the study answer (no joining documents) is not their consent.
        if (accepted.length > 0 || payload['study'] === undefined) {
          consentAt = payload['at'];
          consents = accepted;
        }
        // A record without the key (written by a phone that does not know studies) keeps it.
        study = answer ?? study;
      } else if (revision.id.startsWith('read-') && payload['kind'] === 'tip-read') {
        if (typeof payload['tip'] !== 'string') throw new DiaryFormatError('Подсказка.');
        tipsRead.add(payload['tip']);
      } else if (revision.id.startsWith('member-')) {
        const name = memberName(revision.id, revision.author, payload);
        if (!name) throw new DiaryFormatError('Имя опекуна.');
        carerNames[revision.id.slice(7)] = name;
      } else if (isPastMedRecord(revision.id)) {
        // Patient, carer and doctors all write the history; the item says who, and must agree.
        const itemId = revision.id.slice(PAST_MED_RECORD_PREFIX.length);
        if (payload['kind'] === 'deleted') {
          delete medHistory[itemId];
        } else if (payload['kind'] === 'past-med') {
          let item: PastMedication;
          try {
            item = parsePastMedication(payload['item']);
          } catch (cause) {
            if (cause instanceof PastMedFormatError) throw new DiaryFormatError(cause.message);
            throw cause;
          }
          if (item.id !== itemId) throw new DiaryFormatError('Препарат не совпадает с ключом.');
          if (!authorMatches(item, revision.author)) {
            throw new DiaryFormatError('Автор препарата не совпадает.');
          }
          medHistory[itemId] = item;
        } else {
          throw new DiaryFormatError('Неизвестная запись.');
        }
      } else if (isVisitRecord(revision.id)) {
        // Only a doctor rates a scale at a visit.
        if (!revision.author.startsWith('d:')) throw new DiaryFormatError('Оценка не от врача.');
        const entryId = revision.id.slice(2);
        if (payload['kind'] === 'deleted') {
          delete visitScales[entryId];
        } else if (payload['kind'] === 'visit-scale') {
          if (!invitation) throw new DiaryFormatError('Оценка пришла раньше плана.');
          const entry = parseVisitScaleEntry(invitation, payload['entry']);
          if (entry.id !== entryId) throw new DiaryFormatError('Оценка не совпадает с ключом.');
          visitScales[entryId] = entry;
        } else {
          throw new DiaryFormatError('Неизвестная запись.');
        }
      } else if (revision.id.startsWith('e-')) {
        const entryId = revision.id.slice(2);
        if (payload['kind'] === 'deleted') {
          entries.delete(entryId);
          entryAuthors.delete(entryId);
        } else if (payload['kind'] === 'entry') {
          if (!invitation) throw new DiaryFormatError('Запись пришла раньше плана.');
          const entry = parseDiaryEntry(invitation, payload['entry']);
          if (entry.id !== entryId) throw new DiaryFormatError('Запись не совпадает с ключом.');
          if (entry.visitScale) throw new DiaryFormatError('Оценка врача не в записях пациента.');
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
      // A refused revision does not move the id on (SEC-AUDIT1): otherwise a phone's plan at a
      // huge revision would hide every later plan of the doctors.
      rejected += 1;
    }
  }
  return {
    invitation,
    planHistory: planHistory.slice(-MAX_PLAN_HISTORY),
    profile,
    entries,
    entryAuthors,
    tipsRead,
    carerNames,
    medHistory,
    consentAt,
    ...(consents.length ? { consents } : {}),
    ...(study ? { study } : {}),
    ...(Object.keys(visitScales).length ? { visitScales } : {}),
    revs,
    rejected,
  };
}

/** The diary in the shape every existing screen reads. */
export function replicaResults(replica: DiaryReplica): DiaryResults | undefined {
  if (!replica.invitation) return undefined;
  const medHistory = sortPastMedications(Object.values(replica.medHistory ?? {}));
  return {
    v: DIARY_FORMAT_VERSION,
    invitation: replica.invitation,
    entries: [...replica.entries.values()].toSorted((left, right) =>
      left.at.localeCompare(right.at),
    ),
    ...(medHistory.length ? { medHistory } : {}),
  };
}
