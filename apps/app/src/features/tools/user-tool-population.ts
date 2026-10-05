import {
  type ToolAgeBound,
  ToolAgeBoundSchema,
  type ToolAgeScope,
  ToolAgeScopeSchema,
} from '@localmed/contracts';

/**
 * Whom a tool the doctor made is for. Local questionnaires and calculators carry it in their file
 * and turn it into the same `ToolAgeScope` the built-in tools declare, so the age filter and the
 * badge treat them alike. The author states it; nothing is guessed.
 */
export type UserToolPopulationGroup = 'children' | 'adults' | 'any';

export interface UserToolPopulation {
  readonly group: UserToolPopulationGroup;
  /** Children only: the tool is meant for the newborn period too. */
  readonly neonates?: boolean;
  readonly minAge?: ToolAgeBound;
  readonly maxAge?: ToolAgeBound;
}

export const USER_TOOL_POPULATION_BASIS = 'Указано автором инструмента.';

export const USER_TOOL_POPULATION_GROUPS: readonly {
  readonly id: UserToolPopulationGroup;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'children', label: 'Дети', hint: 'Пациенты младше 18 лет' },
  { id: 'adults', label: 'Взрослые', hint: 'Пациенты от 18 лет' },
  { id: 'any', label: 'Любой возраст', hint: 'Возраст не важен' },
];

export const USER_TOOL_POPULATION_MISSING =
  'Укажите, для кого инструмент: дети, взрослые или любой возраст.';

export function userToolPopulationToAgeScope(population: UserToolPopulation): ToolAgeScope {
  const groups =
    population.group === 'adults'
      ? (['adults'] as const)
      : population.group === 'any'
        ? (['neonates', 'children', 'adults'] as const)
        : population.neonates === true
          ? (['neonates', 'children'] as const)
          : (['children'] as const);
  return ToolAgeScopeSchema.parse({
    groups: [...groups],
    ...(population.minAge ? { minAge: population.minAge } : {}),
    ...(population.maxAge ? { maxAge: population.maxAge } : {}),
    basis: USER_TOOL_POPULATION_BASIS,
  });
}

/** What each rule of the age-scope contract means for the doctor who typed the limits. */
const RULE_MESSAGES: readonly (readonly [fragment: string, message: string])[] = [
  ['must not exceed maxAge', 'Нижняя граница возраста больше верхней: поменяйте их местами.'],
  [
    'adults-only tool cannot start below',
    'Для взрослых нижняя граница возраста — не меньше 18 лет.',
  ],
  [
    'children-only tool cannot reach beyond',
    'Для детей верхняя граница возраста — не больше 19 лет.',
  ],
  [
    'must not list neonates',
    'Уберите «Включая новорождённых»: возраст начинается позже первого месяца жизни.',
  ],
];

/** A plain Russian reason the population cannot be used, or null when it is valid. */
export function userToolPopulationError(population: UserToolPopulation | undefined): string | null {
  if (!population) return USER_TOOL_POPULATION_MISSING;
  const result = ToolAgeScopeSchema.safeParse({
    groups: userToolPopulationGroups(population),
    ...(population.minAge ? { minAge: population.minAge } : {}),
    ...(population.maxAge ? { maxAge: population.maxAge } : {}),
    basis: USER_TOOL_POPULATION_BASIS,
  });
  if (result.success) return null;
  for (const issue of result.error.issues) {
    const known = RULE_MESSAGES.find(([fragment]) => issue.message.includes(fragment));
    if (known) return known[1];
  }
  return 'Проверьте границы возраста.';
}

function userToolPopulationGroups(population: UserToolPopulation): string[] {
  if (population.group === 'adults') return ['adults'];
  if (population.group === 'any') return ['neonates', 'children', 'adults'];
  return population.neonates === true ? ['neonates', 'children'] : ['children'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validates a population read from a file; throws a plain Russian message on bad data. */
export function parseUserToolPopulation(value: unknown): UserToolPopulation {
  if (!isRecord(value)) throw new Error('Возраст пациентов указан неверно.');
  const group = value['group'];
  if (group !== 'children' && group !== 'adults' && group !== 'any') {
    throw new Error('Возраст пациентов: выберите детей, взрослых или любой возраст.');
  }
  const bound = (raw: unknown, label: string): ToolAgeBound | undefined => {
    if (raw === undefined) return undefined;
    const parsed = ToolAgeBoundSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Возраст пациентов: ${label} указана неверно.`);
    return parsed.data;
  };
  const minAge = bound(value['minAge'], 'нижняя граница');
  const maxAge = bound(value['maxAge'], 'верхняя граница');
  const population: UserToolPopulation = {
    group,
    ...(group === 'children' && value['neonates'] === true ? { neonates: true } : {}),
    ...(minAge ? { minAge } : {}),
    ...(maxAge ? { maxAge } : {}),
  };
  const error = userToolPopulationError(population);
  if (error) throw new Error(error);
  return population;
}
