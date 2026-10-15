import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  glossaryLast,
  hasFullTextSibling,
  isAdministrativeMedicationSection,
  isFullTextDocumentId,
  nestDocumentSections,
  orderDocumentSections,
  preferReadableDocuments,
  resolveReadableDocumentId,
  summaryDocumentId,
  visibleReaderSections,
  wordTitlesFirst,
} from '@/features/library/document-display';

const section = (title: string): MedicalSection => ({
  id: title,
  documentVersionId: 'v1',
  parentSectionId: null,
  title,
  sectionType: null,
  depth: 0,
  orderIndex: 0,
  pageStart: null,
  pageEnd: null,
  anchor: title,
  sectionPath: [title],
  chunks: [
    {
      id: `${title}-chunk`,
      sectionId: title,
      documentVersionId: 'v1',
      orderIndex: 0,
      originalText: 'text',
      pageStart: null,
      pageEnd: null,
      anchor: `${title}-chunk`,
    },
  ],
});

describe('document-display', () => {
  it('preserves Markdown section depth in rendered heading levels', () => {
    expect([1, 2, 3, 4, 5, 6].map((depth) => documentSectionHeadingTag(depth))).toEqual([
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'h6',
    ]);
    expect(documentSectionHeadingTag(1, 2)).toBe('h3');
  });

  it('nests sections so parent sticky headings contain their children', () => {
    const sections = [1, 2, 3, 2, 1].map((depth, index) => ({
      ...section(`section-${index}`),
      depth,
    }));
    const tree = nestDocumentSections(sections);
    expect(tree.map((node) => node.section.title)).toEqual(['section-0', 'section-4']);
    expect(tree[0]?.children.map((node) => node.section.title)).toEqual(['section-1', 'section-3']);
    expect(tree[0]?.children[0]?.children.map((node) => node.section.title)).toEqual(['section-2']);
  });

  it('uses INN for registry drug titles', () => {
    expect(
      displayDocumentTitle({
        title: 'Цефтриаксон — порошок для инъекций 1 г',
        shortTitle: 'Цефтриаксон 1 г',
        sourceType: 'official_registry_summary',
      }),
    ).toBe('Цефтриаксон');
  });

  it('opens a drug monograph under its Russian trade name, not the Latin short title', () => {
    expect(
      displayDocumentTitle({
        title: 'Терафлю',
        shortTitle: 'Theraflu',
        sourceType: 'allmed_reference',
      }),
    ).toBe('Терафлю');
    expect(
      displayDocumentTitle({
        title: 'Колдакт Флю Плюс',
        shortTitle: 'Coldact Flu Plus',
        sourceType: 'allmed_reference',
      }),
    ).toBe('Колдакт Флю Плюс');
    // A monograph whose title is Latin keeps it; so does a short title written in Russian.
    expect(
      displayDocumentTitle({
        title: 'Aspirin',
        shortTitle: 'Aspirin',
        sourceType: 'allmed_reference',
      }),
    ).toBe('Aspirin');
    expect(
      displayDocumentTitle({
        title: 'Ибупрофен: справка',
        shortTitle: 'Ибупрофен',
        sourceType: 'allmed_reference',
      }),
    ).toBe('Ибупрофен');
  });

  it('keeps clinical titles unchanged', () => {
    expect(
      displayDocumentTitle({
        title: 'Внебольничная пневмония у детей',
        shortTitle: 'Пневмония',
        sourceType: 'clinical_recommendation_summary',
      }),
    ).toBe('Пневмония');
  });

  it('moves registry sections to the end', () => {
    const ordered = orderDocumentSections(
      [section('Регистрационная запись'), section('Показания'), section('Ограничения')],
      'official_registry_summary',
    );
    expect(ordered.map((item) => item.title)).toEqual([
      'Показания',
      'Регистрационная запись',
      'Ограничения',
    ]);
  });

  it('moves typed registration sections of an instruction to the end', () => {
    const registration = { ...section('Регистрационный номер'), sectionType: 'registration' };
    const ordered = orderDocumentSections(
      [registration, section('Показания к применению'), section('Способ применения и дозы')],
      'official_drug_instruction',
    );
    expect(ordered.map((item) => item.title)).toEqual([
      'Показания к применению',
      'Способ применения и дозы',
      'Регистрационный номер',
    ]);
    expect(isAdministrativeMedicationSection(registration, 'official_drug_instruction')).toBe(true);
    // Only medication readers demote registration details.
    expect(isAdministrativeMedicationSection(registration, 'clinical_recommendation')).toBe(false);
    expect(
      isAdministrativeMedicationSection(
        section('Регистрационный номер'),
        'official_drug_instruction',
      ),
    ).toBe(false);
  });

  it('puts a card’s technical sections after its own text, in any source', () => {
    const ordered = orderDocumentSections(
      [
        section('Сведения МКБ-10'),
        section('Классификационный контекст'),
        section('Краткое описание'),
      ],
      'core_catalog_pointer',
    );
    expect(ordered.map((item) => item.title)).toEqual([
      'Краткое описание',
      'Сведения МКБ-10',
      'Классификационный контекст',
    ]);
    // A card with nothing but technical sections keeps them as they are.
    const only = [section('Сведения о документе')];
    expect(orderDocumentSections(only, 'core_catalog_pointer')).toBe(only);
  });

  it('drops empty sections and the redundant Allmed medication card section', () => {
    const emptySection = { ...section('Пустой'), chunks: [] };
    const visible = visibleReaderSections(
      [section('Карточка препарата'), emptySection, section('Показания')],
      'allmed_reference',
    );
    expect(visible.map((item) => item.title)).toEqual(['Показания']);
  });

  it('keeps a chapter without text of its own when its subsections have text', () => {
    const chapter = { ...section('3. Лечение'), depth: 1, chunks: [] };
    const sub = { ...section('3.1 Алгоритм'), depth: 2 };
    const emptyChapter = { ...section('4. Пусто'), depth: 1, chunks: [] };
    const emptyChild = { ...section('4.1 Тоже пусто'), depth: 2, chunks: [] };
    const next = { ...section('5. Профилактика'), depth: 1 };
    const visible = visibleReaderSections(
      [chapter, sub, emptyChapter, emptyChild, next],
      'clinical_recommendation',
    );
    expect(visible.map((item) => item.title)).toEqual([
      '3. Лечение',
      '3.1 Алгоритм',
      '5. Профилактика',
    ]);
    // Nested under its own chapter, not under the section before it.
    expect(nestDocumentSections(visible).map((node) => node.section.title)).toEqual([
      '3. Лечение',
      '5. Профилактика',
    ]);
  });

  it('keeps a Карточка препарата heading on non-medication documents', () => {
    const visible = visibleReaderSections(
      [section('Карточка препарата'), section('Показания')],
      'clinical_recommendation',
    );
    expect(visible.map((item) => item.title)).toEqual(['Карточка препарата', 'Показания']);
  });

  it('exposes registry form as subtitle', () => {
    expect(
      displayDocumentSubtitle({
        title: 'Цефтриаксон — порошок для инъекций 1 г',
        sourceType: 'official_registry_summary',
      }),
    ).toBe('порошок для инъекций 1 г');
  });

  it('prefers installed full-text siblings when opening documents', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2.pneumonia.full']);
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia', available)).toBe(
      'kr.rf.714_2.pneumonia.full',
    );
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia.full', available)).toBe(
      'kr.rf.714_2.pneumonia.full',
    );
  });

  it('prefers installed structured recommendations over starter summaries', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2']);
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia', available)).toBe('kr.rf.714_2');
  });

  it('hides pilot summaries when full-text packs are installed', () => {
    const visible = preferReadableDocuments([
      {
        id: 'kr.rf.714_2.pneumonia',
        title: 'Внебольничная пневмония у детей',
        shortTitle: null,
        sourceType: 'clinical_recommendation_summary',
        status: 'active',
        specialties: [],
        versionId: 'v1',
        versionLabel: '714_2-2025',
        effectiveFrom: null,
      },
      {
        id: 'kr.rf.714_2.pneumonia.full',
        title: 'Внебольничная пневмония у детей',
        shortTitle: null,
        sourceType: 'clinical_recommendation',
        status: 'active',
        specialties: [],
        versionId: 'v2',
        versionLabel: '714_2-2025-full',
        effectiveFrom: null,
      },
    ]);
    expect(visible.map((document) => document.id)).toEqual(['kr.rf.714_2.pneumonia.full']);
  });

  it('hides starter summaries when their structured recommendation is installed', () => {
    const visible = preferReadableDocuments([
      {
        id: 'kr.rf.714_2.pneumonia',
        title: 'Внебольничная пневмония у детей',
        shortTitle: null,
        sourceType: 'clinical_recommendation_summary',
        status: 'active',
        specialties: [],
        versionId: 'v1',
        versionLabel: '714_2-2025',
        effectiveFrom: null,
      },
      {
        id: 'kr.rf.714_2',
        title: 'Пневмония (внебольничная)',
        shortTitle: null,
        sourceType: 'clinical_recommendation',
        status: 'active',
        specialties: [],
        versionId: 'v2',
        versionLabel: '714_2',
        effectiveFrom: null,
      },
    ]);
    expect(visible.map((document) => document.id)).toEqual(['kr.rf.714_2']);
  });

  it('detects full-text siblings for summary cards', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2.pneumonia.full']);
    expect(hasFullTextSibling('kr.rf.714_2.pneumonia', available)).toBe(true);
    expect(isFullTextDocumentId('kr.rf.714_2.pneumonia.full')).toBe(true);
    expect(summaryDocumentId('kr.rf.714_2.pneumonia.full')).toBe('kr.rf.714_2.pneumonia');
  });
});

describe('the reader opens on the text', () => {
  it('moves the abbreviation list with its subsections behind the chapters', () => {
    const at = (title: string, depth: number): MedicalSection => ({ ...section(title), depth });
    const ordered = glossaryLast([
      at('Список сокращений', 0),
      at('Сокращения клинические', 1),
      at('1. Краткая информация', 0),
      at('1.1 Определение', 1),
      at('2. Диагностика', 0),
    ]);
    expect(ordered.map((entry) => entry.title)).toEqual([
      '1. Краткая информация',
      '1.1 Определение',
      '2. Диагностика',
      'Список сокращений',
      'Сокращения клинические',
    ]);
  });

  it('leaves a document without a glossary as it is', () => {
    const sections = [section('A'), section('B')];
    expect(glossaryLast(sections)).toBe(sections);
  });
});

describe('a list with no query', () => {
  it('opens on names that begin with a letter', () => {
    const doc = (title: string) =>
      ({ title, shortTitle: title, sourceType: 'x', metadata: {} }) as unknown as Parameters<
        typeof wordTitlesFirst
      >[0][number];
    const titles = wordTitlesFirst([
      doc('1-(4-БРОМФЕНИЛ)ВИОЛУРОВАЯ КИСЛОТА'),
      doc('Амоксициллин'),
      doc('[2-(тест)]'),
      doc('Ибупрофен'),
    ]).map((item) => item.title);
    expect(titles).toEqual([
      'Амоксициллин',
      'Ибупрофен',
      '1-(4-БРОМФЕНИЛ)ВИОЛУРОВАЯ КИСЛОТА',
      '[2-(тест)]',
    ]);
  });
});
