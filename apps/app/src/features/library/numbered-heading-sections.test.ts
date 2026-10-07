import type { MedicalChunk, MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { nestDocumentSections, visibleReaderSections } from '@/features/library/document-display';
import {
  isClinicalRecommendationSource,
  promoteNumberedHeadingSections,
} from '@/features/library/numbered-heading-sections';

function chunk(id: string, text: string, extra: Partial<MedicalChunk> = {}): MedicalChunk {
  return {
    id,
    sectionId: 'section.s',
    documentVersionId: 'kr.rf.1@1',
    orderIndex: 0,
    originalText: text,
    pageStart: null,
    pageEnd: null,
    anchor: `kr.rf.1@1/s#${id}`,
    ...extra,
  };
}

function section(
  id: string,
  title: string,
  depth: number,
  chunks: readonly MedicalChunk[],
): MedicalSection {
  return {
    id,
    documentVersionId: 'kr.rf.1@1',
    parentSectionId: null,
    title,
    sectionType: null,
    depth,
    orderIndex: 0,
    pageStart: null,
    pageEnd: null,
    anchor: `kr.rf.1@1/${id}`,
    sectionPath: [title],
    chunks,
  };
}

describe('promoteNumberedHeadingSections', () => {
  it('returns the same sections when no paragraph is a numbered heading', () => {
    const sections = [
      section('a', '1. Краткая информация', 1, [chunk('c1', 'Первый абзац.\n\nВторой абзац.')]),
    ];
    expect(promoteNumberedHeadingSections(sections)).toBe(sections);
  });

  it('cuts a chunk at a heading: lead stays, the heading becomes a section with the text after it', () => {
    const original = chunk(
      'c1',
      'Текст до заголовка.\n\n1.2.2.1 Эпидемиология\n\nЗаболеваемость составляет 3 на 100 тыс.',
    );
    const result = promoteNumberedHeadingSections([section('a', '1.2 Этиология', 2, [original])]);
    expect(result).toHaveLength(2);
    const [parent, heading] = result;
    // The stored section keeps its identity and anchor; the lead keeps the chunk's id and anchor.
    expect(parent?.id).toBe('a');
    expect(parent?.anchor).toBe('kr.rf.1@1/a');
    expect(parent?.chunks).toHaveLength(1);
    expect(parent?.chunks[0]?.id).toBe('c1');
    expect(parent?.chunks[0]?.anchor).toBe(original.anchor);
    expect(parent?.chunks[0]?.originalText).toBe('Текст до заголовка.');
    // The heading is a section of depth 4 with its own anchor and the text after it.
    expect(heading?.title).toBe('1.2.2.1 Эпидемиология');
    expect(heading?.depth).toBe(4);
    expect(heading?.anchor).toBe(`${original.anchor}~h0`);
    expect(heading?.sectionPath).toEqual(['1.2 Этиология', '1.2.2.1 Эпидемиология']);
    expect(heading?.parentSectionId).toBe('a');
    expect(heading?.chunks.map((item) => item.originalText)).toEqual([
      'Заболеваемость составляет 3 на 100 тыс.',
    ]);
  });

  it('gives the chunk identity to the text after a heading that opens the chunk', () => {
    const original = chunk('c1', '3.2 Хирургическое лечение\n\nПоказания к операции.');
    const [parent, heading] = promoteNumberedHeadingSections([
      section('a', '3. Лечение', 1, [original]),
    ]);
    // Nothing is left of the chunk before the heading: a link to the chunk lands on its text.
    expect(parent?.chunks).toHaveLength(0);
    expect(heading?.chunks[0]?.id).toBe('c1');
    expect(heading?.chunks[0]?.anchor).toBe(original.anchor);
    expect(heading?.anchor).toBe(`${original.anchor}~h0`);
  });

  it('moves the chunks that follow a heading into its section until the next heading', () => {
    const tail = section('b', '4. Реабилитация', 1, [chunk('c4', 'Реабилитация проводится.')]);
    const sections = promoteNumberedHeadingSections([
      section('a', '3. Лечение', 1, [
        chunk('c1', 'Вступление.\n\n3.1 Консервативное лечение\n\nПервая часть.'),
        chunk('c2', 'Продолжение консервативного лечения.'),
        chunk(
          'c3',
          '3.2 Хирургическое лечение\n\nОперация.\n\n3.2.1 Показания\n\nПоказаны при угрозе жизни.',
        ),
      ]),
      tail,
    ]);
    expect(sections.map((item) => item.title)).toEqual([
      '3. Лечение',
      '3.1 Консервативное лечение',
      '3.2 Хирургическое лечение',
      '3.2.1 Показания',
      '4. Реабилитация',
    ]);
    expect(sections[1]?.chunks.map((item) => item.originalText)).toEqual([
      'Первая часть.',
      'Продолжение консервативного лечения.',
    ]);
    expect(sections[2]?.chunks[0]?.originalText).toBe('Операция.');
    expect(sections[3]?.chunks[0]?.originalText).toBe('Показаны при угрозе жизни.');
    // The next stored section is the very same object.
    expect(sections[4]).toBe(tail);
  });

  it('keeps every id and anchor unique', () => {
    const sections = promoteNumberedHeadingSections([
      section('a', '1. Раздел', 1, [
        chunk('c1', 'А\n\n1.1 Первый\n\nБ\n\n1.2 Второй\n\nВ'),
        chunk('c2', '1.3 Третий\n\nГ'),
      ]),
    ]);
    const anchors = sections.flatMap((item) => [item.anchor, ...item.chunks.map((c) => c.anchor)]);
    const ids = sections.flatMap((item) => [item.id, ...item.chunks.map((c) => c.id)]);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the chunk text of a section without headings untouched, byte for byte', () => {
    const text = 'Абзац 1.\n\n\n  \nАбзац 2 с числом 1.5 мг.';
    const original = chunk('c1', text);
    const [result] = promoteNumberedHeadingSections([section('a', '1. Раздел', 1, [original])]);
    expect(result?.chunks[0]).toBe(original);
  });

  it('slices the source spans of a cut chunk along the paragraphs', () => {
    const spans = [{ page: 1 }, { page: 1 }, { page: 2 }, { page: 2 }];
    const original = chunk('c1', 'Один.\n\n2.1 Заголовок\n\nТри.\n\nЧетыре.', {
      metadata: { sourceSpans: spans },
    });
    const [parent, heading] = promoteNumberedHeadingSections([
      section('a', '2. Раздел', 1, [original]),
    ]);
    expect(parent?.chunks[0]?.metadata?.['sourceSpans']).toEqual([{ page: 1 }]);
    expect(heading?.chunks[0]?.metadata?.['sourceSpans']).toEqual([{ page: 2 }, { page: 2 }]);
  });

  it('does not cut rich blocks', () => {
    const rich = chunk('c1', '3.1 Заголовок таблицы', {
      metadata: {
        renderBlock: {
          kind: 'table',
          caption: '',
          rows: [{ cells: [{ text: '3.1 Заголовок', rowSpan: 1, colSpan: 1 }] }],
        },
      },
    });
    const sections = [section('a', '3. Раздел', 1, [rich])];
    expect(promoteNumberedHeadingSections(sections)).toBe(sections);
  });

  it('nests promoted headings by their number in the reader tree', () => {
    const tree = nestDocumentSections(
      promoteNumberedHeadingSections([
        section('a', '3. Лечение', 1, [
          chunk(
            'c1',
            '3.1 Консервативное\n\nТекст\n\n3.1.1 Препараты\n\nСписок\n\n3.2 Хирургическое\n\nОперация',
          ),
        ]),
      ]),
    );
    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root?.children.map((node) => node.section.title)).toEqual([
      '3.1 Консервативное',
      '3.2 Хирургическое',
    ]);
    expect(root?.children[0]?.children.map((node) => node.section.title)).toEqual([
      '3.1.1 Препараты',
    ]);
  });
});

describe('visibleReaderSections', () => {
  const sections = [
    section('a', '2. Диагностика', 1, [chunk('c1', '2.1 Жалобы и анамнез\n\nСобирают жалобы.')]),
  ];

  it('promotes numbered headings of clinical recommendations only', () => {
    expect(visibleReaderSections(sections, 'clinical_recommendation')).toHaveLength(2);
    expect(visibleReaderSections(sections, 'clinical_recommendation_summary')).toHaveLength(2);
    expect(visibleReaderSections(sections, 'official_drug_instruction')).toHaveLength(1);
    expect(isClinicalRecommendationSource('regulatory_act')).toBe(false);
  });

  it('keeps a section that is left without text of its own', () => {
    const visible = visibleReaderSections(sections, 'clinical_recommendation');
    expect(visible[0]?.title).toBe('2. Диагностика');
    expect(visible[0]?.chunks).toHaveLength(0);
  });
});
