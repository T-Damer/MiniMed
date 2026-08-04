import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export type AssessmentCategory = AssessmentDefinition['category'];

export type AssessmentCatalogEntry = Pick<
  AssessmentDefinition,
  | 'id'
  | 'slug'
  | 'title'
  | 'shortTitle'
  | 'aliases'
  | 'bankId'
  | 'bankLabel'
  | 'category'
  | 'description'
  | 'estimatedMinutes'
  | 'audience'
>;

type AssessmentLoader = () => Promise<AssessmentDefinition>;

export const ASSESSMENT_CATALOG: readonly AssessmentCatalogEntry[] = [
  {
    id: 'minimed.assessment.braverman-behavioral',
    slug: 'braverman-behavioral-profile',
    title: 'Тест Бравермана — поведенческий профиль',
    shortTitle: 'Профиль Бравермана',
    aliases: [
      'тест Бравермана',
      'Braverman test',
      'нейромедиаторный профиль',
      'дофамин серотонин ГАМК ацетилхолин',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'self-reflection',
    description:
      'Авторский самоопросник MiniMed по четырём поведенческим кластерам, которые популярная модель Бравермана связывает с дофамином, ацетилхолином, ГАМК и серотонином.',
    estimatedMinutes: 6,
    audience: 'Взрослые; образовательная саморефлексия',
  },
  {
    id: 'minimed.assessment.egogram',
    slug: 'personal-egogram',
    title: 'Личная эгопрограмма',
    shortTitle: 'Эгопрограмма',
    aliases: [
      'личная эгограмма',
      'эгограмма',
      'эго-состояния Берна',
      'Родитель Взрослый Ребёнок',
      'transactional analysis egogram',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'self-reflection',
    description:
      'Авторский самоопросник по функциональным эго-состояниям транзактного анализа: Критический Родитель, Заботливый Родитель, Взрослый, Свободный Ребёнок и Адаптированный Ребёнок.',
    estimatedMinutes: 7,
    audience: 'Взрослые; саморефлексия и обсуждение с психологом',
  },
  {
    id: 'minimed.assessment.paei',
    slug: 'paei-work-style',
    title: 'PAEI — профиль рабочего стиля',
    shortTitle: 'PAEI',
    aliases: [
      'PAEI',
      'стили Адизеса',
      'Producer Administrator Entrepreneur Integrator',
      'стиль управления',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'work-style',
    description:
      'Независимый самоопросник по четырём рабочим функциям: достижение результата, администрирование, предпринимательское изменение и интеграция людей.',
    estimatedMinutes: 6,
    audience: 'Взрослые; работа, обучение и управление',
  },
  {
    id: 'minimed.assessment.team-roles',
    slug: 'team-role-profile',
    title: 'Командные роли — профиль в духе Белбина',
    shortTitle: 'Командные роли',
    aliases: [
      'тест Белбина',
      'роли Белбина',
      'Belbin',
      'командные роли',
      'генератор идей координатор аналитик',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'team-role',
    description:
      'Авторский профиль девяти наблюдаемых способов участия в команде. Он помогает обсудить вклад человека, но не является официальным Belbin Self-Perception Inventory.',
    estimatedMinutes: 9,
    audience: 'Взрослые; команды, обучение и управление',
  },
  {
    id: 'minimed.assessment.temperament',
    slug: 'temperament-profile',
    title: 'Тест на темперамент',
    shortTitle: 'Темперамент',
    aliases: [
      'тест на темперамент',
      'сангвиник холерик флегматик меланхолик',
      'темперамент Айзенка',
      'extraversion emotional stability',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'temperament',
    description:
      'Краткий профиль по двум измерениям — экстраверсии и эмоциональной устойчивости. Для привычного языка результат дополнительно сопоставляется с четырьмя классическими темпераментами.',
    estimatedMinutes: 5,
    audience: 'Подростки старшего возраста и взрослые; образовательная саморефлексия',
  },
];

const ASSESSMENT_LOADERS: Readonly<Record<string, AssessmentLoader>> = {
  'minimed.assessment.braverman-behavioral': () =>
    import('@/features/assessments/braverman-assessment').then(
      (module) => module.BRAVERMAN_ASSESSMENT,
    ),
  'minimed.assessment.egogram': () =>
    import('@/features/assessments/egogram-assessment').then((module) => module.EGOGRAM_ASSESSMENT),
  'minimed.assessment.paei': () =>
    import('@/features/assessments/paei-assessment').then((module) => module.PAEI_ASSESSMENT),
  'minimed.assessment.team-roles': () =>
    import('@/features/assessments/team-roles-assessment').then(
      (module) => module.TEAM_ROLES_ASSESSMENT,
    ),
  'minimed.assessment.temperament': () =>
    import('@/features/assessments/temperament-assessment').then(
      (module) => module.TEMPERAMENT_ASSESSMENT,
    ),
};

const definitionPromises = new Map<string, Promise<AssessmentDefinition>>();

export function findAssessmentById(id: string): AssessmentCatalogEntry | undefined {
  return ASSESSMENT_CATALOG.find((assessment) => assessment.id === id);
}

export function findAssessmentBySlug(slug: string): AssessmentCatalogEntry | undefined {
  return ASSESSMENT_CATALOG.find((assessment) => assessment.slug === slug);
}

function normalized(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function validateLoadedDefinition(
  entry: AssessmentCatalogEntry,
  definition: AssessmentDefinition,
): AssessmentDefinition {
  if (
    definition.id !== entry.id ||
    definition.slug !== entry.slug ||
    definition.category !== entry.category
  ) {
    throw new Error(`Assessment payload does not match catalog entry: ${entry.id}.`);
  }
  return definition;
}

export function loadAssessmentDefinition(idOrSlug: string): Promise<AssessmentDefinition> {
  const entry = findAssessmentById(idOrSlug) ?? findAssessmentBySlug(idOrSlug);
  if (!entry) return Promise.reject(new Error(`Unknown assessment: ${idOrSlug}.`));
  const existing = definitionPromises.get(entry.id);
  if (existing) return existing;
  const loader = ASSESSMENT_LOADERS[entry.id];
  if (!loader) return Promise.reject(new Error(`Assessment payload is unavailable: ${entry.id}.`));
  const promise = loader()
    .then((definition) => validateLoadedDefinition(entry, definition))
    .catch((cause: unknown) => {
      definitionPromises.delete(entry.id);
      throw cause;
    });
  definitionPromises.set(entry.id, promise);
  return promise;
}

export async function preloadAssessmentDefinitions(ids: readonly string[]): Promise<void> {
  await Promise.all([...new Set(ids)].map((id) => loadAssessmentDefinition(id)));
}

export function searchAssessments(query: string): readonly AssessmentCatalogEntry[] {
  const needle = normalized(query);
  if (!needle) return ASSESSMENT_CATALOG;
  const tokens = needle.split(/\s+/u).filter((token) => token.length >= 2);
  return ASSESSMENT_CATALOG.filter((assessment) => {
    const haystack = normalized(
      [assessment.title, assessment.shortTitle, assessment.description, ...assessment.aliases].join(
        ' ',
      ),
    );
    return haystack.includes(needle) || tokens.every((token) => haystack.includes(token));
  });
}
