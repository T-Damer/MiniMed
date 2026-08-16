import type { CalculatorSchema, ToolDefinitionRecord } from '@localmed/contracts';
import { CalculatorSchemaSchema } from '@localmed/contracts';

import { OBSTETRIC_SCHEMA_CATALOG } from '@/features/calculators/calculator-schema-catalog-obstetrics';

/**
 * Declarative calculator definitions, wired live into `CalculatorsView.tsx` (see `SCHEMA_CALCULATOR_IDS`/
 * `CALCULATOR_SCHEMA_CATALOG` there): the generic schema form renders these, and `evaluateCalculatorSchema`
 * computes results — no hand-coded form fields or bespoke calculation function per calculator. `id` and
 * `slug` match the existing `CALCULATOR_REGISTRY` entries in `calculator-registry.ts` exactly, so cards,
 * search, and install-section grouping keep working unchanged; only the form + calculation dispatch
 * changed. Adding a new calculator here — or updating one — needs no UI code: validate the JSON against
 * `CalculatorSchemaSchema` (`bun run content:lint:calculator`), add a matching entry to
 * `CALCULATOR_REGISTRY` for the card metadata, and it renders.
 *
 * Regression-tested against the original hardcoded formulas in `clinical-calculations.test.ts` /
 * `calculator-schema-catalog.test.ts` — same inputs produce numerically identical outputs. The two eGFR
 * schemas' implausible-creatinine guards (`calculateAdultEgfrCkdEpi2021`'s >30 mg/dl check,
 * `calculatePediatricEgfrSchwartz2009`'s >20 mg/dl check) are reproduced via `assertions` — see
 * `packages/contracts/src/calculator-schema.ts` for what that mechanism does.
 *
 * The obstetric calculators (date arithmetic, `assertions`, `interpretations`) live in
 * `calculator-schema-catalog-obstetrics.ts` and are merged into `CALCULATOR_SCHEMA_CATALOG` below.
 */

export const BODY_SURFACE_AREA_MOSTELLER_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'body-surface-area-mosteller',
  slug: 'body-surface-area-mosteller',
  title: 'Площадь поверхности тела — Mosteller',
  shortTitle: 'ППТ Mosteller',
  aliases: ['площадь поверхности тела', 'ППТ', 'BSA', 'Mosteller'],
  summary: 'ППТ по росту и массе с отображением исходной формулы и промежуточных шагов.',
  audience: 'all',
  category: 'anthropometry',
  clinical: true,
  formulaDisplay: 'Mosteller, 1987: BSA = √((рост, см × масса, кг) / 3600)',
  population: 'Пациенты с известными ростом и массой; возраст отдельно не используется.',
  limitations: [
    'Результат является оценкой, а не измерением.',
    'Протокол или инструкция могут требовать другую формулу ППТ.',
  ],
  inputs: [
    {
      id: 'heightCm',
      label: 'Рост',
      unit: 'см',
      kind: 'number',
      minimum: 1,
      maximum: 260,
      required: true,
    },
    {
      id: 'weightKg',
      label: 'Масса',
      unit: 'кг',
      kind: 'number',
      minimum: 0.1,
      maximum: 500,
      required: true,
    },
  ],
  steps: [
    {
      id: 'product',
      label: 'Произведение роста и массы',
      unit: 'см·кг',
      expression: 'heightCm * weightKg',
      displayPrecision: 0,
    },
    {
      id: 'ratio',
      label: 'Деление на 3600',
      unit: 'м⁴',
      expression: 'product / 3600',
      displayPrecision: 4,
    },
    {
      id: 'bsa',
      label: 'Площадь поверхности тела',
      unit: 'м²',
      expression: 'sqrt(ratio)',
      displayPrecision: 2,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'formula-estimate',
      message:
        'Это расчётная площадь поверхности тела. Для дозирования и протоколов используйте именно формулу, указанную в соответствующем источнике.',
    },
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
});

export const ADULT_EGFR_CKD_EPI_2021_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'adult-egfr-ckd-epi-2021',
  slug: 'adult-egfr-ckd-epi-2021',
  title: 'Расчётная СКФ у взрослых — CKD-EPI 2021',
  shortTitle: 'СКФ CKD-EPI 2021',
  aliases: ['CKD-EPI 2021', 'СКФ взрослые', 'eGFR adult', 'креатинин СКФ'],
  summary: 'Креатининовая CKD-EPI 2021 без расового коэффициента, с мг/дл и мкмоль/л.',
  audience: 'adult',
  category: 'renal',
  clinical: true,
  formulaDisplay: '142 × min(Scr/κ,1)^α × max(Scr/κ,1)^−1,200 × 0,9938^возраст × 1,012 для женщин',
  population: 'Взрослые от 18 лет со стандартизованным по IDMS сывороточным креатинином.',
  limitations: [
    'Не предназначена для детей.',
    'Ненадёжна при нестационарном креатинине и нетипичной мышечной массе.',
    'Не подменяет Cockcroft–Gault, когда инструкция препарата требует клиренс креатинина.',
  ],
  inputs: [
    {
      id: 'ageYears',
      label: 'Возраст',
      unit: 'лет',
      kind: 'number',
      minimum: 18,
      maximum: 120,
      required: true,
    },
    {
      id: 'sex',
      label: 'Пол',
      kind: 'select',
      required: true,
      options: [
        { value: 'female', label: 'Женский' },
        { value: 'male', label: 'Мужской' },
      ],
    },
    { id: 'creatinine', label: 'Креатинин', kind: 'number', minimum: 0.01, required: true },
    {
      id: 'creatinineUnit',
      label: 'Единица креатинина',
      kind: 'select',
      required: true,
      options: [
        { value: 'umol/l', label: 'мкмоль/л' },
        { value: 'mg/dl', label: 'мг/дл' },
      ],
    },
  ],
  steps: [
    {
      id: 'scrMgDl',
      label: 'Креатинин в единицах формулы',
      unit: 'мг/дл',
      expression: 'cond(creatinineUnit == "mg/dl", creatinine, creatinine / 88.4)',
      displayPrecision: 3,
    },
    {
      id: 'kappa',
      label: 'κ по полу',
      unit: 'безразмерно',
      expression: 'cond(sex == "female", 0.7, 0.9)',
      displayPrecision: 2,
    },
    {
      id: 'alpha',
      label: 'α по полу',
      unit: 'безразмерно',
      expression: 'cond(sex == "female", -0.241, -0.302)',
      displayPrecision: 3,
    },
    {
      id: 'sexFactor',
      label: 'Множитель для женщин',
      unit: 'безразмерно',
      expression: 'cond(sex == "female", 1.012, 1)',
      displayPrecision: 3,
    },
    {
      id: 'ratio',
      label: 'Отношение Scr/κ',
      unit: 'безразмерно',
      expression: 'scrMgDl / kappa',
      displayPrecision: 4,
    },
    {
      id: 'minPart',
      label: 'Минимальная часть',
      unit: 'безразмерно',
      expression: 'min(ratio, 1) ^ alpha',
      displayPrecision: 4,
    },
    {
      id: 'maxPart',
      label: 'Максимальная часть',
      unit: 'безразмерно',
      expression: 'max(ratio, 1) ^ -1.2',
      displayPrecision: 4,
    },
    {
      id: 'agePart',
      label: 'Возрастная часть',
      unit: 'безразмерно',
      expression: '0.9938 ^ ageYears',
      displayPrecision: 4,
    },
    {
      id: 'egfr',
      label: 'Расчётная СКФ',
      unit: 'мл/мин/1,73 м²',
      expression: '142 * minPart * maxPart * agePart * sexFactor',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  assertions: [{ when: 'scrMgDl > 30', error: 'Проверьте значение и единицы креатинина.' }],
  warnings: [
    {
      code: 'idms-creatinine',
      message: 'Формула предполагает стандартизованный по IDMS сывороточный креатинин.',
    },
    {
      code: 'not-drug-clearance',
      message:
        'Индексированная eGFR не равна клиренсу креатинина по Cockcroft–Gault и не должна автоматически подменять формулу из инструкции препарата.',
    },
    {
      code: 'unstable-creatinine',
      message:
        'Оценка ненадёжна при быстро меняющемся креатинине, острой почечной недостаточности и состояниях с нетипичной мышечной массой.',
    },
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
});

export const PEDIATRIC_EGFR_SCHWARTZ_2009_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'pediatric-egfr-schwartz-2009',
  slug: 'pediatric-egfr-schwartz-2009',
  title: 'Расчётная СКФ у детей — bedside CKiD 2009',
  shortTitle: 'СКФ Schwartz 2009',
  aliases: ['формула Шварца', 'Schwartz bedside', 'СКФ дети', 'CKiD 0.413'],
  summary: 'Bedside-формула 0,413 × рост / креатинин с явными возрастными ограничениями.',
  audience: 'pediatric',
  category: 'renal',
  clinical: true,
  formulaDisplay: 'Bedside CKiD (Schwartz), 2009: eGFR = 0,413 × рост(см) / Scr(мг/дл)',
  population: 'Дети 1–16 лет; исходная когорта преимущественно имела хроническую болезнь почек.',
  limitations: [
    'Ограниченная точность при нормальной или высокой СКФ.',
    'Предполагает стандартизованное ферментативное измерение креатинина.',
    'Не применяется автоматически у младенцев до года и пациентов старше 16 лет.',
  ],
  inputs: [
    {
      id: 'ageYears',
      label: 'Возраст',
      unit: 'лет',
      kind: 'number',
      minimum: 1,
      maximum: 16,
      required: true,
    },
    {
      id: 'heightCm',
      label: 'Рост',
      unit: 'см',
      kind: 'number',
      minimum: 40,
      maximum: 220,
      required: true,
    },
    { id: 'creatinine', label: 'Креатинин', kind: 'number', minimum: 0.01, required: true },
    {
      id: 'creatinineUnit',
      label: 'Единица креатинина',
      kind: 'select',
      required: true,
      options: [
        { value: 'umol/l', label: 'мкмоль/л' },
        { value: 'mg/dl', label: 'мг/дл' },
      ],
    },
  ],
  steps: [
    {
      id: 'scrMgDl',
      label: 'Креатинин в единицах формулы',
      unit: 'мг/дл',
      expression: 'cond(creatinineUnit == "mg/dl", creatinine, creatinine / 88.4)',
      displayPrecision: 3,
    },
    {
      id: 'numerator',
      label: 'Рост с коэффициентом',
      unit: 'см',
      expression: '0.413 * heightCm',
      displayPrecision: 3,
    },
    {
      id: 'egfr',
      label: 'Расчётная СКФ',
      unit: 'мл/мин/1,73 м²',
      expression: 'numerator / scrMgDl',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  assertions: [{ when: 'scrMgDl > 20', error: 'Проверьте значение и единицы креатинина.' }],
  warnings: [
    {
      code: 'derived-in-ckd',
      message:
        'Формула разработана преимущественно у детей с хронической болезнью почек и умеренно сниженной СКФ; для скрининга детей с нормальной функцией почек точность ограничена.',
    },
    {
      code: 'enzymatic-creatinine',
      message:
        'Исходная CKiD-формула основана на стандартизованном ферментативном измерении креатинина.',
    },
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
});

export const PEDIATRIC_MAINTENANCE_FLUIDS_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'pediatric-maintenance-fluids',
  slug: 'pediatric-maintenance-fluids',
  title: 'Поддерживающая жидкость у детей — Holliday–Segar',
  shortTitle: 'Жидкость 100/50/20',
  aliases: ['Holliday Segar', '4-2-1', '100 50 20', 'поддерживающая инфузия детям'],
  summary: 'Суточная схема 100/50/20 и почасовое приближение 4–2–1 с отдельными результатами.',
  audience: 'pediatric',
  category: 'fluids',
  clinical: true,
  formulaDisplay: '100/50/20 мл/кг/сут; почасовое приближение 4/2/1 мл/кг/ч',
  population: 'Дети с массой 0,5–200 кг, когда требуется исходная оценка поддерживающей воды.',
  limitations: [
    'Не включает дефицит, болюсы и продолжающиеся потери.',
    'Требует коррекции по клиническому состоянию и диурезу.',
    'Не определяет состав раствора и содержание электролитов.',
  ],
  inputs: [
    {
      id: 'weightKg',
      label: 'Масса',
      unit: 'кг',
      kind: 'number',
      minimum: 0.5,
      maximum: 200,
      required: true,
    },
  ],
  steps: [
    {
      id: 'firstTen',
      label: 'Первые 10 кг',
      unit: 'кг',
      expression: 'min(weightKg, 10)',
      displayPrecision: 2,
    },
    {
      id: 'secondTen',
      label: 'Вторые 10 кг',
      unit: 'кг',
      expression: 'min(max(weightKg - 10, 0), 10)',
      displayPrecision: 2,
    },
    {
      id: 'remaining',
      label: 'Масса свыше 20 кг',
      unit: 'кг',
      expression: 'max(weightKg - 20, 0)',
      displayPrecision: 2,
    },
    {
      id: 'daily',
      label: 'Суточная поддерживающая потребность',
      unit: 'мл/сут',
      expression: 'firstTen * 100 + secondTen * 50 + remaining * 20',
      displayPrecision: 0,
      isOutput: true,
    },
    {
      id: 'hourly421',
      label: 'Почасовая скорость 4–2–1',
      unit: 'мл/ч',
      expression: 'firstTen * 4 + secondTen * 2 + remaining * 1',
      displayPrecision: 1,
      isOutput: true,
    },
    {
      id: 'averageHourly',
      label: 'Средняя скорость из суточного объёма',
      unit: 'мл/ч',
      expression: 'daily / 24',
      displayPrecision: 1,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'maintenance-only',
      message:
        'Это только поддерживающая потребность: дефицит, продолжающиеся потери, болюсы и ограничения жидкости рассчитываются отдельно.',
    },
    {
      code: 'clinical-adjustment',
      message:
        'Расчёт требует клинической коррекции при лихорадке, вентиляции, олигурии, сердечной/почечной недостаточности, ожирении, обезвоживании и нарушениях натрия.',
    },
    {
      code: 'hourly-difference',
      message:
        'Правило 4–2–1 является округлённым почасовым приближением и может немного отличаться от суточного объёма, делённого на 24.',
    },
  ],
  sources: [
    {
      title: 'The maintenance need for water in parenteral fluid therapy',
      publisher: 'American Academy of Pediatrics',
      version: 'Holliday–Segar 1957',
      url: 'https://publications.aap.org/pediatrics/article/19/5/823/29135/THE-MAINTENANCE-NEED-FOR-WATER-IN-PARENTERAL-FLUID',
      reviewedAt: '2026-08-03',
    },
  ],
});

export const PEDIATRIC_ORAL_REHYDRATION_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'pediatric-oral-rehydration',
  slug: 'pediatric-oral-rehydration',
  title: 'Пероральная регидратация у детей',
  shortTitle: 'ОРС при потерях',
  aliases: ['Регидрон детям', 'регидратация детям', 'рвота понос', 'ОРС', 'oral rehydration'],
  summary:
    'Двухэтапный расчёт: возраст и масса задают исходную схему, затем рвота и жидкий стул добавляются как продолжающиеся потери.',
  audience: 'pediatric',
  category: 'fluids',
  clinical: true,
  formulaDisplay:
    'ОРС при клинической дегидратации: 50 мл/кг за 4 ч; продолжающиеся потери: 10 мл/кг за жидкий стул и 2 мл/кг за эпизод рвоты; поддержка 100/50/20.',
  population: 'Дети от 1 месяца до 18 лет, если ребёнок может получать жидкость энтерально.',
  limitations: [
    '50 мл/кг за 4 часа — ориентир для регидратации при клинической дегидратации, а не универсальный домашний объём.',
    'Расчёт не определяет степень обезвоживания, не заменяет осмотр и не предназначен для шока, нарушений электролитов или невозможности пить.',
    'Для замещения потерь используется готовый низкоосмолярный раствор ОРС (например, Регидрон, приготовленный строго по инструкции); вода не заменяет электролиты.',
  ],
  inputs: [
    {
      id: 'ageYears',
      label: 'Возраст',
      unit: 'лет',
      kind: 'number',
      minimum: 1 / 12,
      maximum: 18,
      required: true,
      step: 0,
      note: 'влияет на начальный темп маленьких порций',
    },
    {
      id: 'weightKg',
      label: 'Масса',
      unit: 'кг',
      kind: 'number',
      minimum: 0.5,
      maximum: 200,
      required: true,
      step: 0,
    },
    {
      id: 'diarrheaEpisodes',
      label: 'Эпизоды жидкого стула',
      unit: 'за текущий период',
      kind: 'number',
      minimum: 0,
      maximum: 100,
      integer: true,
      required: true,
      step: 1,
    },
    {
      id: 'vomitingEpisodes',
      label: 'Эпизоды рвоты',
      unit: 'за текущий период',
      kind: 'number',
      minimum: 0,
      maximum: 100,
      integer: true,
      required: true,
      step: 1,
    },
  ],
  steps: [
    {
      id: 'firstTen',
      label: 'Первые 10 кг',
      unit: 'кг',
      expression: 'min(weightKg, 10)',
      displayPrecision: 2,
      stepRequired: 0,
    },
    {
      id: 'secondTen',
      label: 'Вторые 10 кг',
      unit: 'кг',
      expression: 'min(max(weightKg - 10, 0), 10)',
      displayPrecision: 2,
      stepRequired: 0,
    },
    {
      id: 'remaining',
      label: 'Масса свыше 20 кг',
      unit: 'кг',
      expression: 'max(weightKg - 20, 0)',
      displayPrecision: 2,
      stepRequired: 0,
    },
    {
      id: 'maintenanceDaily',
      label: 'Суточная поддерживающая потребность',
      unit: 'мл/сут',
      expression: 'firstTen * 100 + secondTen * 50 + remaining * 20',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 0,
    },
    {
      id: 'maintenanceHourly421',
      label: 'Почасовая скорость 4–2–1',
      unit: 'мл/ч',
      expression: 'firstTen * 4 + secondTen * 2 + remaining',
      displayPrecision: 1,
      isOutput: true,
      stepRequired: 0,
    },
    {
      id: 'initialOrs',
      label: 'ОРС при клинической дегидратации за 4 часа',
      unit: 'мл',
      expression: 'weightKg * 50',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 0,
    },
    {
      id: 'initialOrsHourly',
      label: 'Средняя скорость ОРС на эти 4 часа',
      unit: 'мл/ч',
      expression: 'initialOrs / 4',
      displayPrecision: 1,
      isOutput: true,
      stepRequired: 0,
    },
    {
      id: 'startingSip',
      label: 'Начальная порция при отпаивании',
      unit: 'мл',
      expression: 'cond(ageYears < 2, 5, 10)',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 0,
    },
    {
      id: 'stoolLoss',
      label: 'Оценка потерь с жидким стулом',
      unit: 'мл ОРС',
      expression: 'weightKg * 10 * diarrheaEpisodes',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 1,
    },
    {
      id: 'vomitLoss',
      label: 'Оценка потерь с рвотой',
      unit: 'мл ОРС',
      expression: 'weightKg * 2 * vomitingEpisodes',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 1,
    },
    {
      id: 'ongoingLosses',
      label: 'Продолжающиеся потери по введённым эпизодам',
      unit: 'мл ОРС',
      expression: 'stoolLoss + vomitLoss',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 1,
    },
    {
      id: 'replacementWithRecordedLosses',
      label: 'Базовый ОРС плюс введённые потери',
      unit: 'мл ОРС',
      expression: 'initialOrs + ongoingLosses',
      displayPrecision: 0,
      isOutput: true,
      stepRequired: 1,
    },
  ],
  warnings: [
    {
      code: 'ors-preparation',
      message:
        'Используйте готовый низкоосмолярный раствор ОРС (например, Регидрон), разводите строго по инструкции. Не заменяйте объём замещения потерь одной водой.',
    },
    {
      code: 'small-frequent-sips',
      message:
        'Отпаивайте часто и малыми порциями: после рвоты подождите 10 минут, затем возобновите медленнее; для детей младше 2 лет ориентир — около 5 мл каждые 1–2 минуты.',
    },
    {
      code: 'urgent-review',
      message:
        'При шоке, вялости или нарушении сознания, отсутствии мочи, крови или зелёной рвоте, невозможности пить либо сохраняющейся рвоте нужна срочная очная медицинская помощь.',
    },
  ],
  interpretations: [
    {
      when: 'ageYears < 1',
      message:
        'Возраст младше 1 года повышает риск обезвоживания; нужна более ранняя очная оценка, особенно при повторной рвоте или частом жидком стуле.',
    },
    {
      when: 'vomitingEpisodes > 2',
      message:
        'Более двух эпизодов рвоты за 24 часа — фактор повышенного риска обезвоживания; контролируйте переносимость ОРС и обратитесь за медицинской помощью при ухудшении.',
    },
  ],
  assertions: [],
  sources: [
    {
      title: 'Diarrhoea and vomiting caused by gastroenteritis in under 5s: recommendations',
      publisher: 'NICE',
      version: 'CG84',
      url: 'https://www.nice.org.uk/guidance/cg84/chapter/Recommendations',
      reviewedAt: '2026-08-15',
    },
    {
      title: 'Managing Acute Gastroenteritis Among Children',
      publisher: 'CDC',
      version: 'MMWR RR-16',
      url: 'https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5216a1.htm',
      reviewedAt: '2026-08-15',
    },
    {
      title: 'Readings on diarrhoea: oral rehydration guidance',
      publisher: 'World Health Organization',
      version: 'WHO 9241544449',
      url: 'https://iris.who.int/bitstream/10665/40343/1/9241544449.pdf',
      reviewedAt: '2026-08-15',
    },
  ],
});

/**
 * The whole schema-driven catalog, keyed by id. Adding a calculator: append a `CalculatorSchemaSchema`
 * instance above (or load one from JSON that passed `bun run content:lint:calculator`), add it here, and
 * add its card metadata to `CALCULATOR_REGISTRY` in `calculator-registry.ts` — no other code changes.
 */
export const CALCULATOR_SCHEMA_CATALOG: readonly CalculatorSchema[] = [
  BODY_SURFACE_AREA_MOSTELLER_SCHEMA,
  ADULT_EGFR_CKD_EPI_2021_SCHEMA,
  PEDIATRIC_EGFR_SCHWARTZ_2009_SCHEMA,
  PEDIATRIC_MAINTENANCE_FLUIDS_SCHEMA,
  PEDIATRIC_ORAL_REHYDRATION_SCHEMA,
  ...OBSTETRIC_SCHEMA_CATALOG,
];

export const CALCULATOR_SCHEMA_BY_ID: ReadonlyMap<string, CalculatorSchema> = new Map(
  CALCULATOR_SCHEMA_CATALOG.map((schema) => [schema.id, schema]),
);

const DOWNLOADED_CALCULATOR_SCHEMAS = new Map<string, CalculatorSchema>();

export function clearDownloadedCalculatorSchemas(): void {
  DOWNLOADED_CALCULATOR_SCHEMAS.clear();
}

export function registerDownloadedCalculatorSchema(
  record: ToolDefinitionRecord,
): CalculatorSchema | null {
  if (record.kind !== 'calculator') return null;
  const schema = CalculatorSchemaSchema.parse(record.definition);
  if (schema.id !== record.id || schema.slug !== record.slug) {
    throw new Error(`Calculator payload does not match ${record.id}.`);
  }
  DOWNLOADED_CALCULATOR_SCHEMAS.set(record.id, schema);
  return schema;
}

export function getCalculatorSchema(id: string): CalculatorSchema | undefined {
  return DOWNLOADED_CALCULATOR_SCHEMAS.get(id) ?? CALCULATOR_SCHEMA_BY_ID.get(id);
}
