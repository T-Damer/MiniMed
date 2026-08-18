import type { ContentModuleCategory } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildRecommendationCategoryHelp,
  recommendationCategorySpecialtyLabels,
} from '@/features/modules/recommendation-category-help';

const category: ContentModuleCategory = {
  id: 'minimed.clinical.respiratory-allergy.ru',
  title: 'Пульмонология и аллергология',
  recommendationCount: 37,
  specialties: ['pulmonology', 'allergology-immunology'],
};

describe('recommendation-category-help', () => {
  it('maps specialty slugs to doctor-friendly Russian labels', () => {
    expect(recommendationCategorySpecialtyLabels(category.specialties)).toEqual([
      'Пульмонология',
      'Аллергология и иммунология',
    ]);
  });

  it('builds modal copy from category stats', () => {
    const help = buildRecommendationCategoryHelp(
      category,
      {
        publishedCount: 37,
        installedCount: 5,
        pendingCount: 32,
        downloadBytes: 12_000_000,
        installedBytes: 4_000_000,
      },
      (value) => `${value} B`,
    );

    expect(help.recommendationLabel).toBe('37 клинических рекомендаций');
    expect(help.installedLabel).toBe('На устройстве: 5 из 37');
    expect(help.sizeLabel).toBe('Общий объём загрузки: 12000000 B');
    expect(help.specialtyLabels).toEqual(['Пульмонология', 'Аллергология и иммунология']);
    expect(help.lead).toContain('Пульмонология и аллергология');
  });
});
