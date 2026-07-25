import type { ContentModuleCategory } from '@localmed/contracts';

import type { RecommendationCategoryStats } from '@/features/modules/recommendation-categories';

const SPECIALTY_LABELS: Readonly<Record<string, string>> = {
  'addiction-medicine': 'Наркология',
  allergology: 'Аллергология',
  'allergology-immunology': 'Аллергология и иммунология',
  anesthesiology: 'Анестезиология',
  cardiology: 'Кардиология',
  'cardiovascular-surgery': 'Сердечно-сосудистая хирургия',
  dentistry: 'Стоматология',
  dermatology: 'Дерматология',
  'emergency-medicine': 'Неотложная помощь',
  endocrinology: 'Эндокринология',
  epidemiology: 'Эпидемиология',
  gastroenterology: 'Гастроэнтерология',
  genetics: 'Генетика',
  geriatrics: 'Гериатрия',
  gynecology: 'Акушерство и гинекология',
  hematology: 'Гематология',
  hepatology: 'Гепатология',
  'infectious-diseases': 'Инфекционные болезни',
  'intensive-care': 'Реанимация и интенсивная терапия',
  nephrology: 'Нефрология',
  neurology: 'Неврология',
  neurosurgery: 'Нейрохирургия',
  nutrition: 'Клиническое питание',
  obstetrics: 'Акушерство',
  oncology: 'Онкология',
  ophthalmology: 'Офтальмология',
  orthopedics: 'Ортопедия',
  otorhinolaryngology: 'Оториноларингология',
  pediatrics: 'Педиатрия',
  'child-psychiatry': 'Детская психиатрия',
  psychiatry: 'Психиатрия',
  pulmonology: 'Пульмонология',
  radiology: 'Лучевая диагностика',
  rheumatology: 'Ревматология',
  surgery: 'Хирургия',
  toxicology: 'Токсикология',
  traumatology: 'Травматология',
  urology: 'Урология',
};

function recommendationCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} клиническая рекомендация`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} клинические рекомендации`;
  }
  return `${count} клинических рекомендаций`;
}

export function recommendationCategorySpecialtyLabels(
  specialties: readonly string[],
): readonly string[] {
  return specialties.map((specialty) => SPECIALTY_LABELS[specialty] ?? specialty);
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
      ? `На устройстве: ${stats.installedCount} из ${stats.publishedCount}`
      : 'Пока ничего не скачано из этого раздела';
  const specialtyLabels = recommendationCategorySpecialtyLabels(category.specialties);

  return {
    lead: `Раздел «${category.title}» объединяет официальные клинические рекомендации Минздрава по смежным направлениям. После загрузки документы доступны офлайн и участвуют в общем поиске MiniMed.`,
    recommendationLabel,
    installedLabel,
    sizeLabel: `Общий объём загрузки: ${formatBytes(stats.downloadBytes)}`,
    specialtyLabels,
    offlineNote:
      'Каждая рекомендация скачивается отдельно и проверяется перед подключением к поиску. Можно загрузить весь раздел целиком или выбрать отдельные документы внутри.',
  };
}
