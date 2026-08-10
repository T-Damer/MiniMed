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

export interface AssessmentSpecialty {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const ASSESSMENT_SPECIALTIES: readonly AssessmentSpecialty[] = [
  {
    id: 'psychology',
    title: 'Психология и психодиагностика',
    description: 'Опросники для саморефлексии, рабочего стиля и командных ролей.',
  },
  {
    id: 'psychiatry',
    title: 'Психиатрия',
    description: 'Скрининговые шкалы и опросники психиатрического профиля.',
  },
  {
    id: 'obstetrics',
    title: 'Акушерство и гинекология',
    description: 'Опросники и шкалы для акушерско-гинекологической практики.',
  },
  {
    id: 'pediatrics',
    title: 'Педиатрия',
    description: 'Возрастные шкалы развития и скрининговые опросники для детей.',
  },
  {
    id: 'gastroenterology',
    title: 'Гастроэнтерология',
    description: 'Опросники симптомов и качества жизни при заболеваниях ЖКТ.',
  },
];

export function findAssessmentSpecialty(id: string): AssessmentSpecialty | undefined {
  return ASSESSMENT_SPECIALTIES.find((specialty) => specialty.id === id);
}

export function assessmentsInSpecialty(
  specialtyId: string,
  definitions: readonly AssessmentCatalogEntry[],
): readonly AssessmentCatalogEntry[] {
  return definitions.filter((definition) => definition.bankId === specialtyId);
}

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
      'Образовательный самоопросник по популярной модели Бравермана и её четырём поведенческим кластерам: дофамин, ацетилхолин, ГАМК и серотонин.',
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
      'Самооценка пяти функциональных эго-состояний транзактного анализа: Критический Родитель, Заботливый Родитель, Взрослый, Свободный Ребёнок и Адаптированный Ребёнок.',
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
      'Неформальный профиль по управленческой рамке Адизеса и четырём рабочим функциям: достижение результата, администрирование, предпринимательское изменение и интеграция людей.',
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
      'Неформальный профиль девяти способов участия в команде, сопоставленных с моделью командных ролей Белбина. Он помогает обсудить вклад человека, но не является официальным Belbin Self-Perception Inventory.',
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
  {
    id: 'minimed.assessment.apgar',
    slug: 'apgar-newborn-score',
    title: 'Шкала Апгар — оценка новорождённого',
    shortTitle: 'Шкала Апгар',
    aliases: ['Апгар', 'Apgar score', 'оценка новорождённого', 'шкала Апгар'],
    bankId: 'obstetrics',
    bankLabel: 'Акушерство и гинекология',
    category: 'newborn-screening',
    description:
      'Стандартная клиническая шкала Вирджинии Апгар (1952) для быстрой оценки состояния новорождённого сразу после рождения по пяти признакам.',
    estimatedMinutes: 1,
    audience: 'Для медицинского персонала; оценивает врач или акушерка, а не пациент(ка)',
  },
  {
    id: 'minimed.assessment.epds',
    slug: 'postnatal-mood-epds',
    title: 'Эдинбургская шкала послеродовой депрессии (EPDS)',
    shortTitle: 'Шкала EPDS',
    aliases: [
      'EPDS',
      'Edinburgh Postnatal Depression Scale',
      'эдинбургская шкала',
      'послеродовая депрессия',
      'перинатальная депрессия',
    ],
    bankId: 'obstetrics',
    bankLabel: 'Акушерство и гинекология',
    category: 'perinatal-mood',
    description:
      'Стандартный скрининговый опросник из 10 пунктов для выявления признаков депрессии у женщин во время беременности и после родов, основанный на самочувствии за последние 7 дней.',
    estimatedMinutes: 4,
    audience: 'Женщины в период беременности и в первый год после родов',
  },
  {
    id: 'minimed.assessment.ferriman-gallwey',
    slug: 'ferriman-gallwey-hirsutism',
    title: 'Модифицированная шкала Ферримана–Голлвея (гирсутизм)',
    shortTitle: 'Шкала Ферримана–Голлвея',
    aliases: [
      'Ferriman-Gallwey',
      'шкала гирсутизма',
      'модифицированная шкала Ферримана-Голлвея',
      'оценка гирсутизма',
    ],
    bankId: 'obstetrics',
    bankLabel: 'Акушерство и гинекология',
    category: 'gynecologic-endocrinology',
    description:
      'Стандартная клиническая шкала для оценки выраженности гирсутизма по девяти областям тела; используется в диагностике синдрома поликистозных яичников и других причин гиперандрогении.',
    estimatedMinutes: 3,
    audience: 'Для медицинского персонала; оценивает врач по результатам осмотра',
  },
  {
    id: 'minimed.assessment.whooley',
    slug: 'perinatal-mood-whooley',
    title: 'Скрининг настроения Whooley (2 вопроса)',
    shortTitle: 'Скрининг Whooley',
    aliases: [
      'Whooley questions',
      'вопросы Whooley',
      'краткий скрининг депрессии',
      'скрининг настроения',
    ],
    bankId: 'obstetrics',
    bankLabel: 'Акушерство и гинекология',
    category: 'perinatal-mood',
    description:
      'Сверхкороткий скрининг из двух вопросов для быстрой первичной оценки сниженного настроения во время беременности и после родов.',
    estimatedMinutes: 1,
    audience: 'Женщины в период беременности и в первый год после родов',
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
  'minimed.assessment.apgar': () =>
    import('@/features/assessments/apgar-assessment').then((module) => module.APGAR_ASSESSMENT),
  'minimed.assessment.epds': () =>
    import('@/features/assessments/epds-assessment').then((module) => module.EPDS_ASSESSMENT),
  'minimed.assessment.ferriman-gallwey': () =>
    import('@/features/assessments/ferriman-gallwey-assessment').then(
      (module) => module.FERRIMAN_GALLWEY_ASSESSMENT,
    ),
  'minimed.assessment.whooley': () =>
    import('@/features/assessments/whooley-assessment').then((module) => module.WHOOLEY_ASSESSMENT),
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
