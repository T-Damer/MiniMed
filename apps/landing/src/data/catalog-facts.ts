/**
 * Numbers the landing page quotes about the content catalog. They are derived at build time from
 * the app's catalog manifest (`catalog.preview.json`) and its clinical edition sidecar, so the page
 * never states a stale fixed count.
 */

interface CatalogManifest {
  readonly categories: readonly unknown[];
  readonly modules: readonly { readonly id: string; readonly tags: readonly string[] }[];
}

interface ClinicalEditions {
  readonly codes: readonly {
    readonly editions: readonly {
      readonly status: string;
      readonly moduleId: string | null;
    }[];
  }[];
}

export interface CatalogFacts {
  /** Clinical-recommendation modules of current editions; replaced editions are not counted. */
  readonly currentRecommendationModules: number;
  /** Medical sections (catalog categories) the recommendations are filed under. */
  readonly sections: number;
}

const INDIVIDUAL_RECOMMENDATION_TAG = 'individual-recommendation';

/** Russian one/few/many noun form for a count: pluralRu(3, 'модуль', 'модуля', 'модулей'). */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function catalogFacts(catalog: CatalogManifest, editions: ClinicalEditions): CatalogFacts {
  const replacedModules = new Set(
    editions.codes.flatMap((code) =>
      code.editions.flatMap((edition) =>
        edition.status === 'superseded' && edition.moduleId !== null ? [edition.moduleId] : [],
      ),
    ),
  );
  return {
    currentRecommendationModules: catalog.modules.filter(
      (module) =>
        module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG) && !replacedModules.has(module.id),
    ).length,
    sections: catalog.categories.length,
  };
}

export function recommendationModulesLabel(count: number): string {
  return `${count} ${pluralRu(count, 'модуль', 'модуля', 'модулей')} клинических рекомендаций`;
}

export function sectionsLabel(count: number): string {
  return `${count} ${pluralRu(
    count,
    'медицинский раздел',
    'медицинских раздела',
    'медицинских разделов',
  )}`;
}
