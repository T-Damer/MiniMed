import { anyAgeScope } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildSavedSections,
  FAVORITES_SECTION_TITLE,
  savedItemCount,
  searchSavedItems,
} from '@/features/collections/saved-items';
import type { QuickTool } from '@/features/search/quick-tools';
import type { ItemCollectionsState } from '@/state/item-collections';

const at = '2026-10-13T10:00:00.000Z';
const tools = new Map<string, QuickTool>([
  [
    'calc.chads',
    {
      id: 'calc.chads',
      title: 'CHA₂DS₂-VASc',
      kindLabel: 'Калькулятор',
      icon: 'calculator',
      ageScope: anyAgeScope('тест'),
      href: '#/calculators/chads',
    },
  ],
]);

const state: ItemCollectionsState = {
  version: 2,
  favorites: [
    { kind: 'document', id: 'doc.pneumonia', title: 'Пневмония у взрослых', addedAt: at },
    { kind: 'tool', id: 'calc.chads', addedAt: at },
    { kind: 'tool', id: 'calc.gone', addedAt: at },
  ],
  collections: [
    {
      id: 'c1',
      name: 'Лёгкие',
      createdAt: at,
      items: [
        { kind: 'document', id: 'doc.pneumonia', title: 'Пневмония у взрослых', addedAt: at },
        { kind: 'document', id: 'doc.asthma', title: 'Бронхиальная астма', addedAt: at },
      ],
    },
    { id: 'c2', name: 'Пустая', createdAt: at, items: [] },
  ],
};

describe('saved items as sections', () => {
  it('lists favourites first, then every collection, skipping what left the catalog', () => {
    const sections = buildSavedSections(state, tools);
    expect(sections.map((section) => section.title)).toEqual([
      FAVORITES_SECTION_TITLE,
      'Лёгкие',
      'Пустая',
    ]);
    expect(sections[0]?.entries.map((entry) => entry.tool.title)).toEqual([
      'Пневмония у взрослых',
      'CHA₂DS₂-VASc',
    ]);
  });

  it('shows no favourites section while nothing is starred', () => {
    const sections = buildSavedSections({ ...state, favorites: [] }, tools);
    expect(sections.map((section) => section.id)).toEqual(['c1', 'c2']);
  });

  it('finds the favourites folder by its name and an item by its title', () => {
    expect(buildSavedSections(state, tools, 'Избран').map((section) => section.id)).toEqual([
      'favorites',
    ]);
    expect(searchSavedItems(state, tools, 'астма').map((entry) => entry.tool.title)).toEqual([
      'Бронхиальная астма',
    ]);
  });

  it('counts an item once however many places hold it', () => {
    expect(savedItemCount(state, tools)).toBe(3);
    expect(searchSavedItems(state, tools, 'пневмония')).toHaveLength(1);
  });
});
