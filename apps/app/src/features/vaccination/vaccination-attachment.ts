import { z } from 'zod';

import type { VaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { addPatientBlob, readPatientBlob } from '@/state/patient-vault';

/**
 * The personal vaccination plan of a child, attached to the child's patient card. The card is the
 * patient record (ADR-0016): the birth date and the name stay in the profile, and the plan is
 * computed from them on every open, so a corrected birth date corrects the plan. What the card
 * keeps is the fact of the attachment and the calendar edition the plan was made for, as a patient
 * file of the vault (like the diary ledger): protected with the vault, removed with the card and
 * carried by the card backup. Nothing of it is stored outside the vault.
 */

export const VACCINATION_ATTACHMENT_SCHEMA_VERSION = 1 as const;
const MIME = 'application/json';
const ISO_INSTANT = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'must be an ISO date-time',
});

export const VaccinationAttachmentSchema = z
  .object({
    kind: z.literal('minimed-vaccination-plan'),
    schemaVersion: z.literal(VACCINATION_ATTACHMENT_SCHEMA_VERSION),
    /** `id` of the calendar data the plan was made from. */
    calendarId: z.string().min(1),
    /** Edition line of the calendar then, e.g. «по приказу № 1122н в ред. приказа № 677н». */
    editionLine: z.string().min(1),
    attachedAt: ISO_INSTANT,
    updatedAt: ISO_INSTANT,
  })
  .strict();
export type VaccinationAttachment = z.infer<typeof VaccinationAttachmentSchema>;

export class VaccinationAttachmentError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VaccinationAttachmentError';
  }
}

export function attachmentBlobId(patientId: string): string {
  return `vaccination-plan-${patientId}`;
}

/** A new attachment, or the existing one refreshed to the current edition (`attachedAt` stays). */
export function attachPlan(
  calendar: VaccinationCalendar,
  now: Date,
  previous?: VaccinationAttachment,
): VaccinationAttachment {
  const instant = now.toISOString();
  return {
    kind: 'minimed-vaccination-plan',
    schemaVersion: VACCINATION_ATTACHMENT_SCHEMA_VERSION,
    calendarId: calendar.id,
    editionLine: calendar.edition.editionLine,
    attachedAt: previous?.attachedAt ?? instant,
    updatedAt: instant,
  };
}

/** Validates stored text; a damaged record is reported, never half-read. */
export function parseAttachment(text: string): VaccinationAttachment {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new VaccinationAttachmentError('Запись о плане прививок повреждена.', { cause });
  }
  const parsed = VaccinationAttachmentSchema.safeParse(value);
  if (!parsed.success) throw new VaccinationAttachmentError('Запись о плане прививок повреждена.');
  return parsed.data;
}

/** True when the attachment was made for another edition than the calendar in the app. */
export function attachmentIsStale(
  attachment: VaccinationAttachment,
  calendar: VaccinationCalendar,
): boolean {
  return (
    attachment.calendarId !== calendar.id || attachment.editionLine !== calendar.edition.editionLine
  );
}

export async function loadAttachment(
  patientId: string,
): Promise<VaccinationAttachment | undefined> {
  const blob = await readPatientBlob(attachmentBlobId(patientId));
  return blob ? parseAttachment(new TextDecoder().decode(blob.bytes)) : undefined;
}

export async function saveAttachment(
  patientId: string,
  attachment: VaccinationAttachment,
): Promise<void> {
  await addPatientBlob({
    id: attachmentBlobId(patientId),
    patientId,
    mimeType: MIME,
    bytes: new TextEncoder().encode(JSON.stringify(VaccinationAttachmentSchema.parse(attachment))),
  });
}
