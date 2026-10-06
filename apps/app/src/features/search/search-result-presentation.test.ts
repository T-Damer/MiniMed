import { describe, expect, it } from 'vitest';
import {
  displaySectionPath,
  orderResultsForDisplay,
  presentResultSnippet,
  presentSourceChunkText,
  sourceContextKicker,
} from '@/features/search/search-result-presentation';

const POINTER =
  '…взрослых и детей. Объявленные алиасы: эпилептический статус, ЭС, Эпилепсия. Ключевые слова: не указано в каталоге. Официальный идентификатор: 741_1. МКБ-10: G40.0, G40.1.';

function rangeOf(text: string, word: string): { start: number; end: number } {
  const start = text.indexOf(word);
  return { start, end: start + word.length };
}

describe('presentResultSnippet', () => {
  it('renames catalogue labels, drops empty and identifier clauses and keeps highlights', () => {
    const presented = presentResultSnippet({
      snippet: POINTER,
      highlightedRanges: [rangeOf(POINTER, 'Эпилепсия'), rangeOf(POINTER, '741_1')],
      sectionPath: ['Сведения о документе'],
    });
    expect(presented.text).toBe(
      'Другие названия: эпилептический статус, ЭС, Эпилепсия. МКБ-10: G40.0, G40.1.',
    );
    expect(presented.ranges).toHaveLength(1);
    const [range] = presented.ranges;
    expect(presented.text.slice(range?.start, range?.end)).toBe('Эпилепсия');
  });

  it('drops the title clause and a cut clause at the end', () => {
    const snippet =
      'Название: Эпилепсия у детей. МКБ-10: G40. Полные данные находятся в скачиваемом';
    const presented = presentResultSnippet({
      snippet,
      highlightedRanges: [rangeOf(snippet, 'G40')],
      sectionPath: ['Сведения о документе'],
    });
    expect(presented.text).toBe('МКБ-10: G40.');
    expect(presented.text.slice(presented.ranges[0]?.start, presented.ranges[0]?.end)).toBe('G40');
  });

  it('drops the copied-from source and its address from an МКБ-10 line', () => {
    const snippet =
      'МКБ-10: G40 — Эпилепсия у детей. Источник: Красота и медицина; https://www.krasotaimedicina.ru/diseases/children/epilepsy.';
    expect(
      presentResultSnippet({ snippet, highlightedRanges: [], sectionPath: ['Сведения МКБ-10'] })
        .text,
    ).toBe('МКБ-10: G40 — Эпилепсия у детей.');
  });

  it('leaves the document’s own text untouched', () => {
    const snippet = 'Название: так в тексте. Объявленные алиасы: тоже.';
    expect(
      presentResultSnippet({ snippet, highlightedRanges: [], sectionPath: ['Краткое описание'] })
        .text,
    ).toBe(snippet);
  });
});

describe('orderResultsForDisplay', () => {
  it('puts the document’s own text before its technical card', () => {
    const technical = { sectionPath: ['Сведения МКБ-10'] };
    const own = { sectionPath: ['Краткое описание'] };
    expect(orderResultsForDisplay([technical, own])).toEqual([own, technical]);
    expect(orderResultsForDisplay([technical])).toEqual([technical]);
  });
});

describe('displaySectionPath', () => {
  it('names technical sections in reader words', () => {
    expect(displaySectionPath(['Сведения о документе'])).toEqual(['О документе']);
    expect(displaySectionPath(['Лечение'])).toEqual(['Лечение']);
  });
});

describe('sourceContextKicker', () => {
  const kicker = (sourceType: string, metadata?: Record<string, unknown>): string =>
    sourceContextKicker({ sourceType, metadata });

  it('names the kind of document the fragment comes from', () => {
    expect(kicker('clinical_recommendation')).toBe('В клинических рекомендациях');
    expect(kicker('official_drug_instruction')).toBe('В инструкции к препарату');
    expect(kicker('allmed_reference')).toBe('В справочнике по препаратам');
    expect(kicker('regulatory_act_federal_law')).toBe('В нормативном акте');
    expect(kicker('rls_mkb_reference')).toBe('В справочнике МКБ-10');
    expect(kicker('medical_reference')).toBe('В справочнике');
    expect(kicker('core_catalog_pointer', { catalogFamily: 'medication' })).toBe(
      'В справочнике по препаратам',
    );
    expect(kicker('core_catalog_pointer', { catalogFamily: 'legal' })).toBe('В нормативном акте');
    expect(kicker('x', { interactiveAssessmentId: 'phq-9' })).toBe('В описании опросника');
  });
});

describe('presentSourceChunkText', () => {
  it('drops catalogue clauses from a technical card, keeps the rest', () => {
    const text =
      'Название: Эпилепсия у детей. Объявленные алиасы: ЭС. Официальный идентификатор: 741_1. Ключевые слова: не указано в каталоге. Полные данные находятся в скачиваемом модуле «minimed-x» и не дублируются в ядре.';
    expect(presentSourceChunkText(text, ['Сведения о документе'])).toBe('Другие названия: ЭС.');
  });

  it('leaves the document’s own text and an all-technical chunk as they are', () => {
    const own = 'Название: так в тексте. Объявленные алиасы: тоже.';
    expect(presentSourceChunkText(own, ['Лечение'])).toBe(own);
    const empty = 'Название: Эпилепсия.';
    expect(presentSourceChunkText(empty, ['Сведения о документе'])).toBe(empty);
  });
});
