import { AUTOMATIC_TRANSCRIPT_LABEL } from '@/features/asr/visit-recording';
import type { ConversationRecording } from '@/state/conversation-recordings';
import type { PatientEvent } from '@/state/patient-domain';

/**
 * The patient's full log (owner 2026-11-16): visits' notes, measurements, results, the patient's
 * own marks and the conversation recordings in one list, newest first. A recording and its text
 * are one entry — the card used to show the recording in a list of its own and the text again as
 * an event.
 */
export type PatientLogEntry =
  | {
      readonly kind: 'event';
      readonly id: string;
      readonly at: string;
      readonly event: PatientEvent;
    }
  | {
      readonly kind: 'recording';
      readonly id: string;
      readonly at: string;
      readonly recording: ConversationRecording;
      /** The text filed to the card with the recording, when there is one. */
      readonly event: PatientEvent | undefined;
    };

/** The text of an event as the doctor reads it: without the fixed «automatic transcript» notice. */
export function eventLogText(text: string | undefined): string {
  if (!text) return '';
  const trimmed = text.trim();
  return trimmed.startsWith(AUTOMATIC_TRANSCRIPT_LABEL)
    ? trimmed.slice(AUTOMATIC_TRANSCRIPT_LABEL.length).trim()
    : trimmed;
}

/** A second line under an event's title only when it says something the title does not. */
export function eventLogDetail(title: string, description: string): string {
  return description.trim() === title.trim() ? '' : description.trim();
}

export function patientLogEntries(
  patientId: string,
  events: readonly PatientEvent[],
  recordings: readonly ConversationRecording[],
): readonly PatientLogEntry[] {
  const own = events.filter((event) => event.patientId === patientId);
  const byId = new Map(own.map((event) => [event.id, event]));
  const entries: PatientLogEntry[] = [];
  const withRecording = new Set<string>();
  for (const recording of recordings) {
    const attached = recording.attachedTo;
    const owner = attached?.patientId ?? recording.patientId;
    if (owner !== patientId) continue;
    const event = attached ? byId.get(attached.eventId) : undefined;
    if (event) withRecording.add(event.id);
    entries.push({
      kind: 'recording',
      id: `recording-${recording.id}`,
      at: event?.occurredAt ?? recording.startedAt,
      recording,
      event,
    });
  }
  for (const event of own) {
    if (withRecording.has(event.id)) continue;
    entries.push({ kind: 'event', id: event.id, at: event.occurredAt, event });
  }
  return entries.toSorted((left, right) => right.at.localeCompare(left.at));
}
