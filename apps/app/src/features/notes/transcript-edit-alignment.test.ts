import { describe, expect, it } from 'vitest';

import { transcriptTextMatchesSegments } from './transcript-edit-alignment';

const segments = [
  { speakerId: 'speaker-1', startMs: 0, endMs: 600, text: 'Добрый день' },
  { speakerId: 'speaker-1', startMs: 650, endMs: 1_500, text: 'что вас беспокоит' },
] as const;

describe('transcript timestamp alignment', () => {
  it('keeps timestamps available for punctuation and case-only edits', () => {
    expect(transcriptTextMatchesSegments('ДОБРЫЙ, день! Что вас беспокоит?', segments)).toBe(true);
  });

  it('invalidates timestamp actions when words change', () => {
    expect(transcriptTextMatchesSegments('Добрый вечер, что вас беспокоит?', segments)).toBe(false);
  });

  it('invalidates timestamp actions when a word is inserted or removed', () => {
    expect(
      transcriptTextMatchesSegments('Добрый день, скажите, что вас беспокоит?', segments),
    ).toBe(false);
    expect(transcriptTextMatchesSegments('Добрый день, что беспокоит?', segments)).toBe(false);
  });

  it('requires at least one segment', () => {
    expect(transcriptTextMatchesSegments('Добрый день', [])).toBe(false);
    expect(transcriptTextMatchesSegments('Добрый день', undefined)).toBe(false);
  });
});
