/**
 * What the doctor's patient page says about the joining documents (DIARY26): accepted and when,
 * still waiting on a paired phone, or nothing while no phone is paired.
 */
import {
  acceptedAll,
  type JoiningAcceptance,
  joiningDocuments,
} from '@/features/diary/consent/joining-documents';

export type ConsentStatus =
  | { readonly kind: 'accepted'; readonly at: string; readonly current: boolean }
  /** Accepted before the documents were listed one by one: only the time is known. */
  | { readonly kind: 'accepted-summary'; readonly at: string }
  | { readonly kind: 'waiting' };

export function consentStatus(input: {
  /** The plan asks the patient to accept the documents (care diaries). */
  readonly asks: boolean;
  readonly consentAt: string | undefined;
  readonly consents: readonly JoiningAcceptance[] | undefined;
  /** Paired phones; with none the patient has not opened the diary yet. */
  readonly devices: number;
}): ConsentStatus | undefined {
  if (input.consentAt && input.consents?.length) {
    return {
      kind: 'accepted',
      at: input.consentAt,
      current: acceptedAll(joiningDocuments(true), input.consents),
    };
  }
  if (input.consentAt) return { kind: 'accepted-summary', at: input.consentAt };
  return input.asks && input.devices > 0 ? { kind: 'waiting' } : undefined;
}

/** «4 нояб.», with the year when it is not this one. */
export function consentDay(at: string, now = new Date()): string {
  const date = new Date(at);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** «4 ноября 2026, 11:02». */
export function consentMoment(at: string): string {
  const date = new Date(at);
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day.replace(/\s?г\.$/u, '')}, ${time}`;
}

/** A wording's version as a reader sees it: «шаблон от 04.11.2026», «редакция от …». */
export function consentVersionLabel(version: string): string {
  const match = /^(template-)?(?:[a-z-]*-)?(\d{4})-(\d{2})-(\d{2})$/u.exec(version);
  if (!match) return 'другая редакция';
  const day = `${match[4]}.${match[3]}.${match[2]}`;
  return match[1] ? `шаблон от ${day}` : `редакция от ${day}`;
}
