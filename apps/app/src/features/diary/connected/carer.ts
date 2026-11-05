/**
 * Carers of a connected diary (DIARY25, owner 2026-11-04). The doctor adds a carer (опекун) with the
 * patient's consent; the carer's phone pairs like a second patient phone, reads and marks the whole
 * diary, and names itself in an encrypted `member-<device id>` record, so the patient and the
 * doctor see who made each mark. The patient's phone lists everyone with access and removes a
 * carer; while a carer is there, the phones report dose moments so the service can tell the carer
 * about a dose still unmarked half an hour after its time (`DIARY_MISSED_AFTER_MS`).
 */
import {
  DIARY_MISSED_AFTER_MS,
  DIARY_REMINDER_DAYS,
  DIARY_REMINDER_MAX,
  type DiaryDeviceKind,
  type DiaryPatientDetail,
} from '@localmed/contracts';

import { addDays, atTime, dayKey, dayPlan } from '@/features/diary/diary-care';
import type { DiaryInvitation, DiaryResults } from '@/features/diary/diary-model';

/** The record a phone names itself with; only that phone may write it. */
export function memberRecordId(deviceId: string): string {
  return `member-${deviceId}`;
}

export const MAX_CARER_NAME = 60;

/** The name a carer types, trimmed; empty when there is nothing to show. */
export function carerName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replaceAll(/\s+/gu, ' ').slice(0, MAX_CARER_NAME)
    : '';
}

/**
 * A `member-<id>` revision's name when its author is that very phone (`p:<id>`); otherwise
 * undefined (a forged or broken record is ignored).
 */
export function memberName(recordId: string, author: string, payload: unknown): string | undefined {
  if (!recordId.startsWith('member-') || author !== `p:${recordId.slice(7)}`) return undefined;
  const record = payload as { kind?: unknown; name?: unknown } | null;
  if (record?.kind !== 'member') return undefined;
  return carerName(record.name) || undefined;
}

/** One phone with access to the diary, as the patient's and the carer's phones show it. */
export interface DiaryPhone {
  readonly id: string;
  readonly kind: DiaryDeviceKind;
  /** This very phone. */
  readonly self: boolean;
  /** The name a carer gave; the patient's phones have none. */
  readonly name: string | undefined;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
}

export function diaryPhones(
  detail: DiaryPatientDetail | undefined,
  names: Readonly<Record<string, string>>,
  selfId: string,
): DiaryPhone[] {
  return (detail?.devices ?? [])
    .map((device) => ({
      id: device.id,
      kind: device.kind,
      self: device.id === selfId,
      name: names[device.id],
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
    }))
    .toSorted(
      (left, right) =>
        Number(left.kind === 'carer') - Number(right.kind === 'carer') ||
        left.createdAt.localeCompare(right.createdAt),
    );
}

/** How a carer is called in a line: «опекун Ирина», or just «опекун» before they named themselves. */
export function carerLabel(name: string | undefined): string {
  return name ? `опекун ${name}` : 'опекун';
}

/**
 * Who made a mark, in the words of the phone showing it, or undefined when it needs no remark:
 * the diary has no carer and the mark is this phone's own or the patient's.
 */
export function markAuthor(
  author: string | undefined,
  phones: readonly DiaryPhone[],
  names: Readonly<Record<string, string>>,
  selfKind: DiaryDeviceKind,
): string | undefined {
  const withCarer = phones.some((phone) => phone.kind === 'carer');
  if (author?.startsWith('d:')) return 'врач';
  const deviceId = author?.startsWith('p:') ? author.slice(2) : undefined;
  const self = phones.find((phone) => phone.self);
  if (deviceId === undefined || deviceId === self?.id) {
    return withCarer || selfKind === 'carer' ? 'вы' : undefined;
  }
  const phone = phones.find((candidate) => candidate.id === deviceId);
  const kind = phone?.kind ?? (names[deviceId] ? 'carer' : 'patient');
  if (kind === 'carer') return carerLabel(names[deviceId]);
  return selfKind === 'carer' ? 'пациент' : withCarer ? 'вы' : undefined;
}

/** Dose moments for the missed-dose notice: not all taken (from 30 minutes ago), all taken (from a day ago). */
export interface DoseMoments {
  readonly open: readonly string[];
  readonly taken: readonly string[];
}

const TAKEN_WINDOW_MS = 24 * 3_600_000;

/**
 * Every scheduled intake moment from yesterday over the reminder days, split by whether all its
 * doses are marked taken. A dose marked skipped counts as not taken: the carer hears of it too.
 */
export function doseMoments(
  invitation: DiaryInvitation,
  entries: DiaryResults['entries'],
  now: Date = new Date(),
  days: number = DIARY_REMINDER_DAYS,
): DoseMoments {
  const taken = new Map<string, boolean>();
  const today = dayKey(now);
  for (let offset = -1; offset < days; offset += 1) {
    const day = addDays(today, offset);
    for (const task of dayPlan(invitation, entries, day, now).doses) {
      const at = atTime(day, task.time.time);
      taken.set(at, (taken.get(at) ?? true) && task.state === 'done');
    }
  }
  const moments = [...taken].toSorted(([left], [right]) => left.localeCompare(right));
  const openAfter = now.getTime() - DIARY_MISSED_AFTER_MS;
  const takenAfter = now.getTime() - TAKEN_WINDOW_MS;
  return {
    open: moments
      .filter(([at, all]) => !all && Date.parse(at) > openAfter)
      .map(([at]) => at)
      .slice(0, DIARY_REMINDER_MAX),
    taken: moments
      .filter(([at, all]) => all && Date.parse(at) > takenAfter)
      .map(([at]) => at)
      .slice(0, DIARY_REMINDER_MAX),
  };
}

/** The «who marked» line under an entry, from `markAuthor`. */
export function markLine(who: string): string {
  if (who === 'вы') return 'Отметили вы';
  if (who === 'пациент') return 'Отметил пациент';
  if (who === 'врач') return 'Записал врач';
  return `Отметил(а) ${who}`;
}
