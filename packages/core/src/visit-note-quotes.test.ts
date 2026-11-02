import { describe, expect, it } from 'vitest';

import { containsQuoteWords, indexQuoteSource, locateQuote, quoteWords } from './visit-note-quotes';

const TRANSCRIPT = [
  'Врач: Что беспокоит?',
  'Пациент: Давит в груди, особенно при ходьбе. Уже недели две.',
  'Врач: Одышка есть?',
  'Пациент: Нет, одышки нет. Голова не болит, а вот',
  'ноги отекают к вечеру.',
  'Пациент: Аллергия на пенициллин — сыпь была.',
];

describe('quote words', () => {
  it('ignores case, «ё» and punctuation and keeps source offsets', () => {
    const words = quoteWords('Жёсткое дыхание, хрипов нет!');
    expect(words.text).toBe('жесткое дыхание хрипов нет');
    expect(words.offsets).toHaveLength(words.text.length);
    expect(words.offsets[0]).toEqual({ start: 0, end: 1 });
  });
});

describe('locateQuote', () => {
  const index = indexQuoteSource('transcript', TRANSCRIPT);

  it('finds a quote regardless of case and punctuation and returns the source wording', () => {
    const location = locateQuote(index, 'давит в груди особенно при ходьбе');
    expect(location).toEqual({
      ok: true,
      quote: {
        source: 'transcript',
        startLine: 1,
        start: 9,
        endLine: 1,
        end: 43,
        text: 'Давит в груди, особенно при ходьбе',
      },
    });
  });

  it('follows a quote across a speech-segment line break', () => {
    const location = locateQuote(index, 'а вот ноги отекают к вечеру');
    expect(location.ok && location.quote).toMatchObject({
      startLine: 3,
      endLine: 4,
      text: 'а вот ноги отекают к вечеру',
    });
  });

  it('rejects words that are not in the source and partial words', () => {
    expect(locateQuote(index, 'давит в груди при нагрузке')).toEqual({
      ok: false,
      code: 'quote-not-found',
    });
    expect(locateQuote(index, 'авит в груди')).toEqual({ ok: false, code: 'quote-not-found' });
  });

  it('rejects quotes too short to support anything', () => {
    expect(locateQuote(index, 'сыпь')).toEqual({ ok: false, code: 'quote-too-short' });
  });

  it('does not let a negated statement support its opposite', () => {
    expect(locateQuote(index, 'болит, а вот')).toEqual({ ok: false, code: 'quote-negated' });
    expect(locateQuote(index, 'голова не болит').ok).toBe(true);
  });

  it('treats a negation behind punctuation as a separate statement', () => {
    const answer = indexQuoteSource('transcript', ['Пациент: Нет, болит постоянно.']);
    expect(locateQuote(answer, 'болит постоянно').ok).toBe(true);
  });

  it('uses a later occurrence when the first one is negated', () => {
    const mixed = indexQuoteSource('transcript', [
      'Утром не болит голова.',
      'К вечеру болит голова.',
    ]);
    const location = locateQuote(mixed, 'болит голова');
    expect(location.ok && location.quote.startLine).toBe(1);
  });
});

describe('containsQuoteWords', () => {
  it('matches whole words only', () => {
    expect(containsQuoteWords('Аллергия на пенициллин.', 'аллергия на пенициллин')).toBe(true);
    expect(containsQuoteWords('Аллергия на пенициллины.', 'аллергия на пенициллин')).toBe(false);
  });
});
