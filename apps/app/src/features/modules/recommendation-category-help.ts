import type { ContentModuleCategory } from '@localmed/contracts';

import type { RecommendationCategoryStats } from '@/features/modules/recommendation-categories';
import { browserI18n } from '@/i18n/browser-i18n';
import { recommendationCountLabel, specialtyLabels } from '@/i18n/labels';

export function recommendationCategorySpecialtyLabels(
  specialties: readonly string[],
): readonly string[] {
  return specialtyLabels(specialties);
}

export interface RecommendationCategoryHelp {
  readonly lead: string;
  readonly recommendationLabel: string;
  readonly installedLabel: string;
  readonly sizeLabel: string;
  readonly specialtyLabels: readonly string[];
  readonly offlineNote: string;
}

export function buildRecommendationCategoryHelp(
  category: ContentModuleCategory,
  stats: RecommendationCategoryStats,
  formatBytes: (value: number | null) => string,
): RecommendationCategoryHelp {
  const recommendationLabel = recommendationCountLabel(stats.publishedCount);
  const installedLabel =
    stats.installedCount > 0
      ? browserI18n.getMessage('recommendation_installed_partial', [
          String(stats.installedCount),
          String(stats.publishedCount),
        ])
      : browserI18n.getMessage('recommendation_installed_none');
  const specialtyLabelsList = recommendationCategorySpecialtyLabels(category.specialties);

  return {
    lead: browserI18n.getMessage('recommendation_help_lead', category.title),
    recommendationLabel,
    installedLabel,
    sizeLabel: browserI18n.getMessage('recommendation_help_size', formatBytes(stats.downloadBytes)),
    specialtyLabels: specialtyLabelsList,
    offlineNote: browserI18n.getMessage('recommendation_help_offline_note'),
  };
}
