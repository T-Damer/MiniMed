import { describe, expect, it } from 'vitest';

import {
  createVisitTranscriptEvent,
  formatRecordingDuration,
  transcriptSpeakerIds,
  visitRecordingBlobId,
  visitTranscriptText,
} from '@/features/asr/visit-recording';

const segments = [
  { speakerId: 'speaker-1', startMs: 0, endMs: 2_000, text: 'Что вас беспокоит?' },
  { speakerId: 'speaker-0', startMs: 2_500, endMs: 6_000, text: 'Плохо сплю' },
  { speakerId: 'speaker-0', startMs: 6_200, endMs: 8_000, text: 'уже месяц.' },
];

describe('visit recording transcript', () => {
  it('lists speakers in order of first appearance', () => {
    expect(transcriptSpeakerIds(segments)).toEqual(['speaker-1', 'speaker-0']);
  });

  it('applies the doctor-chosen speaker names and merges consecutive turns', () => {
    expect(visitTranscriptText(segments, { 'speaker-1': 'Врач', 'speaker-0': 'Пациент' })).toBe(
      '[00:00–00:02] Врач: Что вас беспокоит?\n\n[00:02–00:08] Пациент: Плохо сплю уже месяц.',
    );
  });

  it('formats durations for the event title', () => {
    expect(formatRecordingDuration(65_400)).toBe('01:05');
    expect(formatRecordingDuration(3_725_000)).toBe('1:02:05');
  });

  it('creates a labelled note event in the visit and refuses an empty transcript', () => {
    const event = createVisitTranscriptEvent({
      id: 'event-1',
      patientId: 'patient-1',
      episodeId: 'episode-1',
      occurredAt: '2026-09-26T10:00:00.000Z',
      durationMs: 65_400,
      transcript: 'Врач: Здравствуйте',
    });
    expect(event).toMatchObject({
      kind: 'note',
      episodeId: 'episode-1',
      title: 'Беседа на приёме, 01:05',
      observations: [],
    });
    expect(event.text).toContain('Автоматическая расшифровка');
    expect(visitRecordingBlobId(event.id)).toBe('visit-recording-event-1');
    expect(() =>
      createVisitTranscriptEvent({
        id: 'event-2',
        patientId: 'patient-1',
        episodeId: 'episode-1',
        occurredAt: '2026-09-26T10:00:00.000Z',
        durationMs: 1_000,
        transcript: '   ',
      }),
    ).toThrow('пуста');
  });
});
