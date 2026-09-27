import { describe, expect, it } from 'vitest';
import {
  buildCorpusVocabulary,
  correctQueryAgainstVocabulary,
  MIN_TYPO_WORD_LENGTH,
} from './typo-correction';

const CORPUS_WORDS = [
  'пиелонефрит',
  'пиелонефрит',
  'пиелонефрит',
  'гастрит',
  'гастрит',
  'бронхит',
  'парацетамол',
  'амоксициллин',
  'головокружение',
  'артериальная',
  'гипертензия',
];

describe('buildCorpusVocabulary', () => {
  const vocabulary = buildCorpusVocabulary(CORPUS_WORDS);

  it('keeps distinct terms and counts frequency', () => {
    expect(vocabulary.size).toBe(new Set(CORPUS_WORDS).size);
    expect(vocabulary.has('пиелонефрит')).toBe(true);
    expect(vocabulary.has('unknownword')).toBe(false);
  });

  it('drops words shorter than MIN_TYPO_WORD_LENGTH', () => {
    const short = buildCorpusVocabulary(['ад', 'боль', 'кровь', ...CORPUS_WORDS]);
    expect(short.has('ад')).toBe(false);
    expect(short.has('боль')).toBe(false);
    expect(MIN_TYPO_WORD_LENGTH).toBeGreaterThan(4);
  });

  it('respects minFrequency', () => {
    const filtered = buildCorpusVocabulary(CORPUS_WORDS, { minFrequency: 2 });
    expect(filtered.has('пиелонефрит')).toBe(true); // occurs 3x
    expect(filtered.has('бронхит')).toBe(false); // occurs 1x
  });

  it('respects maxTerms, keeping the most frequent terms', () => {
    const capped = buildCorpusVocabulary(CORPUS_WORDS, { maxTerms: 2 });
    expect(capped.size).toBe(2);
    expect(capped.has('пиелонефрит')).toBe(true); // most frequent (3x)
    expect(capped.has('гастрит')).toBe(true); // second most frequent (2x)
  });

  it('candidatesNear only returns terms within the length bucket', () => {
    const near = vocabulary.candidatesNear('пиелонефрит'); // length 11
    expect(near).toContain('пиелонефрит');
    expect(near).not.toContain('гастрит'); // length 7, outside a ±2 bucket of 11
  });
});

describe('correctQueryAgainstVocabulary', () => {
  const vocabulary = buildCorpusVocabulary(CORPUS_WORDS);

  it('corrects a single unknown word close to a corpus word', () => {
    const result = correctQueryAgainstVocabulary('пиелонефрет у женщины', vocabulary);
    expect(result?.correctedQuery).toBe('пиелонефрит у женщины');
    expect(result?.corrections).toEqual([
      { original: 'пиелонефрет', corrected: 'пиелонефрит', score: expect.any(Number) },
    ]);
  });

  it('returns null when every word is already known', () => {
    expect(correctQueryAgainstVocabulary('гастрит и бронхит', vocabulary)).toBeNull();
  });

  it('returns null when nothing is close enough to correct', () => {
    expect(correctQueryAgainstVocabulary('совершенно постороннее слово', vocabulary)).toBeNull();
  });

  it('never touches a short word (below MIN_TYPO_WORD_LENGTH), even if unknown', () => {
    expect(correctQueryAgainstVocabulary('боль в бок', vocabulary)).toBeNull();
  });

  it('corrects more than one unknown word in the same query', () => {
    const result = correctQueryAgainstVocabulary('гастрет и бронхет', vocabulary);
    expect(result?.correctedQuery).toBe('гастрит и бронхит');
    expect(result?.corrections).toHaveLength(2);
  });

  it('preserves surrounding punctuation and casing of already-known text', () => {
    const result = correctQueryAgainstVocabulary('Подозрение на пиелонефрет?', vocabulary);
    expect(result?.correctedQuery).toBe('Подозрение на пиелонефрит?');
  });

  it('respects a stricter scoreCutoff', () => {
    // 'пиелонефрет' -> 'пиелонефрит' is a single-letter substitution (е/и), a high-similarity
    // correction; an unreasonably strict cutoff must suppress it.
    expect(
      correctQueryAgainstVocabulary('пиелонефрет', vocabulary, { scoreCutoff: 0.999 }),
    ).toBeNull();
  });
});
