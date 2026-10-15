import { describe, expect, it } from 'vitest';
import {
  displaySectionPath,
  orderResultsForDisplay,
  presentResultSnippet,
  presentSourceChunkText,
  repeatedResultTitles,
  resultQualifier,
  sourceContextKicker,
  splitResultTitle,
  tidyResultTitle,
  tidySnippetEnd,
  tidySnippetStart,
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

  it('names specialties in words, not by their catalogue slugs', () => {
    const snippet =
      'МКБ-10: F32, F33. Специальности: psychiatry, addiction-medicine. Возраст: Взрослые.';
    const presented = presentResultSnippet({
      snippet,
      highlightedRanges: [],
      sectionPath: ['Сведения о документе'],
    });
    expect(presented.text).not.toMatch(/psychiatry|addiction-medicine/u);
    expect(presented.text).toContain('Специальности: Психиатрия');
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
    sourceContextKicker(metadata ? { sourceType, metadata } : { sourceType });

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

  it('drops where a medication pointer’s full data is stored, keeps the standard name', () => {
    const text =
      'Стандартизированное МНН: ПАРАЦЕТАМОЛ.\n\nПолные данные находятся в скачиваемом модуле «minimed.medications.nervous-system.ru» и не дублируются в ядре.';
    expect(presentSourceChunkText(text, ['Указатель препарата'])).toBe(
      'Стандартизированное МНН: ПАРАЦЕТАМОЛ.',
    );
  });

  it('leaves the document’s own text and an all-technical chunk as they are', () => {
    const own = 'Название: так в тексте. Объявленные алиасы: тоже.';
    expect(presentSourceChunkText(own, ['Лечение'])).toBe(own);
    const empty = 'Название: Эпилепсия.';
    expect(presentSourceChunkText(empty, ['Сведения о документе'])).toBe(empty);
  });
});

describe('a drug pointer’s «Указатель препарата»', () => {
  it('stays in place, since it carries the МНН, but loses the storage note', () => {
    const index = {
      sectionPath: ['Указатель препарата'],
      snippet:
        'Стандартизированное МНН: ПАРАЦЕТАМОЛ. Полные данные находятся в скачиваемом модуле «minimed.x» и не дублируются в ядре.',
      highlightedRanges: [],
    };
    const code = {
      sectionPath: ['Указатель препарата', '21.20.10'],
      snippet: 'x',
      highlightedRanges: [],
    };
    expect(orderResultsForDisplay([index, code])).toEqual([index, code]);
    expect(presentResultSnippet(index).text).toBe('Стандартизированное МНН: ПАРАЦЕТАМОЛ.');
  });
});

describe('where a snippet starts', () => {
  it('marks an unmarked cut and drops the stub after a marked one', () => {
    expect(tidySnippetStart('кишки или желудка (всегда', [])).toEqual({
      text: '…кишки или желудка (всегда',
      ranges: [],
    });
    expect(tidySnippetStart('…орных отделов легких', [{ start: 7, end: 14 }])).toEqual({
      text: '…отделов легких',
      ranges: [{ start: 1, end: 8 }],
    });
    expect(tidySnippetStart('Эрадикация Helicobacter', [])).toEqual({
      text: 'Эрадикация Helicobacter',
      ranges: [],
    });
  });

  it('keeps a highlighted first word after the mark', () => {
    expect(tidySnippetStart('…пневмония у детей', [{ start: 1, end: 10 }]).text).toBe(
      '…пневмония у детей',
    );
  });
});

describe('titles of result cards', () => {
  it('loses the space inside brackets and names the repeated ones', () => {
    expect(tidyResultTitle('( Очаговая пневмония у детей )')).toBe('(Очаговая пневмония у детей)');
    expect([...repeatedResultTitles(['A', 'B', 'A', 'C', 'A'])]).toEqual(['A']);
  });
});

describe('registry identifiers in a result card', () => {
  it('drops the dosage-form code and the machine status from any snippet, highlights kept', () => {
    const snippet =
      'Стандартизированное МНН: Умифеновир. Статус записи ЕСКЛП: active. СМНН: Умифеновир; mnnCode: 21.20.10.194-000001-1-00001-0000000000000. Формы: таблетки.';
    const presented = presentResultSnippet({
      snippet,
      highlightedRanges: [rangeOf(snippet, 'таблетки')],
      sectionPath: ['Сведения о стандартизированном МНН'],
    });
    expect(presented.text).not.toMatch(/mnnCode|Статус записи|21\.20\.10/u);
    expect(presented.text).toContain('Формы: таблетки.');
    expect(presented.text.slice(presented.ranges[0]?.start, presented.ranges[0]?.end)).toBe(
      'таблетки',
    );
  });
});

describe('the qualifier of a repeated title', () => {
  it('never shows a source identifier as an edition', () => {
    for (const label of ['site-4df3e404f895', 'a1b2c3d4e5f6a7b8']) {
      expect(
        resultQualifier({
          sourceType: 'official_clinical_recommendation',
          metadata: {},
          versionLabel: label,
        }),
      ).toBeUndefined();
    }
    expect(
      resultQualifier({
        sourceType: 'official_clinical_recommendation',
        metadata: {},
        versionLabel: 'Редакция 2024',
      }),
    ).toBe('Редакция 2024');
  });

  it('reads the edition of a recommendation from its «code_edition» label', () => {
    expect(
      resultQualifier({
        sourceType: 'official_clinical_recommendation',
        metadata: {},
        versionLabel: '459_2',
      }),
    ).toBe('ред. 2');
  });
});

describe('the end of a cut snippet', () => {
  it('drops a word stub before the closing mark and shortens its highlights', () => {
    const text = 'Аллергия на пенициллин – это реакция на пе…';
    const result = tidySnippetEnd(text, [
      { start: 12, end: 22 },
      { start: 40, end: 42 },
    ]);
    expect(result.text).toBe('Аллергия на пенициллин – это реакция на…');
    expect(result.ranges).toEqual([{ start: 12, end: 22 }]);
  });

  it('leaves a snippet that ends at a word boundary or has no mark', () => {
    expect(tidySnippetEnd('Полный текст.', []).text).toBe('Полный текст.');
    expect(tidySnippetEnd('Конец предложения, …', []).text).toBe('Конец предложения, …');
    expect(tidySnippetEnd('слово…', []).text).toBe('слово…');
  });
});

describe('the title of a result card', () => {
  it('moves a trailing «[НАБОР]» marker into the meta line', () => {
    expect(splitResultTitle('АМОКСИЦИЛЛИН+КЛАРИТРОМИЦИН+ОМЕПРАЗОЛ [НАБОР]')).toEqual({
      title: 'АМОКСИЦИЛЛИН+КЛАРИТРОМИЦИН+ОМЕПРАЗОЛ',
      meta: 'Набор',
    });
    expect(splitResultTitle('Пневмония [ J18 ] у детей').meta).toBeUndefined();
    expect(splitResultTitle('[НАБОР]').meta).toBeUndefined();
  });
});
