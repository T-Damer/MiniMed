import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  nestDocumentSections,
  orderDocumentSections,
  visibleReaderSections,
} from '@/features/library/document-display';

function section(id: string, title: string, depth = 1): MedicalSection {
  return {
    id,
    title,
    documentVersionId: 'v1',
    parentSectionId: null,
    sectionType: null,
    depth,
    orderIndex: 0,
    pageStart: null,
    pageEnd: null,
    anchor: `source/${id}`,
    sectionPath: [title],
    chunks: [
      {
        id: `${id}.chunk`,
        sectionId: id,
        documentVersionId: 'v1',
        orderIndex: 0,
        originalText: `Synthetic source text for ${id}.`,
        pageStart: null,
        pageEnd: null,
        anchor: `source/${id}/chunk`,
      },
    ],
  };
}

describe('generated pointer presentation', () => {
  it.each(['Краткое описание', 'Определение'])('shows %s before routing metadata', (title) => {
    const routing = section('routing', 'Указатель справочного материала');
    const description = section('description', title);
    const details = section('details', 'Сведения о документе');
    const input = [routing, description, details];
    const before = JSON.stringify(input);
    const ordered = visibleReaderSections(input, 'core_catalog_pointer');

    expect(ordered.map((item) => item.id)).toEqual(['description', 'routing', 'details']);
    expect(ordered[0]).toBe(description);
    expect(ordered[1]).toBe(routing);
    expect(ordered[2]).toBe(details);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('moves whole root subtrees without attaching metadata children to a definition', () => {
    const routing = section('routing', 'Указатель справочного материала');
    const source = { ...section('source', 'Источник', 2), parentSectionId: routing.id };
    const description = section('description', 'Краткое описание');
    const example = { ...section('example', 'Пример', 2), parentSectionId: description.id };
    const details = section('details', 'Сведения о документе');
    const input = [routing, source, description, example, details];
    const ordered = orderDocumentSections(input, 'core_catalog_pointer');

    expect(ordered.map((item) => item.id)).toEqual([
      'description',
      'example',
      'routing',
      'source',
      'details',
    ]);
    const tree = nestDocumentSections(ordered);
    expect(tree[0]?.children[0]?.section).toBe(example);
    expect(tree[1]?.children[0]?.section).toBe(source);
    expect(ordered.every((item) => input.includes(item))).toBe(true);
  });

  it('does not reorder full clinical source documents', () => {
    const input = [section('intro', 'Введение'), section('definition', 'Определение')];
    expect(orderDocumentSections(input, 'clinical_recommendation')).toBe(input);
    expect(orderDocumentSections(input, 'medical_reference')).toBe(input);
  });

  it('leaves pointers without a root description unchanged', () => {
    const input = [
      section('routing', 'Указатель справочного материала'),
      section('nested', 'Определение', 2),
      section('details', 'Сведения о документе'),
    ];
    expect(orderDocumentSections(input, 'core_catalog_pointer')).toBe(input);
  });

  it('retains a stable order for several source-backed description roots', () => {
    const input = [
      section('routing', 'Указатель справочного материала'),
      section('short', 'Краткое описание'),
      section('definition', 'Определение'),
      section('details', 'Сведения о документе'),
    ];
    expect(orderDocumentSections(input, 'core_catalog_pointer').map((item) => item.id)).toEqual([
      'short',
      'definition',
      'routing',
      'details',
    ]);
  });
});
