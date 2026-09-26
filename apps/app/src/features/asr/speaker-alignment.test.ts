import { describe, expect, it } from 'vitest';

import {
  alignWordsToSpeakers,
  applyOptionalSpeakerRegions,
  buildSpeakerTurns,
  mergeSpeakerWords,
} from './speaker-alignment';

describe('speaker timestamp alignment', () => {
  it('assigns each word to the speaker region with the greatest overlap', () => {
    const aligned = alignWordsToSpeakers(
      [
        { speakerId: 'speaker-1', startMs: 0, endMs: 600, text: 'Добрый' },
        { speakerId: 'speaker-1', startMs: 600, endMs: 1_100, text: 'день' },
        { speakerId: 'speaker-1', startMs: 1_100, endMs: 1_700, text: 'Здравствуйте' },
      ],
      [
        { speakerId: 'doctor', startMs: 0, endMs: 1_050 },
        { speakerId: 'patient', startMs: 1_050, endMs: 2_000 },
      ],
    );

    expect(aligned.map((segment) => segment.speakerId)).toEqual(['doctor', 'doctor', 'patient']);
  });

  it('keeps the original speaker when no diarization region overlaps the word', () => {
    expect(
      alignWordsToSpeakers(
        [{ speakerId: 'speaker-1', startMs: 3_000, endMs: 3_500, text: 'Отдельно' }],
        [{ speakerId: 'patient', startMs: 0, endMs: 1_000 }],
      ),
    ).toEqual([{ speakerId: 'speaker-1', startMs: 3_000, endMs: 3_500, text: 'Отдельно' }]);
  });

  it('merges adjacent words into readable turns without adding spaces before punctuation', () => {
    expect(
      mergeSpeakerWords([
        { speakerId: 'doctor', startMs: 0, endMs: 300, text: 'Как' },
        { speakerId: 'doctor', startMs: 320, endMs: 700, text: 'спите' },
        { speakerId: 'doctor', startMs: 700, endMs: 760, text: '?' },
        { speakerId: 'patient', startMs: 800, endMs: 1_300, text: 'Плохо' },
      ]),
    ).toEqual([
      {
        speakerId: 'doctor',
        startMs: 0,
        endMs: 760,
        text: 'Как спите?',
      },
      {
        speakerId: 'patient',
        startMs: 800,
        endMs: 1_300,
        text: 'Плохо',
      },
    ]);
  });

  it('does not merge the same speaker across a long pause', () => {
    expect(
      mergeSpeakerWords(
        [
          { speakerId: 'doctor', startMs: 0, endMs: 500, text: 'Первый вопрос.' },
          { speakerId: 'doctor', startMs: 5_000, endMs: 5_500, text: 'Второй вопрос.' },
        ],
        1_000,
      ),
    ).toHaveLength(2);
  });

  it('does not claim diarization for null or empty speaker regions', () => {
    const words = [
      { speakerId: 'speaker-1', startMs: 0, endMs: 300, text: 'Добрый' },
      { speakerId: 'speaker-1', startMs: 320, endMs: 700, text: 'день' },
    ];

    expect(applyOptionalSpeakerRegions(words, null)).toEqual({
      segments: [
        {
          speakerId: 'speaker-1',
          startMs: 0,
          endMs: 700,
          text: 'Добрый день',
        },
      ],
      diarized: false,
    });
    expect(applyOptionalSpeakerRegions(words, [])).toEqual({
      segments: [
        {
          speakerId: 'speaker-1',
          startMs: 0,
          endMs: 700,
          text: 'Добрый день',
        },
      ],
      diarized: false,
    });
  });

  it('marks transcript turns diarized only after real regions exist', () => {
    const result = applyOptionalSpeakerRegions(
      [
        { speakerId: 'speaker-1', startMs: 0, endMs: 300, text: 'Добрый' },
        { speakerId: 'speaker-1', startMs: 320, endMs: 700, text: 'день' },
      ],
      [{ speakerId: 'doctor', startMs: 0, endMs: 800 }],
    );

    expect(result).toEqual({
      segments: [
        {
          speakerId: 'doctor',
          startMs: 0,
          endMs: 700,
          text: 'Добрый день',
        },
      ],
      diarized: true,
    });
  });

  it('builds speaker turns in one pass for later WASM diarization integration', () => {
    const turns = buildSpeakerTurns(
      [
        { speakerId: 'speaker-1', startMs: 0, endMs: 300, text: 'Болит' },
        { speakerId: 'speaker-1', startMs: 320, endMs: 800, text: 'голова' },
        { speakerId: 'speaker-1', startMs: 1_000, endMs: 1_350, text: 'Как' },
        { speakerId: 'speaker-1', startMs: 1_360, endMs: 1_800, text: 'давно' },
      ],
      [
        { speakerId: 'patient', startMs: 0, endMs: 900 },
        { speakerId: 'doctor', startMs: 900, endMs: 2_000 },
      ],
    );

    expect(turns).toEqual([
      {
        speakerId: 'patient',
        startMs: 0,
        endMs: 800,
        text: 'Болит голова',
      },
      {
        speakerId: 'doctor',
        startMs: 1_000,
        endMs: 1_800,
        text: 'Как давно',
      },
    ]);
  });
});
