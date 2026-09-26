import { describe, expect, it } from 'vitest';

import { formatSpeakerTranscript, mergeSpeakerSegments } from './native-transcript';

describe('native speaker transcript', () => {
  it('merges adjacent segments from the same speaker within the configured gap', () => {
    const turns = mergeSpeakerSegments([
      { speakerId: 'speaker-a', startMs: 0, endMs: 1_000, text: 'Добрый день.' },
      { speakerId: 'speaker-a', startMs: 1_400, endMs: 2_500, text: 'Что вас беспокоит?' },
      { speakerId: 'speaker-b', startMs: 2_600, endMs: 4_000, text: 'Плохо сплю.' },
    ]);

    expect(turns).toEqual([
      {
        speakerId: 'speaker-a',
        speakerLabel: 'Спикер 1',
        startMs: 0,
        endMs: 2_500,
        text: 'Добрый день. Что вас беспокоит?',
      },
      {
        speakerId: 'speaker-b',
        speakerLabel: 'Спикер 2',
        startMs: 2_600,
        endMs: 4_000,
        text: 'Плохо сплю.',
      },
    ]);
  });

  it('keeps separated turns and permits explicit doctor/patient labels', () => {
    const turns = mergeSpeakerSegments(
      [
        { speakerId: 'a', startMs: 0, endMs: 1_000, text: 'Первый вопрос.' },
        { speakerId: 'a', startMs: 4_000, endMs: 5_000, text: 'Второй вопрос.' },
        { speakerId: 'b', startMs: 5_100, endMs: 6_000, text: 'Ответ.' },
      ],
      { speakerNames: { a: 'Врач', b: 'Пациент' } },
    );

    expect(turns.map((turn) => turn.speakerLabel)).toEqual(['Врач', 'Врач', 'Пациент']);
    expect(formatSpeakerTranscript(turns)).toBe(
      '[00:00–00:01] Врач: Первый вопрос.\n\n' +
        '[00:04–00:05] Врач: Второй вопрос.\n\n' +
        '[00:05–00:06] Пациент: Ответ.',
    );
  });

  it('drops empty ASR fragments without renumbering detected speakers', () => {
    const turns = mergeSpeakerSegments([
      { speakerId: 'a', startMs: 0, endMs: 500, text: '   ' },
      { speakerId: 'b', startMs: 600, endMs: 1_500, text: '  Текст   с   пробелами. ' },
    ]);

    expect(turns).toEqual([
      {
        speakerId: 'b',
        speakerLabel: 'Спикер 2',
        startMs: 600,
        endMs: 1_500,
        text: 'Текст с пробелами.',
      },
    ]);
  });

  it('rejects a negative merge gap', () => {
    expect(() =>
      mergeSpeakerSegments([], {
        maxGapMs: -1,
      }),
    ).toThrow('Speaker merge gap must be a non-negative number.');
  });
});
