import { describe, expect, it } from 'vitest';

import { FIXTURE_CATALOG, FIXTURE_MANIFEST } from './section-fixtures';
import {
  buildSections,
  drugGroupsLabel,
  installState,
  recommendationsLabel,
  type SectionSelection,
  sectionContentsLabel,
  sectionGlyph,
  sectionModules,
  selectedModules,
  skippedGroupKey,
  substancesLabel,
} from './section-model';

const released = (module: { releaseState: string }): boolean => module.releaseState === 'published';
const sections = buildSections(FIXTURE_CATALOG, FIXTURE_MANIFEST, released);
const psychiatry = sections.find((section) => section.id.includes('psychiatry'));
const cardiology = sections.find((section) => section.id.includes('cardiology'));
const none = new Set<string>();

describe('buildSections', () => {
  it('takes the sections from the catalog categories, titled as the catalog titles them', () => {
    expect(sections.map((section) => section.title)).toEqual(['Кардиология', 'Психиатрия']);
  });

  it('leaves out a section without a released recommendation', () => {
    expect(sections.some((section) => section.id.includes('empty'))).toBe(false);
  });

  it('holds the recommendation modules of its collection', () => {
    expect(psychiatry?.clinical.map((module) => module.id)).toEqual(['kr.1', 'kr.2']);
  });

  it('pairs each drug group with its registry and instructions packages, biggest group first', () => {
    expect(cardiology?.drugGroups.map((group) => group.title)).toEqual([
      'Сердечно-сосудистая система',
      'Нервная система',
    ]);
    expect(psychiatry?.drugGroups[0]?.modules.map((module) => module.id)).toEqual([
      'minimed.medications.nervous-system.ru',
      'minimed.medications.instructions.nervous-system.ru',
    ]);
    expect(psychiatry?.drugGroups[0]?.medicationCount).toBe(2);
  });

  it('skips a package that is not released yet', () => {
    const onlyRegistry = buildSections(
      FIXTURE_CATALOG,
      FIXTURE_MANIFEST,
      (module) => module.collection !== 'grls-instructions' && module.releaseState === 'published',
    );
    const group = onlyRegistry.find((s) => s.id.includes('psychiatry'))?.drugGroups[0];
    expect(group?.modules.map((module) => module.id)).toEqual([
      'minimed.medications.nervous-system.ru',
    ]);
  });
});

describe('selection', () => {
  const everything: SectionSelection = {
    sectionIds: new Set(sections.map((section) => section.id)),
    skippedGroups: none,
  };

  it('counts a drug group shared by two sections once', () => {
    const ids = selectedModules(sections, everything).map((module) => module.id);
    expect(ids.filter((id) => id === 'minimed.medications.nervous-system.ru')).toHaveLength(1);
    expect(ids).toHaveLength(new Set(ids).size);
    // 3 recommendations, 2 groups of 2 packages.
    expect(ids).toHaveLength(7);
  });

  it('is empty until a section is ticked', () => {
    expect(selectedModules(sections, { sectionIds: new Set(), skippedGroups: none })).toEqual([]);
  });

  it('drops a drug group that was switched off, only in its own section', () => {
    if (!psychiatry || !cardiology) throw new Error('fixture sections missing');
    const skipped = new Set([skippedGroupKey(psychiatry.id, 'nervous-system')]);
    expect(sectionModules(psychiatry, skipped).map((module) => module.id)).toEqual([
      'kr.1',
      'kr.2',
    ]);
    expect(sectionModules(cardiology, skipped)).toHaveLength(5);
  });
});

describe('installState', () => {
  const modules = psychiatry?.clinical ?? [];
  it('tells none, partial and complete apart', () => {
    expect(installState(modules, () => false)).toBe('none');
    expect(installState(modules, (module) => module.id === 'kr.1')).toBe('partial');
    expect(installState(modules, () => true)).toBe('complete');
    expect(installState([], () => true)).toBe('none');
  });
});

describe('labels', () => {
  it('uses the right Russian form for recommendations', () => {
    expect(recommendationsLabel(1)).toBe('1 клиническая рекомендация');
    expect(recommendationsLabel(2)).toBe('2 клинические рекомендации');
    expect(recommendationsLabel(5)).toBe('5 клинических рекомендаций');
    expect(recommendationsLabel(11)).toBe('11 клинических рекомендаций');
    expect(recommendationsLabel(21)).toBe('21 клиническая рекомендация');
    expect(recommendationsLabel(35)).toBe('35 клинических рекомендаций');
  });

  it('uses the right form for groups and substances', () => {
    expect(drugGroupsLabel(1)).toBe('1 группа');
    expect(drugGroupsLabel(3)).toBe('3 группы');
    expect(drugGroupsLabel(12)).toBe('12 групп');
    expect(substancesLabel(22)).toBe('22 вещества');
    expect(substancesLabel(106)).toBe('106 веществ');
  });

  it('writes what a section holds and follows the drug groups left in', () => {
    if (!cardiology || !psychiatry) throw new Error('fixture sections missing');
    expect(sectionContentsLabel(cardiology, none)).toBe(
      '1 клиническая рекомендация · препараты: 2 группы',
    );
    expect(sectionContentsLabel(psychiatry, none)).toBe(
      '2 клинические рекомендации · препараты: 1 группа',
    );
    const skipped = new Set([skippedGroupKey(psychiatry.id, 'nervous-system')]);
    expect(sectionContentsLabel(psychiatry, skipped)).toBe('2 клинические рекомендации');
  });
});

describe('sectionGlyph', () => {
  it('falls back to a neutral glyph for a collection without one', () => {
    expect(sectionGlyph('minimed.clinical.new-thing.ru')).toBe('overview');
    expect(sectionGlyph('minimed.clinical.psychiatry-addiction.ru')).toBe('brain');
  });
});
