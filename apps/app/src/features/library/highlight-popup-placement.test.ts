import { describe, expect, it } from 'vitest';

import {
  HIGHLIGHT_QUOTE_LIMIT,
  highlightPopupPlacement,
  highlightQuoteMatches,
} from '@/features/library/highlight-popup-placement';

describe('highlightPopupPlacement', () => {
  it('floats above the selection with a mouse', () => {
    expect(highlightPopupPlacement({ bottom: 300 }, 800, false)).toBe('above');
    expect(highlightPopupPlacement({ bottom: 790 }, 800, false)).toBe('above');
  });

  it('goes below the selection on a touch screen, clear of the system menu above it', () => {
    expect(highlightPopupPlacement({ bottom: 300 }, 800, true)).toBe('below');
  });

  it('docks above the bottom navigation when there is no room under the selection', () => {
    expect(highlightPopupPlacement({ bottom: 700 }, 800, true)).toBe('dock');
    expect(highlightPopupPlacement({ bottom: 800 }, 800, true)).toBe('dock');
  });
});

describe('highlightQuoteMatches', () => {
  const text = 'Показания к операции определяет врач-хирург.  Пациенты наблюдаются в стационаре.';

  it('accepts the text a highlight was saved from, whatever the whitespace', () => {
    const quote = text.slice(0, 29);
    expect(highlightQuoteMatches(text, 0, 29, quote)).toBe(true);
    expect(highlightQuoteMatches(text, 0, 29, `${quote.replace(' ', '\n')} `)).toBe(true);
  });

  it('rejects a range whose text moved', () => {
    const quote = text.slice(0, 29);
    expect(highlightQuoteMatches(`Новое предложение. ${text}`, 0, 29, quote)).toBe(false);
    expect(highlightQuoteMatches('Короткий текст', 0, 29, quote)).toBe(false);
  });

  it('compares only the saved prefix of a long range', () => {
    const long = `${'слово '.repeat(120)}конец`;
    const quote = long.slice(0, HIGHLIGHT_QUOTE_LIMIT);
    expect(highlightQuoteMatches(long, 0, long.length, quote)).toBe(true);
    expect(highlightQuoteMatches(`чужое ${long}`, 0, long.length, quote)).toBe(false);
  });

  it('keeps a highlight that was saved without a quote', () => {
    expect(highlightQuoteMatches(text, 0, 5, '')).toBe(true);
  });
});
