import { describe, expect, it } from 'vitest';
import editions from '../../../app/src/features/modules/catalog.clinical-editions.json';
import catalog from '../../../app/src/features/modules/catalog.preview.json';
import { catalogFacts, pluralRu, recommendationModulesLabel, sectionsLabel } from './catalog-facts';

describe('landing catalog facts', () => {
  it('counts current recommendation modules from the manifest, without replaced editions', () => {
    const facts = catalogFacts(catalog, editions);
    const tagged = catalog.modules.filter((module) =>
      module.tags.includes('individual-recommendation'),
    ).length;
    const replaced = editions.codes.reduce(
      (total, code) =>
        total +
        code.editions.filter(
          (edition: { status: string; moduleId: string | null }) =>
            edition.status === 'superseded' && edition.moduleId !== null,
        ).length,
      0,
    );
    expect(facts.currentRecommendationModules).toBe(tagged - replaced);
    expect(facts.currentRecommendationModules).toBeGreaterThan(700);
    expect(facts.sections).toBe(catalog.categories.length);
  });

  it('does not count a replaced edition', () => {
    const facts = catalogFacts(
      {
        categories: [{}],
        modules: [
          { id: 'old', tags: ['individual-recommendation'] },
          { id: 'new', tags: ['individual-recommendation'] },
          { id: 'tool', tags: [] },
        ],
      },
      {
        codes: [
          {
            editions: [
              { status: 'superseded', moduleId: 'old' },
              { status: 'active', moduleId: 'new' },
            ],
          },
        ],
      },
    );
    expect(facts).toEqual({ currentRecommendationModules: 1, sections: 1 });
  });

  it('uses the correct Russian forms', () => {
    const forms = (n: number) => pluralRu(n, 'модуль', 'модуля', 'модулей');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 763, 771, 0].map(forms)).toEqual([
      'модуль',
      'модуля',
      'модуля',
      'модулей',
      'модулей',
      'модулей',
      'модулей',
      'модуль',
      'модуля',
      'модулей',
      'модулей',
      'модуля',
      'модуль',
      'модулей',
    ]);
    expect(recommendationModulesLabel(763)).toBe('763 модуля клинических рекомендаций');
    expect(recommendationModulesLabel(744)).toBe('744 модуля клинических рекомендаций');
    expect(recommendationModulesLabel(771)).toBe('771 модуль клинических рекомендаций');
    expect(sectionsLabel(21)).toBe('21 медицинский раздел');
    expect(sectionsLabel(22)).toBe('22 медицинских раздела');
    expect(sectionsLabel(25)).toBe('25 медицинских разделов');
  });
});
