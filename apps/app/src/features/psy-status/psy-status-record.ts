import { type PsyStatusDocument, PsyStatusDocumentSchema } from '@localmed/contracts';
import { generatePsyStatusText } from '@localmed/core/psy-status';

import { appendEvent, type PatientEvent } from '@/state/patient-domain';
import { addPatientBlob, updatePatientVault } from '@/state/patient-vault';

/**
 * Filing a finished psychiatric status into a patient's card (PSY1): a note with the generated
 * text, and next to it, as an encrypted file of the card, the structured status with every
 * transcript quote its entries stand on — so the card can later show where each phrase came from.
 */

export const PSY_STATUS_NOTE_TITLE = 'Психический статус';
const KIND = 'minimed-psy-status';

export function psyStatusBlobId(eventId: string): string {
  return `psy-status-${eventId}`;
}

export function psyStatusNoteEvent(input: {
  readonly id: string;
  readonly patientId: string;
  readonly document: PsyStatusDocument;
  readonly occurredAt: string;
}): PatientEvent {
  const text = generatePsyStatusText(input.document).trim();
  if (!text) throw new Error('Статус пуст: сохранять нечего.');
  return {
    id: input.id,
    patientId: input.patientId,
    kind: 'note',
    occurredAt: input.occurredAt,
    title: PSY_STATUS_NOTE_TITLE,
    text,
    observations: [],
    immutable: false,
  };
}

export function encodePsyStatusRecord(
  document: PsyStatusDocument,
  recordingId: string | undefined,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      kind: KIND,
      document: PsyStatusDocumentSchema.parse(document),
      ...(recordingId ? { recordingId } : {}),
    }),
  );
}

export async function savePsyStatus(input: {
  readonly patientId: string;
  readonly document: PsyStatusDocument;
  readonly recordingId?: string | undefined;
  readonly now?: Date;
}): Promise<PatientEvent> {
  const now = input.now ?? new Date();
  const event = psyStatusNoteEvent({
    id: `psy-status-${now.getTime().toString(36)}`,
    patientId: input.patientId,
    document: input.document,
    occurredAt: now.toISOString(),
  });
  await addPatientBlob({
    id: psyStatusBlobId(event.id),
    patientId: input.patientId,
    mimeType: 'application/json',
    bytes: encodePsyStatusRecord(input.document, input.recordingId),
  });
  await updatePatientVault((snapshot) => appendEvent(snapshot, event));
  return event;
}
