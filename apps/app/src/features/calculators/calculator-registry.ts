import type {
  AvailableCalculatorDefinition,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';

export const CALCULATOR_REGISTRY: readonly CalculatorDefinition[] = [
  {
    id: 'unit-conversion',
    slug: 'unit-conversion',
    state: 'available',
    title: 'Преобразование единиц',
    shortTitle: 'Единицы',
    aliases: ['конвертер единиц', 'мг в мл', 'кг в граммы', 'мкг мг'],
    summary: 'Масса, длина и объём с явным промежуточным значением в базовой единице.',
    audience: 'all',
    category: 'unit-conversion',
    clinical: false,
    formula: 'Линейное преобразование через базовую единицу выбранной величины.',
    population: 'Любой пользователь; не является клинической формулой.',
    limitations: ['Не преобразует массу в объём без отдельно заданной концентрации или плотности.'],
    inputs: [
      { input: 'value', required: true, minimum: 0 },
      { input: 'sourceUnit', required: true },
      { input: 'targetUnit', required: true },
    ],
    sources: [],
  },
  {
    id: 'body-surface-area-mosteller',
    slug: 'body-surface-area-mosteller',
    state: 'available',
    title: 'Площадь поверхности тела — Mosteller',
    shortTitle: 'ППТ Mosteller',
    aliases: ['площадь поверхности тела', 'ППТ', 'BSA', 'Mosteller'],
    summary: 'ППТ по росту и массе с отображением исходной формулы и промежуточных шагов.',
    audience: 'all',
    category: 'anthropometry',
    clinical: true,
    formula: 'BSA = √((рост, см × масса, кг) / 3600)',
    population: 'Пациенты с известными ростом и массой; возраст отдельно не используется.',
    limitations: [
      'Результат является оценкой, а не измерением.',
      'Протокол или инструкция могут требовать другую формулу ППТ.',
    ],
    inputs: [
      { input: 'heightCm', unit: 'см', required: true, minimum: 1, maximum: 260 },
      { input: 'weightKg', unit: 'кг', required: true, minimum: 0.1, maximum: 500 },
    ],
    sources: [
      {
        title: 'Simplified calculation of body-surface area',
        publisher: 'New England Journal of Medicine / PubMed',
        version: 'Mosteller 1987',
        url: 'https://pubmed.ncbi.nlm.nih.gov/3657876/',
        reviewedAt: '2026-08-03',
      },
    ],
  },
  {
    id: 'adult-egfr-ckd-epi-2021',
    slug: 'adult-egfr-ckd-epi-2021',
    state: 'available',
    title: 'Расчётная СКФ у взрослых — CKD-EPI 2021',
    shortTitle: 'СКФ CKD-EPI 2021',
    aliases: ['CKD-EPI 2021', 'СКФ взрослые', 'eGFR adult', 'креатинин СКФ'],
    summary: 'Креатининовая CKD-EPI 2021 без расового коэффициента, с мг/дл и мкмоль/л.',
    audience: 'adult',
    category: 'renal',
    clinical: true,
    formula: '142 × min(Scr/κ,1)^α × max(Scr/κ,1)^−1,200 × 0,9938^возраст × 1,012 для женщин',
    population: 'Взрослые от 18 лет со стандартизованным по IDMS сывороточным креатинином.',
    limitations: [
      'Не предназначена для детей.',
      'Ненадёжна при нестационарном креатинине и нетипичной мышечной массе.',
      'Не подменяет Cockcroft–Gault, когда инструкция препарата требует клиренс креатинина.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 18, maximum: 120 },
      { input: 'sex', required: true },
      { input: 'creatinine', required: true, minimum: 0.01 },
      { input: 'creatinineUnit', required: true },
    ],
    sources: [
      {
        title: 'New Creatinine- and Cystatin C-Based Equations to Estimate GFR without Race',
        publisher: 'New England Journal of Medicine / PubMed',
        version: 'CKD-EPI 2021',
        url: 'https://pubmed.ncbi.nlm.nih.gov/34554658/',
        reviewedAt: '2026-08-03',
      },
      {
        title: 'CKD-EPI Creatinine Equation (2021)',
        publisher: 'National Kidney Foundation',
        version: '2021 creatinine equation',
        url: 'https://www.kidney.org/professionals/ckd-epi-creatinine-equation-2021',
        reviewedAt: '2026-08-03',
      },
    ],
  },
  {
    id: 'pediatric-egfr-schwartz-2009',
    slug: 'pediatric-egfr-schwartz-2009',
    state: 'available',
    title: 'Расчётная СКФ у детей — bedside CKiD 2009',
    shortTitle: 'СКФ Schwartz 2009',
    aliases: ['формула Шварца', 'Schwartz bedside', 'СКФ дети', 'CKiD 0.413'],
    summary: 'Bedside-формула 0,413 × рост / креатинин с явными возрастными ограничениями.',
    audience: 'pediatric',
    category: 'renal',
    clinical: true,
    formula: 'eGFR = 0,413 × рост(см) / Scr(мг/дл)',
    population: 'Дети 1–16 лет; исходная когорта преимущественно имела хроническую болезнь почек.',
    limitations: [
      'Ограниченная точность при нормальной или высокой СКФ.',
      'Предполагает стандартизованное ферментативное измерение креатинина.',
      'Не применяется автоматически у младенцев до года и пациентов старше 16 лет.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 1, maximum: 16 },
      { input: 'heightCm', unit: 'см', required: true, minimum: 40, maximum: 220 },
      { input: 'creatinine', required: true, minimum: 0.01 },
      { input: 'creatinineUnit', required: true },
    ],
    sources: [
      {
        title: 'New equations to estimate GFR in children with CKD',
        publisher: 'Journal of the American Society of Nephrology / PubMed',
        version: 'Bedside CKiD 2009',
        url: 'https://pubmed.ncbi.nlm.nih.gov/19158356/',
        reviewedAt: '2026-08-03',
      },
    ],
  },
  {
    id: 'pediatric-maintenance-fluids',
    slug: 'pediatric-maintenance-fluids',
    state: 'available',
    title: 'Поддерживающая жидкость у детей — Holliday–Segar',
    shortTitle: 'Жидкость 100/50/20',
    aliases: ['Holliday Segar', '4-2-1', '100 50 20', 'поддерживающая инфузия детям'],
    summary: 'Суточная схема 100/50/20 и почасовое приближение 4–2–1 с отдельными результатами.',
    audience: 'pediatric',
    category: 'fluids',
    clinical: true,
    formula: '100/50/20 мл/кг/сут; почасовое приближение 4/2/1 мл/кг/ч',
    population: 'Дети с массой 0,5–200 кг, когда требуется исходная оценка поддерживающей воды.',
    limitations: [
      'Не включает дефицит, болюсы и продолжающиеся потери.',
      'Требует коррекции по клиническому состоянию и диурезу.',
      'Не определяет состав раствора и содержание электролитов.',
    ],
    inputs: [{ input: 'weightKg', unit: 'кг', required: true, minimum: 0.5, maximum: 200 }],
    sources: [
      {
        title: 'The maintenance need for water in parenteral fluid therapy',
        publisher: 'American Academy of Pediatrics',
        version: 'Holliday–Segar 1957',
        url: 'https://publications.aap.org/pediatrics/article/19/5/823/29135/THE-MAINTENANCE-NEED-FOR-WATER-IN-PARENTERAL-FLUID',
        reviewedAt: '2026-08-03',
      },
    ],
  },
  {
    id: 'pediatric-anthropometry',
    state: 'planned',
    title: 'Антропометрия детей',
    summary: 'Возрастные показатели роста и массы без смешивания разных эталонных наборов.',
    audience: 'pediatric',
    category: 'anthropometry',
    clinical: true,
    sourceRequirement:
      'Закрепить конкретный набор эталонов, таблицы LMS, возрастной диапазон и правила недоношенности.',
  },
  {
    id: 'medication-dose',
    state: 'planned',
    title: 'Расчёт дозы лекарственного препарата',
    summary: 'Масса, доза на кг, концентрация, разовая и максимальная доза как отдельные величины.',
    audience: 'all',
    category: 'medication',
    clinical: true,
    sourceRequirement:
      'Зафиксировать препарат, показание, возраст, путь введения, концентрацию, максимум и правила округления.',
  },
];

export const AVAILABLE_CALCULATORS: readonly AvailableCalculatorDefinition[] =
  CALCULATOR_REGISTRY.filter(
    (calculator): calculator is AvailableCalculatorDefinition => calculator.state === 'available',
  );

export function findCalculator(idOrSlug: string): CalculatorDefinition | undefined {
  return CALCULATOR_REGISTRY.find(
    (calculator) =>
      calculator.id === idOrSlug ||
      (calculator.state === 'available' && calculator.slug === idOrSlug),
  );
}

export function searchCalculators(query: string): readonly CalculatorDefinition[] {
  const normalized = query.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (!normalized) return CALCULATOR_REGISTRY;
  return CALCULATOR_REGISTRY.filter((calculator) => {
    const searchable = [
      calculator.title,
      calculator.summary,
      calculator.audience,
      calculator.category,
      ...(calculator.state === 'available' ? calculator.aliases : []),
    ]
      .join(' ')
      .toLocaleLowerCase('ru-RU')
      .replaceAll('ё', 'е');
    return searchable.includes(normalized);
  });
}
