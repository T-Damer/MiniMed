export type CalculatorRoutingSplit = 'fixed' | 'heldout';
export type CalculatorRoutingRoute =
  | 'medication-dose'
  | 'infusion-volume'
  | 'other-calculator'
  | 'none';
export type CalculatorRoutingSafety = 'allow' | 'confirm' | 'abstain';

export interface CalculatorRoutingFacts {
  readonly age?: string;
  readonly weight?: string;
  readonly form?: string;
  readonly route?: string;
  readonly illness?: string;
}

export interface CalculatorRoutingCase {
  readonly id: string;
  readonly query: string;
  readonly split: CalculatorRoutingSplit;
  readonly expectedRoute: CalculatorRoutingRoute;
  readonly expectedSafety: CalculatorRoutingSafety;
  readonly medicationCanonicalTerms?: readonly string[];
  readonly extractedFacts?: CalculatorRoutingFacts;
  readonly rationale: string;
}

export interface CalculatorRoutingDataset {
  readonly schemaVersion: 1;
  readonly dataset?: string;
  readonly reviewStatus: 'proposed';
  readonly cases: readonly CalculatorRoutingCase[];
}

const SPLITS: readonly CalculatorRoutingSplit[] = ['fixed', 'heldout'];
const ROUTES: readonly CalculatorRoutingRoute[] = [
  'medication-dose',
  'infusion-volume',
  'other-calculator',
  'none',
];
const SAFETY: readonly CalculatorRoutingSafety[] = ['allow', 'confirm', 'abstain'];
const FACT_KEYS = new Set(['age', 'weight', 'form', 'route', 'illness']);

interface MedicationScenario {
  readonly canonical: string;
  readonly brand: string;
  readonly illness: string;
}

export const CALCULATOR_ROUTING_MEDICATIONS: readonly MedicationScenario[] = [
  { canonical: 'парацетамол', brand: 'Панадол', illness: 'лихорадке' },
  { canonical: 'ибупрофен', brand: 'Нурофен', illness: 'боли и жаре' },
  { canonical: 'амоксициллин', brand: 'Флемоксин', illness: 'отите' },
  { canonical: 'азитромицин', brand: 'Сумамед', illness: 'пневмонии' },
  { canonical: 'цефтриаксон', brand: 'Роцефин', illness: 'пневмонии' },
  { canonical: 'будесонид', brand: 'Пульмикорт', illness: 'бронхиальной астме' },
  { canonical: 'сальбутамол', brand: 'Вентолин', illness: 'бронхоспазме' },
  { canonical: 'осельтамивир', brand: 'Тамифлю', illness: 'гриппе' },
  { canonical: 'дексаметазон', brand: 'Дексаметазон', illness: 'крупе' },
  { canonical: 'омепразол', brand: 'Омез', illness: 'рефлюксе' },
  { canonical: 'амлодипин', brand: 'Норваск', illness: 'гипертонии' },
  { canonical: 'метформин', brand: 'Глюкофаж', illness: 'диабете 2 типа' },
  {
    canonical: 'амоксициллин-клавуланат',
    brand: 'Аугментин',
    illness: 'синусите',
  },
  { canonical: 'левоцетиризин', brand: 'Ксизал', illness: 'аллергическом рините' },
  { canonical: 'трамадол', brand: 'Трамал', illness: 'сильной боли' },
];

const AGES = [2, 4, 6, 8, 10, 12, 16, 32] as const;
const WEIGHTS = [12, 18, 24, 30, 45, 60, 80] as const;
const FORMS = ['сироп', 'таблетки', 'капсулы', 'раствор'] as const;
const ROUTE_WORDS = ['перорально', 'внутривенно', 'внутримышечно', 'ингаляционно'] as const;

function typo(term: string): string {
  const last = term.at(-1) ?? 'а';
  return `${term}${last}`;
}

function medicationSafety(variant: number): CalculatorRoutingSafety {
  if ([4, 6, 7, 9, 12].includes(variant)) return 'abstain';
  if ([3, 10, 11, 13].includes(variant)) return 'confirm';
  return 'allow';
}

function medicationCase(
  scenario: MedicationScenario,
  medicationIndex: number,
  variant: number,
): CalculatorRoutingCase {
  const age = AGES[(medicationIndex + variant) % AGES.length] ?? 6;
  const weight = WEIGHTS[(medicationIndex * 2 + variant) % WEIGHTS.length] ?? 20;
  const form = FORMS[(medicationIndex + variant) % FORMS.length] ?? 'сироп';
  const route = ROUTE_WORDS[(medicationIndex + variant) % ROUTE_WORDS.length] ?? 'перорально';
  const otherMedication =
    CALCULATOR_ROUTING_MEDICATIONS[(medicationIndex + 1) % CALCULATOR_ROUTING_MEDICATIONS.length]
      ?.canonical ?? 'ибупрофен';
  const query =
    scenario.canonical === 'будесонид' && variant === 0
      ? 'Пульмикорт ребенку 12 лет при бронхиальной астме, доза'
      : scenario.canonical === 'трамадол' && variant === 0
        ? 'Трамадол ребенку 8 лет'
        : ([
            `${scenario.canonical} ребенку ${age} лет при ${scenario.illness}, доза`,
            `${scenario.brand} ребенку ${age} лет вес ${weight} кг, форма ${form}`,
            `${scenario.canonical} (${scenario.brand}) ребенку ${age} лет, путь ${route}`,
            `${typo(scenario.canonical)} ребенку ${age} лет, нужна проверка дозы`,
            `Можно ли ${scenario.canonical} ребенку ${age} лет при ${scenario.illness}`,
            `${scenario.brand} ребенку ${age} лет: форма ${form}, путь ${route}`,
            `${scenario.canonical} ребенку ${age} лет вес ${weight} кг уже принял, что учесть`,
            `Если ребенок ${age} лет получил ${scenario.brand}, сведения о передозировке`,
            `${scenario.canonical} при ${scenario.illness} у пациента ${age} лет, разовая доза`,
            `${scenario.brand} ребенку ${age} лет после приема нужна информация`,
            `${scenario.canonical} или ${otherMedication} ребенку ${age} лет: какой вариант дозирования`,
            `${typo(scenario.canonical)} ${scenario.brand} ребенку ${age} лет, форма ${form}`,
            `${scenario.canonical} ребенку ${age} лет при аллергии, можно ли дозу`,
            `${scenario.brand} уже назначен ребенку ${age} лет, уточнить режим`,
            `${scenario.canonical} ребенку ${age} лет, лекарственная форма и путь`,
          ][variant] ?? `${scenario.canonical} ребенку ${age} лет`);
  const facts: CalculatorRoutingFacts = {
    age: `${age} лет`,
    ...(variant === 0 || variant === 4 || variant === 8
      ? scenario.canonical === 'трамадол' && variant === 0
        ? {}
        : { illness: scenario.illness }
      : {}),
    ...(variant === 1 || variant === 6 ? { weight: `${weight} кг` } : {}),
    ...(variant === 1 || variant === 5 || variant === 11 ? { form } : {}),
    ...(variant === 2 || variant === 5 || variant === 14 ? { route } : {}),
  };
  const medicationCanonicalTerms =
    variant === 10 ? [scenario.canonical, otherMedication] : [scenario.canonical];
  return {
    id: `medication-${medicationIndex + 1}-${variant + 1}`,
    query,
    split: (medicationIndex + variant) % 2 === 0 ? 'fixed' : 'heldout',
    expectedRoute: 'medication-dose',
    expectedSafety: medicationSafety(variant),
    medicationCanonicalTerms,
    extractedFacts: facts,
    rationale:
      variant >= 10
        ? 'Предложенный сценарий требует подтверждения контекста или безопасного отказа; доза не задана.'
        : 'Предложенный сценарий проверяет детерминированную маршрутизацию к дозовому инструменту; доза не задана.',
  };
}

interface InfusionScenario {
  readonly id: string;
  readonly indication: string;
  readonly age: number;
  readonly weight: number;
}

const INFUSIONS: readonly InfusionScenario[] = [
  { id: 'alcohol', indication: 'отравлении алкоголем', age: 32, weight: 80 },
  { id: 'dehydration', indication: 'обезвоживании', age: 8, weight: 24 },
  { id: 'burn', indication: 'ожоговой травме', age: 16, weight: 60 },
  { id: 'sepsis', indication: 'септическом состоянии', age: 45, weight: 70 },
  { id: 'gastro', indication: 'тяжелой рвоте', age: 6, weight: 20 },
];

function infusionCase(
  scenario: InfusionScenario,
  scenarioIndex: number,
  variant: number,
): CalculatorRoutingCase {
  const weight = scenario.weight + (variant % 3) * 2;
  const age = scenario.age + (variant % 2);
  const query =
    scenario.id === 'alcohol' && variant === 0
      ? 'Объем инфузии при отравлении алкоголем 80кг'
      : ([
          `Объем инфузии при ${scenario.indication} ${weight} кг`,
          `Объем инфузии пациенту ${age} лет при ${scenario.indication}, масса ${weight} кг`,
          `Инфузионная терапия при ${scenario.indication}, масса ${weight} кг`,
          `Сколько раствора внутривенно при ${scenario.indication}, ${weight} кг`,
          `Инфузия ребенку ${age} лет вес ${weight} кг при ${scenario.indication}`,
          `Расчет объема инфузии для пациента ${age} лет при ${scenario.indication}`,
          `Инфузия ${scenario.indication} ${weight}кг, нужна проверка`,
          `После уже введенного раствора при ${scenario.indication}: уточнить объем`,
          `Объем жидкости при ${scenario.indication} без массы пациента`,
          `Инфузия при ${scenario.indication}, ${weight} кг: не назначать самостоятельно`,
          `Нужно ли считать объем инфузии при ${scenario.indication}`,
          `Инфузия при ${scenario.indication}: противопоказания и ограничения`,
          `Передозировка раствора при ${scenario.indication}, что проверить`,
          `В/в объем при ${scenario.indication}, масса ${weight} кг`,
          `Объем инфузии при ${scenario.indication}: уже получено, нужна оценка`,
        ][variant] ?? `Объем инфузии при ${scenario.indication}`);
  const expectedSafety: CalculatorRoutingSafety = [7, 9, 11, 12, 14].includes(variant)
    ? 'abstain'
    : [6, 8, 10].includes(variant)
      ? 'confirm'
      : 'allow';
  return {
    id: `infusion-${scenarioIndex + 1}-${variant + 1}`,
    query,
    split: (scenarioIndex + variant) % 2 === 0 ? 'fixed' : 'heldout',
    expectedRoute: 'infusion-volume',
    expectedSafety,
    extractedFacts: {
      illness: scenario.indication,
      ...([0, 1, 2, 3, 4, 6, 9, 13].includes(variant) ? { weight: `${weight} кг` } : {}),
      ...([1, 4, 5].includes(variant) ? { age: `${age} лет` } : {}),
      ...(variant === 3 || variant === 4 || variant === 13 ? { route: 'внутривенно' } : {}),
    },
    rationale:
      expectedSafety === 'abstain'
        ? 'Инфузионный сценарий содержит риск передозировки или уже введенный объем; безопасный ответ должен воздержаться.'
        : expectedSafety === 'confirm'
          ? 'Инфузионный сценарий неполон или требует проверки клинического контекста; автоматический запуск не подтверждается.'
          : 'Предложенный сценарий проверяет маршрутизацию к расчету инфузионного объема без вычисленного результата.',
  };
}

interface OtherCalculatorScenario {
  readonly id: string;
  readonly label: string;
}

const OTHER_CALCULATORS: readonly OtherCalculatorScenario[] = [
  { id: 'bmi', label: 'индекс массы тела' },
  { id: 'bsa', label: 'площадь поверхности тела по Mosteller' },
  { id: 'creatinine', label: 'клиренс креатинина' },
  { id: 'egfr', label: 'скорость клубочковой фильтрации' },
  { id: 'apgar', label: 'шкала Апгар' },
];

function otherCalculatorCase(
  scenario: OtherCalculatorScenario,
  scenarioIndex: number,
  variant: number,
): CalculatorRoutingCase {
  const age = AGES[(scenarioIndex + variant) % AGES.length] ?? 6;
  const weight = WEIGHTS[(scenarioIndex + variant * 2) % WEIGHTS.length] ?? 20;
  const query =
    [
      `Рассчитать ${scenario.label}: возраст ${age} лет, вес ${weight} кг`,
      `${scenario.label} для пациента ${age} лет и ${weight} кг`,
      `Как определить ${scenario.label} при массе ${weight} кг`,
      `Нужен калькулятор: ${scenario.label}, пациент ${age} лет`,
      `${scenario.label}, исходные данные ${weight} кг`,
      `Проверить ${scenario.label} у ребенка ${age} лет`,
      `${scenario.label}: ввести возраст ${age} лет и массу ${weight} кг`,
      `Расчет показателя ${scenario.label} без медицинского назначения`,
      `${scenario.label} по клиническим данным пациента`,
      `Инструмент для оценки: ${scenario.label}`,
    ][variant] ?? `${scenario.label}, пациент ${age} лет`;
  const expectedSafety: CalculatorRoutingSafety =
    variant < 7 ? 'allow' : variant === 7 ? 'confirm' : 'abstain';
  return {
    id: `other-${scenario.id}-${variant + 1}`,
    query,
    split: (scenarioIndex + variant) % 2 === 0 ? 'fixed' : 'heldout',
    expectedRoute: 'other-calculator',
    expectedSafety,
    extractedFacts: {
      ...([0, 1, 3, 5, 6].includes(variant) ? { age: `${age} лет` } : {}),
      ...([0, 1, 2, 4, 6].includes(variant) ? { weight: `${weight} кг` } : {}),
    },
    rationale:
      expectedSafety === 'allow'
        ? 'Сценарий проверяет маршрутизацию к неспецифическому калькулятору без клинического вывода.'
        : expectedSafety === 'confirm'
          ? 'Сценарий требует подтверждения выбора инструмента перед запуском.'
          : 'Сценарий отмечен для безопасного отказа при недостаточном контексте; числовой ответ не задан.',
  };
}

const NONE_TOPICS: readonly string[] = [
  'подготовка к общему анализу крови',
  'признаки обезвоживания у ребенка',
  'клинические рекомендации по пневмонии',
  'порядок оформления информированного согласия',
  'значение лабораторного показателя',
  'напоминание о контрольном осмотре',
  'лабораторные интервалы для взрослых',
  'уход при насморке',
  'разница между вирусной и бактериальной инфекцией',
  'когда обращаться за неотложной помощью',
];

const NONE_SUFFIXES: readonly string[] = [
  'краткое объяснение',
  'какие признаки важны',
  'что уточнить у врача',
  'источник и определение',
  'для учебной заметки',
  'без назначения лечения',
  'с учетом анамнеза',
  'простыми словами',
  'проверка терминов',
  'вопрос по документу',
  'что означает запись',
  'сравнение подходов',
  'как найти раздел',
  'уточнение формулировки',
  'справочная информация',
];

function noneCase(topic: string, topicIndex: number, variant: number): CalculatorRoutingCase {
  const expectedSafety: CalculatorRoutingSafety =
    variant < 9 ? 'allow' : variant < 11 ? 'confirm' : 'abstain';
  return {
    id: `none-${topicIndex + 1}-${variant + 1}`,
    query: `${topic}: ${NONE_SUFFIXES[variant] ?? 'справочная информация'}`,
    split: (topicIndex + variant) % 2 === 0 ? 'fixed' : 'heldout',
    expectedRoute: 'none',
    expectedSafety,
    rationale:
      expectedSafety === 'abstain'
        ? 'Сценарий не содержит запроса на поддерживаемый калькулятор и должен воздержаться от маршрутизации.'
        : 'Сценарий проверяет, что обычный справочный запрос не запускает калькулятор автоматически.',
  };
}

export function generateCalculatorRoutingDataset(): CalculatorRoutingDataset {
  const cases: CalculatorRoutingCase[] = [];
  CALCULATOR_ROUTING_MEDICATIONS.forEach((scenario, index) => {
    for (let variant = 0; variant < 15; variant += 1) {
      cases.push(medicationCase(scenario, index, variant));
    }
  });
  INFUSIONS.forEach((scenario, index) => {
    for (let variant = 0; variant < 15; variant += 1) {
      cases.push(infusionCase(scenario, index, variant));
    }
  });
  OTHER_CALCULATORS.forEach((scenario, index) => {
    for (let variant = 0; variant < 10; variant += 1) {
      cases.push(otherCalculatorCase(scenario, index, variant));
    }
  });
  NONE_TOPICS.forEach((topic, index) => {
    for (let variant = 0; variant < 15; variant += 1) {
      cases.push(noneCase(topic, index, variant));
    }
  });
  return {
    schemaVersion: 1,
    dataset: 'calculator-routing-proposed-500',
    reviewStatus: 'proposed',
    cases,
  };
}

type CalculatorRoutingRecord = Record<string, unknown> & {
  readonly age?: unknown;
  readonly cases?: unknown;
  readonly dataset?: unknown;
  readonly expectedRoute?: unknown;
  readonly expectedSafety?: unknown;
  readonly extractedFacts?: unknown;
  readonly id?: unknown;
  readonly illness?: unknown;
  readonly medicationCanonicalTerms?: unknown;
  readonly rationale?: unknown;
  readonly query?: unknown;
  readonly route?: unknown;
  readonly reviewStatus?: unknown;
  readonly schemaVersion?: unknown;
  readonly split?: unknown;
  readonly weight?: unknown;
};

function isRecord(value: unknown): value is CalculatorRoutingRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new Error(`${path} must be an array of non-empty strings.`);
  }
  return value;
}

function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknown) throw new Error(`${path}.${unknown} is not allowed.`);
}

function parseFacts(value: unknown, path: string): CalculatorRoutingFacts {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, [...FACT_KEYS], path);
  for (const key of FACT_KEYS) {
    if (value[key] !== undefined) requiredString(value[key], `${path}.${key}`);
  }
  return value as CalculatorRoutingFacts;
}

function parseCase(value: unknown, index: number): CalculatorRoutingCase {
  const path = `cases[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(
    value,
    [
      'id',
      'query',
      'split',
      'expectedRoute',
      'expectedSafety',
      'medicationCanonicalTerms',
      'extractedFacts',
      'rationale',
    ],
    path,
  );
  const id = requiredString(value.id, `${path}.id`);
  const query = requiredString(value.query, `${path}.query`);
  if (!SPLITS.includes(value.split as CalculatorRoutingSplit)) {
    throw new Error(`${path}.split must be fixed or heldout.`);
  }
  if (!ROUTES.includes(value.expectedRoute as CalculatorRoutingRoute)) {
    throw new Error(`${path}.expectedRoute is invalid.`);
  }
  if (!SAFETY.includes(value.expectedSafety as CalculatorRoutingSafety)) {
    throw new Error(`${path}.expectedSafety is invalid.`);
  }
  const medicationCanonicalTerms =
    value.medicationCanonicalTerms === undefined
      ? undefined
      : stringArray(value.medicationCanonicalTerms, `${path}.medicationCanonicalTerms`);
  if (
    medicationCanonicalTerms &&
    new Set(medicationCanonicalTerms).size !== medicationCanonicalTerms.length
  ) {
    throw new Error(`${path}.medicationCanonicalTerms must be unique.`);
  }
  if (
    value.expectedRoute === 'medication-dose' &&
    value.expectedSafety !== 'confirm' &&
    (!medicationCanonicalTerms || medicationCanonicalTerms.length === 0)
  ) {
    throw new Error(
      `${path}.medicationCanonicalTerms is required for non-ambiguous medication-dose cases.`,
    );
  }
  const extractedFacts =
    value.extractedFacts === undefined
      ? undefined
      : parseFacts(value.extractedFacts, `${path}.extractedFacts`);
  const rationale = requiredString(value.rationale, `${path}.rationale`);
  return {
    id,
    query,
    split: value.split as CalculatorRoutingSplit,
    expectedRoute: value.expectedRoute as CalculatorRoutingRoute,
    expectedSafety: value.expectedSafety as CalculatorRoutingSafety,
    ...(medicationCanonicalTerms ? { medicationCanonicalTerms } : {}),
    ...(extractedFacts ? { extractedFacts } : {}),
    rationale,
  };
}

export function normalizeCalculatorRoutingQuery(query: string): string {
  return query
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function validateCalculatorRoutingDataset(value: unknown): CalculatorRoutingDataset {
  if (!isRecord(value)) throw new Error('Calculator-routing dataset must be an object.');
  assertKnownKeys(value, ['schemaVersion', 'dataset', 'reviewStatus', 'cases'], 'dataset');
  if (value.schemaVersion !== 1)
    throw new Error('Calculator-routing dataset schemaVersion must be 1.');
  if (value.dataset !== undefined) requiredString(value.dataset, 'dataset.dataset');
  if (value.reviewStatus !== 'proposed') {
    throw new Error("Calculator-routing dataset reviewStatus must be 'proposed'.");
  }
  if (!Array.isArray(value.cases) || value.cases.length !== 500) {
    throw new Error('Calculator-routing dataset must contain exactly 500 cases.');
  }
  const cases = value.cases.map(parseCase);
  const ids = new Set(cases.map((item) => item.id));
  if (ids.size !== cases.length) throw new Error('Calculator-routing case ids must be unique.');
  const queries = new Set(cases.map((item) => normalizeCalculatorRoutingQuery(item.query)));
  if (queries.size !== cases.length) {
    throw new Error('Calculator-routing normalized query texts must be unique.');
  }
  for (const split of SPLITS) {
    if (!cases.some((item) => item.split === split)) {
      throw new Error(`Calculator-routing split ${split} must be non-empty.`);
    }
  }
  return {
    schemaVersion: 1,
    ...(value.dataset === undefined ? {} : { dataset: value.dataset as string }),
    reviewStatus: 'proposed',
    cases,
  };
}

export function loadCalculatorRoutingDataset(): CalculatorRoutingDataset {
  return validateCalculatorRoutingDataset(generateCalculatorRoutingDataset());
}
