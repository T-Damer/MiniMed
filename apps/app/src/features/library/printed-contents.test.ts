import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { isContentsLine, presentContentsLine, splitPrintedContents } from './printed-contents';

const DOTS = '.'.repeat(60);

function section(title: string, ...texts: string[]): MedicalSection {
  return {
    id: title,
    documentVersionId: 'v1',
    parentSectionId: null,
    title,
    sectionType: null,
    depth: 1,
    orderIndex: 0,
    pageStart: null,
    pageEnd: null,
    anchor: `s:${title}`,
    sectionPath: [title],
    chunks: texts.map((originalText, index) => ({
      id: `${title}-${String(index)}`,
      sectionId: title,
      documentVersionId: 'v1',
      orderIndex: index,
      originalText,
      pageStart: null,
      pageEnd: null,
      anchor: `c:${title}-${String(index)}`,
    })),
  };
}

describe('printed contents', () => {
  it('recognises contents lines by their leader dots, not by ordinary dots', () => {
    expect(isContentsLine(`Список сокращений ${DOTS} 4`)).toBe(true);
    expect(isContentsLine('медицинские показания и противопоказания .. 17')).toBe(true);
    expect(isContentsLine('1. Краткая информация. Определение.')).toBe(false);
    expect(isContentsLine('Доза 0.5 мг...')).toBe(false);
  });

  it('splits the leading contents of a guideline into one block (КР 714_2)', () => {
    const sections = [
      section('Общая информация', `Оглавление\n\nСписок сокращений ${DOTS} 4\n\nТермины ${DOTS} 7`),
      section(`1.1. Определение ${DOTS} 8`, `1.2. Этиология ${DOTS} 9`),
      section(`1.2.3. Патогенез ВП ${DOTS} 17`),
      section(
        'Список сокращений',
        'АБР – антибиотикорезистентность\n\nАБТ – антибактериальная терапия',
      ),
      section('1.1. Определение', 'Пневмония – острое инфекционное заболевание.'),
    ];
    const split = splitPrintedContents(sections);

    expect(split.sections.map((item) => item.title)).toEqual([
      'Общая информация',
      `1.1. Определение ${DOTS} 8`,
      `1.2.3. Патогенез ВП ${DOTS} 17`,
    ]);
    expect(split.body.map((item) => item.title)).toEqual(['Список сокращений', '1.1. Определение']);
  });

  it('moves the contents chunks that spill into the next section and keeps its own text', () => {
    const sections = [
      section(`1. Краткая информация ${DOTS} 5`),
      section(`2. Диагностика ${DOTS} 17`),
      section(
        '5. Профилактика и диспансерное наблюдение',
        `6. Организация ${DOTS} 51`,
        'МНО – международное нормализованное отношение',
      ),
      section('Термины и определения', 'Дефект – ...'),
    ];
    const split = splitPrintedContents(sections);

    expect(split.sections).toHaveLength(3);
    expect(split.body).toHaveLength(2);
    expect(split.body[0]?.chunks.map((chunk) => chunk.originalText)).toEqual([
      'МНО – международное нормализованное отношение',
    ]);
    // Nothing of the source text is lost.
    const textOf = (list: readonly MedicalSection[]): string =>
      list.flatMap((item) => item.chunks.map((chunk) => chunk.originalText)).join('\n');
    expect(textOf([...split.sections, ...split.body])).toBe(textOf(sections));
  });

  it('keeps a title page and starts the contents at the «Оглавление» line inside a chunk', () => {
    const sections = [
      section('Клинические рекомендации Острый бронхиолит', 'Кодирование по МКБ: J21'),
      section(
        'J21.0; J21.1',
        `Возрастная группа: Дети\nГод утверждения: 20_\n\nОглавление Список сокращений ${DOTS} 4\n\nТермины ${DOTS} 5`,
      ),
      section(`1.1 Определение ${DOTS} 6`),
      section(`1.2 Этиология ${DOTS} 7`),
      section('Список сокращений', 'ВП – внебольничная пневмония'),
    ];
    const split = splitPrintedContents(sections);

    expect(split.body.map((item) => item.title)).toEqual([
      'Клинические рекомендации Острый бронхиолит',
      'J21.0; J21.1',
      'Список сокращений',
    ]);
    expect(split.body[1]?.chunks[0]?.originalText).toBe(
      'Возрастная группа: Дети\nГод утверждения: 20_',
    );
    expect(split.sections[0]?.chunks[0]?.originalText).toMatch(/^Оглавление Список сокращений/u);
    expect(split.sections.map((item) => item.title)).toEqual([
      '',
      `1.1 Определение ${DOTS} 6`,
      `1.2 Этиология ${DOTS} 7`,
    ]);
  });

  it('leaves a document without leading contents, and leaders further down, alone', () => {
    const plain = [
      section('Определение', 'Текст.'),
      section('Этиология', 'Текст.'),
      section('Диагностика', 'Текст.'),
      section('Лечение', 'Текст.'),
      section('Таблица', `Раздел ${DOTS} 5\nРаздел ${DOTS} 7`),
    ];
    expect(splitPrintedContents(plain)).toEqual({ sections: [], body: plain });
  });

  it('keeps the own «Содержание» list of a legal act (annexes, no leaders) as text', () => {
    const act = [
      section(
        'Приказ № 1122н',
        '«Об утверждении национального календаря профилактических прививок»',
      ),
      section(
        'Содержание',
        '- Приложение № 1 — Национальный календарь\n- Приложение № 2 — Календарь по эпидемическим показаниям',
      ),
      section('Источник и редакция', 'Приказ Минздрава России от 6 декабря 2021 г. № 1122н.'),
    ];
    expect(splitPrintedContents(act, { titledContents: false })).toEqual({
      sections: [],
      body: act,
    });
    // The same shape in a guideline is its flattened printed contents.
    expect(splitPrintedContents(act).sections.map((item) => item.title)).toEqual(['Содержание']);
  });

  it('shows a contents line with one ellipsis for its leader dots', () => {
    expect(presentContentsLine(`Список сокращений ${DOTS} 4`)).toBe('Список сокращений … 4');
  });
});
