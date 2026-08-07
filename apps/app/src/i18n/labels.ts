import { browserI18n } from '@/i18n/browser-i18n';

export function specialtyMessageKey(slug: string): string {
  return `specialty_${slug.replaceAll('-', '_')}`;
}

export function specialtyLabel(slug: string): string {
  const localized = browserI18n.getMessage(specialtyMessageKey(slug));
  return localized || slug;
}

export function specialtyLabels(specialties: readonly string[]): readonly string[] {
  return specialties.map((specialty) => specialtyLabel(specialty));
}

export function collectionLabel(collectionId: string): string {
  const localized = browserI18n.getMessage(`collection_${collectionId}`);
  return localized || collectionId;
}

export function sourceTypeLibraryLabel(sourceType: string): string {
  const keyBySourceType: Readonly<Record<string, string>> = {
    clinical_recommendation_summary: 'source_clinical_recommendation_summary_library',
    official_registry_summary: 'source_official_registry_summary',
    regulatory_act: 'source_regulatory_act',
  };
  const key = keyBySourceType[sourceType];
  if (!key) return sourceType.replaceAll('_', ' ');
  return browserI18n.getMessage(key) || sourceType.replaceAll('_', ' ');
}

export function sourceTypeReaderLabel(sourceType: string): string | null {
  if (sourceType === 'official_registry_summary') return null;
  const keyBySourceType: Readonly<Record<string, string>> = {
    clinical_recommendation_summary: 'source_clinical_recommendation_summary_reader',
    regulatory_act: 'source_regulatory_act',
  };
  const key = keyBySourceType[sourceType];
  if (!key) return null;
  return browserI18n.getMessage(key) || null;
}

export function recommendationCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return browserI18n.getMessage('recommendation_count_one', String(count));
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return browserI18n.getMessage('recommendation_count_few', String(count));
  }
  return browserI18n.getMessage('recommendation_count_many', String(count));
}

export function documentCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return browserI18n.getMessage('document_count_one', String(count));
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return browserI18n.getMessage('document_count_few', String(count));
  }
  return browserI18n.getMessage('document_count_many', String(count));
}
