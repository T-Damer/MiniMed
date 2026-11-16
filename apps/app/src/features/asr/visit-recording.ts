import type { TranscriptionSpeakerSegment } from '@localmed/contracts';

import { formatSpeakerTranscript, mergeSpeakerSegments } from '@/features/asr/native-transcript';
import type { PatientEvent } from '@/state/patient-domain';

/** Speakers in first-appearance order, so the doctor can rename «Спикер 1» to «Врач». */
export function transcriptSpeakerIds(
  segments: readonly TranscriptionSpeakerSegment[],
): readonly string[] {
  return [...new Set(segments.map((segment) => segment.speakerId))];
}

export function formatRecordingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const body = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

export function visitTranscriptText(
  segments: readonly TranscriptionSpeakerSegment[],
  speakerNames: Readonly<Record<string, string>>,
): string {
  return formatSpeakerTranscript(mergeSpeakerSegments(segments, { speakerNames }));
}

/** Blob id of the source audio kept next to its transcript event in the patient vault. */
export function visitRecordingBlobId(eventId: string): string {
  return `visit-recording-${eventId}`;
}

/**
 * The notice older events carry in front of a transcript. No longer written (owner 2026-11-16);
 * the card strips it from events saved before (`eventLogText`).
 */
export const AUTOMATIC_TRANSCRIPT_LABEL =
  'Автоматическая расшифровка аудиозаписи; проверьте перед использованием.';

export function createVisitTranscriptEvent(input: {
  readonly id: string;
  readonly patientId: string;
  readonly episodeId: string;
  readonly occurredAt: string;
  readonly durationMs: number;
  readonly transcript: string;
}): PatientEvent {
  const text = input.transcript.trim();
  if (!text) throw new Error('Расшифровка пуста: сохранять нечего.');
  return {
    id: input.id,
    patientId: input.patientId,
    episodeId: input.episodeId,
    kind: 'note',
    occurredAt: input.occurredAt,
    title: `Беседа на приёме, ${formatRecordingDuration(input.durationMs)}`,
    text,
    observations: [],
    immutable: false,
  };
}
