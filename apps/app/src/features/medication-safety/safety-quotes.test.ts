import { describe, expect, it } from 'vitest';

import {
  canonicalSectionText,
  sectionChecksum,
} from '@/features/drug-interactions/interaction-text';
import { MAX_FULL_QUOTE, resolveSafetyQuotes } from './safety-quotes';
import { fixtureMedicalDocument } from './safety-test-fixtures';

const SECTION_ID = 'section.sss';

function documentOf(text: string) {
  return fixtureMedicalDocument('d', [
    { id: SECTION_ID, type: 'contraindications', title: 'Противопоказания', text },
  ]);
}

function requestFor(text: string, from: number, to: number, hits: readonly [number, number][]) {
  const checksum = sectionChecksum(canonicalSectionText([text]).text).slice(0, 4);
  return {
    section: [SECTION_ID, checksum] as const,
    start: from,
    end: to,
    flags: 0,
    hits: () => hits,
  };
}

describe('resolveSafetyQuotes', () => {
  it('quotes a short sentence whole, with the hit words marked and the anchor of its chunk', () => {
    const text = 'Детский возраст\nдо 12 лет.';
    const hit: [number, number] = [text.indexOf('до 12'), text.indexOf(' лет') + 4];
    const { quotes, changed } = resolveSafetyQuotes(documentOf(text), [
      requestFor(text, 0, text.length, [hit]),
    ]);
    expect(changed).toBe(0);
    const [quote] = quotes;
    expect(quote?.segments).toEqual([
      { text: 'Детский возраст ', hit: false },
      { text: 'до 12 лет', hit: true },
      { text: '.', hit: false },
    ]);
    expect(quote?.hitTexts).toEqual(['до 12 лет']);
    expect(quote?.cutBefore).toBe(false);
    expect(quote?.anchor).toBe('a0/chunk');
  });

  it('cuts a long list to the items around the hit, with the cut marked', () => {
    const items = Array.from({ length: 60 }, (_, at) => `состояние номер ${at}`);
    items[30] = 'детский возраст до 12 лет';
    const text = `${items.join('; ')}.`;
    const start = text.indexOf('до 12 лет');
    const { quotes } = resolveSafetyQuotes(documentOf(text), [
      requestFor(text, 0, text.length, [[start, start + 9]]),
    ]);
    const [quote] = quotes;
    expect(text.length).toBeGreaterThan(MAX_FULL_QUOTE);
    expect(quote?.cutBefore).toBe(true);
    expect(quote?.cutAfter).toBe(true);
    const shown = quote?.segments.map((segment) => segment.text).join('') ?? '';
    expect(shown).toContain('детский возраст до 12 лет');
    expect(shown.length).toBeLessThan(450);
    // The cut is a plain piece of the sentence: nothing is added or rewritten.
    expect(text.replace(/\s+/gu, ' ')).toContain(shown.trim());
    expect(quote?.fullText).toBe(text);
  });

  it('reports a section whose text changed instead of guessing', () => {
    const text = 'Детский возраст до 12 лет.';
    const request = {
      ...requestFor(text, 0, text.length, []),
      section: [SECTION_ID, 'dead'] as const,
    };
    const { quotes, changed } = resolveSafetyQuotes(documentOf(text), [request]);
    expect(quotes).toEqual([]);
    expect(changed).toBe(1);
  });

  it('reports a section the document no longer has', () => {
    const text = 'Детский возраст до 12 лет.';
    const request = {
      ...requestFor(text, 0, text.length, []),
      section: ['section.gone', 'abcd'] as const,
    };
    expect(resolveSafetyQuotes(documentOf(text), [request]).changed).toBe(1);
  });
});
