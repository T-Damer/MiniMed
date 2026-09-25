import { describe, expect, it } from 'vitest';

import {
  NativeRecordingResultSchema,
  NativeTranscriptionProgressSchema,
  NativeTranscriptionResultSchema,
  TranscriptionSpeakerSegmentSchema,
} from './transcription';

describe('native transcription contracts', () => {
  it('accepts a validated Russian speaker transcript', () => {
    const result = NativeTranscriptionResultSchema.parse({
      language: 'ru',
      durationMs: 12_000,
      segments: [
        {
          speakerId: 'speaker-1',
          startMs: 0,
          endMs: 5_000,
          text: 'Добрый день.',
        },
        {
          speakerId: 'speaker-2',
          startMs: 5_100,
          endMs: 12_000,
          text: 'Здравствуйте.',
        },
      ],
    });

    expect(result.segments).toHaveLength(2);
  });

  it('rejects impossible segment timing', () => {
    expect(() =>
      TranscriptionSpeakerSegmentSchema.parse({
        speakerId: 'speaker-1',
        startMs: 5_000,
        endMs: 5_000,
        text: 'Текст',
      }),
    ).toThrow();
  });

  it('accepts both supported native recording containers', () => {
    for (const [container, mimeType] of [
      ['ogg-opus', 'audio/ogg;codecs=opus'],
      ['m4a-aac', 'audio/mp4'],
    ] as const) {
      expect(
        NativeRecordingResultSchema.parse({
          filePath: '/private/recording',
          fileName: 'visit.ogg',
          mimeType,
          container,
          durationMs: 1_000,
        }).container,
      ).toBe(container);
    }
  });

  it('rejects invalid progress totals', () => {
    expect(() =>
      NativeTranscriptionProgressSchema.parse({
        stage: 'transcribing',
        completed: 0,
        total: 0,
      }),
    ).toThrow();
  });
});
