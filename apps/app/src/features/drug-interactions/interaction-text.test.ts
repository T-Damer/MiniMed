import { describe, expect, it } from 'vitest';

import {
  canonicalSectionText,
  chunkIndexAt,
  sectionChecksum,
  spanDisplayText,
  splitSentenceSpans,
} from './interaction-text';

const sentences = (text: string): readonly string[] =>
  splitSentenceSpans(text).map((span) => spanDisplayText(text, span));

describe('canonicalSectionText', () => {
  it('joins the chunks with a newline and remembers where each starts', () => {
    const canonical = canonicalSectionText(['первый', 'второй', 'третий']);
    expect(canonical.text).toBe('первый\nвторой\nтретий');
    expect(canonical.chunkStarts).toEqual([0, 7, 14]);
    for (const [index, start] of canonical.chunkStarts.entries()) {
      expect(
        canonical.text.slice(start).startsWith(['первый', 'второй', 'третий'][index] ?? ''),
      ).toBe(true);
    }
  });

  it('finds the chunk that holds an offset', () => {
    const { chunkStarts } = canonicalSectionText(['aaaa', 'bbbbbb', 'cc']);
    expect(chunkIndexAt(chunkStarts, 0)).toBe(0);
    expect(chunkIndexAt(chunkStarts, 4)).toBe(0);
    expect(chunkIndexAt(chunkStarts, 5)).toBe(1);
    expect(chunkIndexAt(chunkStarts, 11)).toBe(1);
    expect(chunkIndexAt(chunkStarts, 12)).toBe(2);
    expect(chunkIndexAt([], 3)).toBe(0);
  });

  it('gives one checksum per text and another for a changed text', () => {
    expect(sectionChecksum('одно')).toBe(sectionChecksum('одно'));
    expect(sectionChecksum('одно')).not.toBe(sectionChecksum('другое'));
    expect(sectionChecksum('')).toMatch(/^[0-9a-f]{8}$/u);
  });
});

describe('splitSentenceSpans', () => {
  it('splits at a full stop followed by a capital letter', () => {
    expect(
      sentences(
        'Омепразол Усиление антикоагулянтного эффекта варфарина. Циметидин может повышать концентрацию.',
      ),
    ).toEqual([
      'Омепразол Усиление антикоагулянтного эффекта варфарина.',
      'Циметидин может повышать концентрацию.',
    ]);
  });

  it('keeps a PDF-wrapped sentence together and a heading line with the sentence after it', () => {
    const text = [
      'С рацекадотрилом',
      '',
      'При одновременном применении ингибиторов АПФ и ингибиторов нейтральной',
      'эндопептидазы сообщалось о повышенном риске ангионевротического отека.',
      '',
      'С эстрамустином',
      'Повышенный риск нежелательных реакций.',
    ].join('\n');
    expect(sentences(text)).toEqual([
      'С рацекадотрилом При одновременном применении ингибиторов АПФ и ингибиторов нейтральной эндопептидазы сообщалось о повышенном риске ангионевротического отека.',
      'С эстрамустином Повышенный риск нежелательных реакций.',
    ]);
  });

  it('does not split after an abbreviation, inside a number or before a lower-case word', () => {
    expect(
      sentences('Доза 1.5 мг, т. е. половина таблетки, напр. Ципрофлоксацин не назначают.'),
    ).toEqual(['Доза 1.5 мг, т. е. половина таблетки, напр. Ципрофлоксацин не назначают.']);
    expect(sentences('Применять осторожно. и далее продолжение.')).toEqual([
      'Применять осторожно. и далее продолжение.',
    ]);
  });

  it('returns offsets that point at the same characters in the canonical text', () => {
    const canonical = canonicalSectionText([
      'Первое предложение закончено.',
      ' Второе начинается здесь',
      'и продолжается так.',
    ]);
    for (const span of splitSentenceSpans(canonical.text)) {
      expect(canonical.text.slice(span.start, span.end)).toBe(
        canonical.text.slice(span.start, span.end).trim(),
      );
    }
    const spans = splitSentenceSpans(canonical.text);
    expect(spans).toHaveLength(2);
    expect(canonical.text.slice(spans[1]?.start, spans[1]?.end)).toContain('и продолжается так.');
  });

  it('cuts a very long list without full stops at capitalised lines', () => {
    const lines = Array.from(
      { length: 80 },
      (_, index) => `Препарат номер ${index} усиливает действие`,
    );
    const spans = splitSentenceSpans(lines.join('\n'));
    expect(spans.length).toBeGreaterThan(1);
    for (const span of spans) expect(span.end - span.start).toBeLessThanOrEqual(1_200);
  });

  it('drops fragments too short to quote', () => {
    expect(sentences('Да. Нет.')).toEqual([]);
  });
});
