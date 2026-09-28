import { describe, expect, it } from 'vitest';

import type { SearchCatalogSection } from '@/features/search/searchCatalog';
import { formatSectionCount, sectionsOverviewRows } from '@/features/search/sections-overview';

const forms = ['рекомендация', 'рекомендации', 'рекомендаций'] as const;

describe('sections overview', () => {
  it('pluralizes the counted noun and keeps it with its number', () => {
    expect(
      [1, 2, 5, 11, 21, 104, 744, 3324].map((count) => formatSectionCount(count, forms)),
    ).toEqual([
      '1 рекомендация',
      '2 рекомендации',
      '5 рекомендаций',
      '11 рекомендаций',
      '21 рекомендация',
      '104 рекомендации',
      '744 рекомендации',
      `${(3324).toLocaleString('ru-RU')} рекомендации`,
    ]);
  });

  it('lists only sections that say what they count, in order, and marks empty ones', () => {
    const section = (
      id: SearchCatalogSection['id'],
      count: number,
      countNoun?: SearchCatalogSection['countNoun'],
    ): SearchCatalogSection => ({
      id,
      label: id,
      icon: 'books',
      count,
      groups: [],
      ...(countNoun ? { countNoun } : {}),
    });
    const sections = [
      section('all', 20111),
      section('guidelines', 744, forms),
      section('legal', 0, ['документ', 'документа', 'документов']),
      section('diagnosis', 0),
    ];
    expect(sectionsOverviewRows(sections, false)).toEqual([
      expect.objectContaining({ id: 'guidelines', countLabel: '744 рекомендации', empty: false }),
      expect.objectContaining({ id: 'legal', countLabel: '0 документов', empty: true }),
    ]);
    // While the catalog is counted there is no number, and nothing is reported empty yet.
    expect(sectionsOverviewRows(sections, true).map((row) => [row.countLabel, row.empty])).toEqual([
      [null, false],
      [null, false],
    ]);
  });
});
