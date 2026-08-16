import type { ToolDefinitionRecord } from '@localmed/contracts';
import {
  clearDownloadedCalculatorSchemas,
  registerDownloadedCalculatorSchema,
} from '@/features/calculators/calculator-schema-catalog';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import type {
  AvailableCalculatorDefinition,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';

const DOWNLOADED_CALCULATORS = new Map<string, AvailableCalculatorDefinition>();

export function clearDownloadedCalculators(): void {
  DOWNLOADED_CALCULATORS.clear();
  clearDownloadedCalculatorSchemas();
}

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
    id: 'pediatric-oral-rehydration',
    slug: 'pediatric-oral-rehydration',
    state: 'available',
    title: 'Пероральная регидратация у детей',
    shortTitle: 'ОРС при потерях',
    aliases: ['Регидрон детям', 'регидратация детям', 'рвота понос', 'ОРС', 'oral rehydration'],
    summary:
      'Двухэтапный расчёт: возраст и масса задают исходную схему, затем рвота и жидкий стул добавляются как продолжающиеся потери.',
    audience: 'pediatric',
    category: 'fluids',
    clinical: true,
    formula:
      'ОРС при клинической дегидратации: 50 мл/кг за 4 ч; продолжающиеся потери: 10 мл/кг за жидкий стул и 2 мл/кг за эпизод рвоты; поддержка 100/50/20.',
    population: 'Дети от 1 месяца до 18 лет, если ребёнок может получать жидкость энтерально.',
    limitations: [
      '50 мл/кг за 4 часа — ориентир для регидратации при клинической дегидратации, а не универсальный домашний объём.',
      'Расчёт не определяет степень обезвоживания, не заменяет осмотр и не предназначен для шока, нарушений электролитов или невозможности пить.',
      'Для замещения потерь используется готовый низкоосмолярный раствор ОРС; вода не заменяет электролиты.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 1 / 12, maximum: 18 },
      { input: 'weightKg', unit: 'кг', required: true, minimum: 0.5, maximum: 200 },
      {
        input: 'diarrheaEpisodes',
        unit: 'за текущий период',
        required: true,
        minimum: 0,
        maximum: 100,
      },
      {
        input: 'vomitingEpisodes',
        unit: 'за текущий период',
        required: true,
        minimum: 0,
        maximum: 100,
      },
    ],
    sources: [
      {
        title: 'Diarrhoea and vomiting caused by gastroenteritis in under 5s',
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
  {
    id: 'obstetric-edd-lmp',
    slug: 'edd-by-lmp',
    state: 'available',
    title: 'ПДР по дате последней менструации',
    shortTitle: 'ПДР по ЛМП',
    aliases: ['правило Негеле', 'Naegele', 'ПДР по менструации', 'дата родов по ЛМП'],
    summary: 'Правило Негеле: последняя менструация + 280 дней, со сроком беременности на сегодня.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'ПДР = дата последней менструации + 280 дней',
    population:
      'Беременные с точно известной датой начала последней менструации и регулярным циклом.',
    limitations: [
      'Предполагает регулярный 28-дневный цикл; при нерегулярном цикле точность снижается.',
      'При наличии УЗИ первого триместра ACOG рекомендует ориентироваться на срок по УЗИ.',
    ],
    inputs: [{ input: 'lmpDate', required: true }],
    sources: [
      {
        title: 'Committee Opinion No. 700: Methods for Estimating the Due Date',
        publisher: 'American College of Obstetricians and Gynecologists (ACOG)',
        version: '2017, reaffirmed',
        url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-edd-ultrasound',
    slug: 'edd-by-ultrasound',
    state: 'available',
    title: 'ПДР по данным УЗИ',
    shortTitle: 'ПДР по УЗИ',
    aliases: ['дата родов по УЗИ', 'срок по УЗИ', 'ПДР ультразвук'],
    summary: 'Переносит срок беременности, установленный на УЗИ, в предполагаемую дату родов.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'ПДР = дата УЗИ + (280 − срок беременности на дату УЗИ, дней)',
    population: 'Беременные с известным сроком по протоколу УЗИ (недели + дни).',
    limitations: [
      'По практике ACOG ПДР фиксируется по первому надёжному УЗИ и обычно не пересчитывается позже.',
      'Точность зависит от триместра, в котором выполнено измерение.',
    ],
    inputs: [
      { input: 'examDate', required: true },
      { input: 'gaWeeks', unit: 'нед', required: true, minimum: 0, maximum: 42 },
      { input: 'gaDays', unit: 'дн', required: true, minimum: 0, maximum: 6 },
    ],
    sources: [
      {
        title: 'Committee Opinion No. 700: Methods for Estimating the Due Date',
        publisher: 'American College of Obstetricians and Gynecologists (ACOG)',
        version: '2017, reaffirmed',
        url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-edd-conception',
    slug: 'edd-by-conception',
    state: 'available',
    title: 'ПДР по дате зачатия',
    shortTitle: 'ПДР по зачатию',
    aliases: ['дата родов по зачатию', 'ПДР ЭКО', 'дата овуляции ПДР'],
    summary: 'Дата зачатия (овуляции) + 266 дней — удобно при известной дате ВРТ или овуляции.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'ПДР = дата зачатия + 266 дней',
    population: 'Беременные с точно известной датой зачатия, овуляции или переноса эмбриона.',
    limitations: ['Не учитывает день переноса эмбриона при ЭКО отдельно от дня оплодотворения.'],
    inputs: [{ input: 'conceptionDate', required: true }],
    sources: [
      {
        title: 'Committee Opinion No. 700: Methods for Estimating the Due Date',
        publisher: 'American College of Obstetricians and Gynecologists (ACOG)',
        version: '2017, reaffirmed',
        url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-edd-quickening',
    slug: 'edd-by-quickening',
    state: 'available',
    title: 'ПДР по первому шевелению плода',
    shortTitle: 'ПДР по шевелению',
    aliases: ['дата родов по шевелению', 'quickening', 'первое шевеление ПДР'],
    summary:
      'Ориентировочная ПДР по дате первого ощутимого шевеления с учётом первичности беременности.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula:
      'ПДР = дата первого шевеления + 22 нед (первобеременные) или + 24 нед (повторнобеременные)',
    population: 'Беременные без более точных данных (УЗИ, точная дата ЛМП или зачатия).',
    limitations: [
      'Наименее точный из представленных методов датирования; используется только при отсутствии УЗИ и надёжной даты ЛМП.',
      'Субъективность восприятия первого шевеления снижает точность метода.',
    ],
    inputs: [
      { input: 'quickeningDate', required: true },
      { input: 'parity', required: true },
    ],
    sources: [
      {
        title: 'Evaluation of Gestation: Estimating the Delivery Date',
        publisher: 'Medscape / eMedicine',
        version: 'Evaluation of Gestation overview',
        url: 'https://emedicine.medscape.com/article/259269-overview',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-edd-given-date',
    slug: 'edd-for-given-date',
    state: 'available',
    title: 'ПДР по сроку на заданную дату',
    shortTitle: 'ПДР по сроку',
    aliases: ['перевод срока в ПДР', 'дата родов по известному сроку', 'ПДР по направлению'],
    summary: 'Универсальный перевод «известный срок на какую-то дату» → предполагаемая дата родов.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'ПДР = заданная дата + (280 − известный срок беременности на эту дату, дней)',
    population:
      'Ситуации, когда срок беременности на конкретную дату уже известен (например, из выписки или направления), но ПДР нужно получить отдельно.',
    limitations: [
      'Точность полностью зависит от точности исходного срока, введённого пользователем.',
    ],
    inputs: [
      { input: 'referenceDate', required: true },
      { input: 'gaWeeks', unit: 'нед', required: true, minimum: 0, maximum: 42 },
      { input: 'gaDays', unit: 'дн', required: true, minimum: 0, maximum: 6 },
    ],
    sources: [
      {
        title: 'Committee Opinion No. 700: Methods for Estimating the Due Date',
        publisher: 'American College of Obstetricians and Gynecologists (ACOG)',
        version: '2017, reaffirmed',
        url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-ga-from-edd',
    slug: 'gestational-age-from-edd',
    state: 'available',
    title: 'Срок беременности по ПДР',
    shortTitle: 'Срок по ПДР',
    aliases: ['срок беременности сегодня', 'gestational age from EDD', 'недели по ПДР'],
    summary:
      'Обратный расчёт: по известной ПДР — срок беременности на сегодня или на заданную дату.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'Срок беременности = (дата расчёта) − (ПДР − 280 дней)',
    population: 'Беременные с уже установленной ПДР, когда нужно быстро получить текущий срок.',
    limitations: ['Точность ограничена точностью исходной ПДР.'],
    inputs: [
      { input: 'eddDate', required: true },
      { input: 'asOfDate', required: false, note: 'По умолчанию — сегодняшняя дата.' },
    ],
    sources: [
      {
        title: 'Committee Opinion No. 700: Methods for Estimating the Due Date',
        publisher: 'American College of Obstetricians and Gynecologists (ACOG)',
        version: '2017, reaffirmed',
        url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-maternity-leave',
    slug: 'maternity-leave-timeframe',
    state: 'available',
    title: 'Сроки отпуска по беременности и родам',
    shortTitle: 'Отпуск по берем. и родам',
    aliases: ['декретный отпуск', 'больничный по беременности', 'ст 255 ТК РФ', 'декрет сроки'],
    summary: 'Дата начала и продолжительность отпуска по беременности и родам по ст. 255 ТК РФ.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: false,
    formula:
      'Начало — 30 нед (28 нед при многоплодной беременности) от условной ЛМП; длительность 140 / 194 / 156 дней',
    population: 'Беременные, работающие по трудовому договору в РФ.',
    limitations: [
      'Не учитывает региональные и ведомственные надбавки, а также правила для ИП и самозанятых.',
      'Роды на сроке 22–30 недель оформляются отдельным листком на 156 дней от даты родов, а не по этой формуле.',
      'Осложнённые роды учтены только как факт (+16 дней); диагноз осложнения формула не проверяет.',
    ],
    inputs: [
      { input: 'eddDate', required: true },
      { input: 'pregnancyType', required: true },
      { input: 'complicatedBirth', required: false },
    ],
    sources: [
      {
        title: 'ТК РФ Статья 255. Отпуска по беременности и родам',
        publisher: 'КонсультантПлюс',
        version: 'Трудовой кодекс РФ, действующая редакция',
        url: 'https://www.consultant.ru/document/cons_doc_LAW_34683/dee45bc06a23ff585430585ef34c8124f5d89120/',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-ga-crl',
    slug: 'gestational-age-crl',
    state: 'available',
    title: 'Срок беременности по КТР (I триместр)',
    shortTitle: 'Срок по КТР',
    aliases: ['копчико-теменной размер', 'CRL срок беременности', 'Robinson Fleming', 'КТР недели'],
    summary: 'Формула Robinson–Fleming по копчико-теменному размеру плода, I триместр.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'Robinson–Fleming, 1975: срок (дни) = 8,052 × √(КТР, мм) + 23,73',
    population: 'Плод в I триместре с КТР 10–95 мм (примерно 6–14 недель).',
    limitations: [
      'Вне диапазона КТР 10–95 мм точность формулы не подтверждена.',
      'Не заменяет фетометрию II–III триместра при более позднем сроке.',
    ],
    inputs: [{ input: 'crlMm', unit: 'мм', required: true, minimum: 10, maximum: 95 }],
    sources: [
      {
        title: 'Gestational age estimated from Crown rump length on US by Robinson 1975 method',
        publisher: 'LOINC / Regenstrief Institute',
        version: 'LOINC 11914-9',
        url: 'https://loinc.org/11914-9',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-ga-biometry',
    slug: 'gestational-age-biometry',
    state: 'available',
    title: 'Срок беременности по фетометрии (II триместр)',
    shortTitle: 'Срок по фетометрии',
    aliases: ['БПР ОГ ОЖ ДБ срок', 'Hadlock срок беременности', 'фетометрия недели'],
    summary:
      'Срок беременности по БПР, ОГ, ОЖ и/или ДБ — среднее однопараметрических формул Hadlock 1984.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula:
      'Hadlock, 1984: отдельные регрессии по БПР/ОГ/ОЖ/ДБ (см); итог — среднее указанных оценок',
    population: 'Плод во II триместре, когда доступен хотя бы один параметр фетометрии.',
    limitations: [
      'Используется среднее независимых однопараметрических оценок, а не совместная многопараметрическая регрессия Hadlock.',
      'Точность снижается в III триместре и при выраженном отклонении роста плода.',
    ],
    inputs: [
      { input: 'bpdCm', unit: 'см', required: false, minimum: 2, maximum: 10.5 },
      { input: 'hcCm', unit: 'см', required: false, minimum: 8, maximum: 38 },
      { input: 'acCm', unit: 'см', required: false, minimum: 6, maximum: 40 },
      { input: 'flCm', unit: 'см', required: false, minimum: 1, maximum: 8.5 },
    ],
    sources: [
      {
        title: 'Gestational age estimated from Biparietal diameter on US by Hadlock 1984 method',
        publisher: 'LOINC / Regenstrief Institute',
        version: 'LOINC 11902-4',
        url: 'https://loinc.org/11902-4/',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-bishop-score',
    slug: 'bishop-score',
    state: 'available',
    title: 'Шкала Бишопа',
    shortTitle: 'Шкала Бишопа',
    aliases: ['Bishop score', 'зрелость шейки матки', 'готовность к родам', 'индукция родов шкала'],
    summary: 'Оценка зрелости шейки матки перед индукцией родов: 5 критериев, сумма 0–13 баллов.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula:
      'Bishop, 1964: сумма баллов по раскрытию, сглаживанию, станции головки, консистенции и позиции шейки',
    population:
      'Беременные перед плановой индукцией родов, когда оценивается зрелость шейки матки.',
    limitations: [
      'Не заменяет полную клиническую оценку показаний и противопоказаний к индукции.',
      'Модифицированные версии шкалы (с учётом паритета, преэклампсии и др.) в этом калькуляторе не используются.',
    ],
    inputs: [
      { input: 'dilationScore', required: true, minimum: 0, maximum: 3 },
      { input: 'effacementScore', required: true, minimum: 0, maximum: 3 },
      { input: 'stationScore', required: true, minimum: 0, maximum: 3 },
      { input: 'consistencyScore', required: true, minimum: 0, maximum: 2 },
      { input: 'positionScore', required: true, minimum: 0, maximum: 2 },
    ],
    sources: [
      {
        title: 'Pelvic Scoring for Elective Induction',
        publisher: 'Obstetrics & Gynecology / PubMed',
        version: 'Bishop 1964',
        url: 'https://pubmed.ncbi.nlm.nih.gov/14199536/',
        reviewedAt: '2026-08-08',
      },
    ],
  },
  {
    id: 'obstetric-fetal-growth-doppler',
    slug: 'obstetric-fetal-growth-doppler',
    state: 'available',
    title: 'Рост плода и допплерометрия',
    shortTitle: 'Рост и допплер',
    aliases: ['fetal growth', 'Doppler', 'ЦПС', 'церебро-плацентарное отношение', 'ПИ артерий'],
    summary: 'Расчёт ЦПС и среднего ПИ маточных артерий по данным протокола УЗИ.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula:
      'ЦПС = ПИ средней мозговой артерии / ПИ пуповинной артерии; средний ПИ маточных артерий = (правый + левый) / 2',
    population: 'Беременность 20–42 недели при наличии показателей допплерометрии в протоколе УЗИ.',
    limitations: [
      'Калькулятор считает индексы, но не определяет норму: пороги зависят от срока, методики и референсных таблиц учреждения.',
      'Процентиль массы вводится из протокола УЗИ и не рассчитывается без полного набора биометрии и выбранного стандарта.',
    ],
    inputs: [
      { input: 'gaWeeks', unit: 'нед', required: true, minimum: 20, maximum: 42 },
      { input: 'gaDays', unit: 'дн', required: true, minimum: 0, maximum: 6 },
      { input: 'efwG', unit: 'г', required: true, minimum: 100, maximum: 6000 },
      { input: 'efwPercentile', unit: '%', required: true, minimum: 0.1, maximum: 99.9 },
      { input: 'umbilicalArteryPi', required: true, minimum: 0.01, maximum: 10 },
      { input: 'middleCerebralArteryPi', required: true, minimum: 0.01, maximum: 10 },
      { input: 'uterineArteryPiRight', required: true, minimum: 0, maximum: 10 },
      { input: 'uterineArteryPiLeft', required: true, minimum: 0, maximum: 10 },
    ],
    sources: [
      {
        title: 'ISUOG Practice Guidelines: use of Doppler velocimetry in obstetrics',
        publisher: 'International Society of Ultrasound in Obstetrics and Gynecology',
        version: '2020',
        url: 'https://www.isuog.org/clinical-resources/isuog-guidelines.html',
        reviewedAt: '2026-08-14',
      },
    ],
  },
  {
    id: 'obstetric-efw-maternal-anthropometry',
    slug: 'obstetric-efw-maternal-anthropometry',
    state: 'available',
    title: 'Предполагаемая масса плода по антропометрии матери',
    shortTitle: 'Масса по антропометрии',
    aliases: ['EFW maternal anthropometry', 'масса плода по матери', 'масса при рождении'],
    summary:
      'Антропометрическая оценка ожидаемой массы при рождении по сроку и прибавке массы матери.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula:
      'Масса (г) = срок (дни) × [9,36 + 0,262 × пол + 0,000237 × рост × масса на 26-й неделе + 4,81 × скорость прибавки × (паритет + 1)]',
    population:
      'Одноплодная беременность III триместра; антропометрическая оценка ожидаемой массы при рождении.',
    limitations: [
      'Это модель массы при рождении, а не сонографическая оценка текущей массы плода; она не заменяет УЗИ.',
      'Точность зависит от популяции, качества данных о массе на 26-й неделе и скорости прибавки.',
    ],
    inputs: [
      { input: 'gaWeeks', unit: 'нед', required: true, minimum: 28, maximum: 42 },
      { input: 'gaDays', unit: 'дн', required: true, minimum: 0, maximum: 6 },
      { input: 'fetalSex', required: true },
      { input: 'maternalHeightCm', unit: 'см', required: true, minimum: 100, maximum: 220 },
      { input: 'maternalWeightAt26Kg', unit: 'кг', required: true, minimum: 35, maximum: 180 },
      { input: 'thirdTrimesterWeightGainKg', unit: 'кг', required: true, minimum: 0, maximum: 30 },
      { input: 'parity', unit: 'раз', required: true, minimum: 0, maximum: 10 },
    ],
    sources: [
      {
        title: 'Reliability of a clinical method in estimating foetal weight',
        publisher: 'PMC',
        version: '2021',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8517749/',
        reviewedAt: '2026-08-14',
      },
    ],
  },
  {
    id: 'obstetric-efw-rudakov',
    slug: 'obstetric-efw-rudakov',
    state: 'available',
    title: 'Предполагаемая масса плода по Рудакову',
    shortTitle: 'Масса по Рудакову',
    aliases: ['Rudakov', 'Рудаков масса плода', 'OJ VDM'],
    summary: 'Упрощённая bedside-оценка массы по окружности живота и высоте дна матки.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'Упрощённая оценка: масса (г) ≈ окружность живота (см) × высота дна матки (см)',
    population: 'Беременность III триместра при измерении окружности живота и высоты дна матки.',
    limitations: [
      'Полная методика Рудакова использует пальпаторные полуокружности и таблицу; здесь реализована распространённая упрощённая оценка без таблицы.',
      'Результат чувствителен к положению плода, ожирению, многоводию, многоплодию и ошибке измерения.',
    ],
    inputs: [
      { input: 'gaWeeks', unit: 'нед', required: true, minimum: 28, maximum: 42 },
      { input: 'abdominalCircumferenceCm', unit: 'см', required: true, minimum: 50, maximum: 160 },
      { input: 'fundalHeightCm', unit: 'см', required: true, minimum: 20, maximum: 45 },
    ],
    sources: [
      {
        title: 'Сравнение методов оценки массы плода',
        publisher: 'Arutunyan Doctor',
        version: 'онлайн-методика',
        url: 'https://arutunyan.doctor/tools/fetal-weight-comparison',
        reviewedAt: '2026-08-14',
      },
      {
        title: 'Reliability of a clinical method in estimating foetal weight',
        publisher: 'PMC',
        version: '2021',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8517749/',
        reviewedAt: '2026-08-14',
      },
    ],
  },
  {
    id: 'obstetric-vbac-antepartum',
    slug: 'obstetric-vbac-antepartum',
    state: 'available',
    title: 'Вероятность успешных родов после кесарева (при постановке на учёт)',
    shortTitle: 'VBAC при постановке на учёт',
    aliases: ['VBAC antepartum', 'TOLAC Grobman 2007', 'родоразрешение после кесарева'],
    summary: 'Прогностическая модель MFMU (Grobman, 2007) по данным первого дородового визита.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula: 'Grobman 2007: p = exp(w) / (1 + exp(w))',
    population:
      'Кандидаты на TOLAC с одним предшествующим кесаревым сечением при отсутствии противопоказаний к вагинальным родам.',
    limitations: [
      'Это прогностическая модель, а не решение о допустимости TOLAC и не гарантия исхода.',
      'Коэффициенты расы исторические и не должны использоваться как самостоятельный клинический признак; результат требует очной оценки акушером.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 18, maximum: 50 },
      { input: 'bmi', unit: 'кг/м²', required: true, minimum: 15, maximum: 60 },
      { input: 'race', required: true },
      { input: 'anyPriorVaginal', required: true },
      { input: 'priorVbac', required: true },
      { input: 'indication', required: true },
    ],
    sources: [
      {
        title: 'Prediction of vaginal birth after cesarean delivery',
        publisher: 'PMC / MFMU Network',
        version: 'Grobman 2007',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4372471/',
        reviewedAt: '2026-08-14',
      },
    ],
  },
  {
    id: 'obstetric-vbac-admission',
    slug: 'obstetric-vbac-admission',
    state: 'available',
    title: 'Вероятность успешных родов после кесарева (при поступлении на роды)',
    shortTitle: 'VBAC при поступлении',
    aliases: ['VBAC admission', 'TOLAC Grobman 2009', 'VBAC calculator admission'],
    summary: 'Прогностическая модель MFMU (Grobman, 2009) с факторами, известными при поступлении.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formula:
      'Grobman 2009: логистическая модель с возрастом, ИМТ, анамнезом, сроком, состоянием шейки и индукцией',
    population: 'Кандидаты на TOLAC при поступлении для родоразрешения.',
    limitations: [
      'Модель не определяет показания или противопоказания к TOLAC и не учитывает все клинические обстоятельства.',
      'Коэффициенты расы исторические; результат нельзя использовать как единственное основание для выбора способа родоразрешения.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 18, maximum: 50 },
      { input: 'bmi', unit: 'кг/м²', required: true, minimum: 15, maximum: 60 },
      { input: 'race', required: true },
      { input: 'anyPriorVaginal', required: true },
      { input: 'priorVbac', required: true },
      { input: 'indication', required: true },
      { input: 'gaWeeks', unit: 'нед', required: true, minimum: 34, maximum: 42 },
      { input: 'hypertensiveDisease', required: true },
      { input: 'effacement', unit: '%', required: true, minimum: 0, maximum: 100 },
      { input: 'dilation', unit: 'см', required: true, minimum: 0, maximum: 10 },
      { input: 'station', unit: 'станция', required: true, minimum: -3, maximum: 3 },
      { input: 'laborInduction', required: true },
    ],
    sources: [
      {
        title: 'Development of a nomogram for prediction of vaginal birth after cesarean delivery',
        publisher: 'Thieme / MFMU Network',
        version: 'Grobman 2009',
        url: 'https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0029-1239494',
        reviewedAt: '2026-08-14',
      },
    ],
  },
  {
    id: 'gynecology-breast-cancer-risk',
    slug: 'gynecology-breast-cancer-risk',
    state: 'available',
    title: 'Риск рака молочной железы — модель Gail/BCRAT',
    shortTitle: 'Риск молочной железы',
    aliases: ['Gail model', 'BCRAT', 'breast cancer risk', 'модель Гейла'],
    summary: 'Пятилетний и оставшийся до 90 лет риск инвазивного рака по модели NCI BCRAT.',
    audience: 'adult',
    category: 'gynecology',
    clinical: true,
    formula:
      'NCI Breast Cancer Risk Assessment Tool: относительный риск × возрастные базовые частоты с конкурирующей смертностью',
    population: 'Женщины 20–89 лет без ранее диагностированного инвазивного рака или DCIS.',
    limitations: [
      'Модель разработана на американских популяционных данных и не заменяет оценку наследственных синдромов.',
      'Результат нельзя сравнивать напрямую с популяциями, для которых базовые частоты и валидность модели отличаются.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 20, maximum: 89 },
      { input: 'race', required: true },
      { input: 'biopsiesCategory', required: true },
      { input: 'menarcheCategory', required: true },
      { input: 'firstBirthCategory', required: true },
      { input: 'relativesCategory', required: true },
      { input: 'atypicalHyperplasia', required: true },
    ],
    sources: [
      {
        title: 'About the Breast Cancer Risk Assessment Tool',
        publisher: 'National Cancer Institute',
        version: 'BCRAT',
        url: 'https://bcrisktool.cancer.gov/about.html',
        reviewedAt: '2026-08-14',
      },
      {
        title: 'Breast Cancer Risk Assessment (BCRA)',
        publisher: 'National Cancer Institute',
        version: 'R package 2.0',
        url: 'https://dceg.cancer.gov/tools/risk-assessment/bcra',
        reviewedAt: '2026-08-14',
      },
    ],
  },
  {
    id: 'gynecology-cervical-cancer-risk',
    slug: 'gynecology-cervical-cancer-risk',
    state: 'available',
    title: 'Скрининг шейки матки — ASCCP',
    shortTitle: 'Риск шейки матки',
    aliases: ['cervical cancer risk', 'ASCCP', 'ВПЧ и цитология', 'скрининг шейки матки'],
    summary: 'Справочная стратификация маршрута по общим сочетаниям ВПЧ, цитологии и анамнеза.',
    audience: 'adult',
    category: 'gynecology',
    clinical: true,
    formula:
      'ASCCP risk-based management: уровень 1–3 для навигации по общему маршруту, не абсолютный риск рака',
    population: 'Пациентки скринингового возраста с результатами ВПЧ-теста и цитологии.',
    limitations: [
      'Это не числовой калькулятор риска рака: точные риски CIN3+ требуют полной таблицы ASCCP, предыдущих результатов и дат.',
      'Иммунодефицит, беременность, возраст до 25 лет и лечение CIN2+ меняют маршрут; окончательное решение принимает врач.',
    ],
    inputs: [
      { input: 'ageYears', unit: 'лет', required: true, minimum: 21, maximum: 100 },
      { input: 'cytology', required: true },
      { input: 'hpvStatus', required: true },
      { input: 'hpv16Or18', required: true },
      { input: 'priorCin2Plus', required: true },
      { input: 'immunosuppressed', required: true },
    ],
    sources: [
      {
        title: 'Management Guidelines',
        publisher: 'ASCCP',
        version: 'Risk-based management',
        url: 'https://www.asccp.org/management-guidelines',
        reviewedAt: '2026-08-14',
      },
      {
        title: 'Updated Guidelines for Management of Cervical Cancer Screening Abnormalities',
        publisher: 'ACOG',
        version: '2020',
        url: 'https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2020/10/updated-guidelines-for-management-of-cervical-cancer-screening-abnormalities',
        reviewedAt: '2026-08-14',
      },
    ],
  },
];

export function getCalculatorRegistry(): readonly CalculatorDefinition[] {
  return [
    ...CALCULATOR_REGISTRY.filter((definition) => !DOWNLOADED_CALCULATORS.has(definition.id)),
    ...DOWNLOADED_CALCULATORS.values(),
  ];
}

export function registerDownloadedCalculator(record: ToolDefinitionRecord): void {
  if (record.kind !== 'calculator') return;
  const validation = validateCalculatorSchema(record.definition);
  if (!validation.ok || !validation.schema) {
    throw new Error(`Calculator payload is invalid: ${validation.errors.join('; ')}`);
  }
  const schema = validation.schema;
  registerDownloadedCalculatorSchema(record);
  DOWNLOADED_CALCULATORS.set(record.id, {
    id: record.id,
    slug: record.slug,
    state: 'available',
    title: record.title,
    shortTitle: record.shortTitle,
    aliases: record.aliases,
    summary: schema.summary,
    audience: schema.audience,
    category: schema.category,
    clinical: schema.clinical,
    formula: schema.formulaDisplay,
    population: schema.population,
    limitations: schema.limitations,
    inputs: schema.inputs.map((input) => ({
      input: input.id,
      ...(input.unit ? { unit: input.unit } : {}),
      ...(input.minimum !== undefined ? { minimum: input.minimum } : {}),
      ...(input.maximum !== undefined ? { maximum: input.maximum } : {}),
      required: input.required,
      ...(input.note ? { note: input.note } : {}),
    })),
    sources: schema.sources.map((source) => ({
      title: source.title,
      publisher: source.publisher,
      version: source.version,
      url: source.url ?? '',
      reviewedAt: source.reviewedAt,
    })),
  });
}

export const AVAILABLE_CALCULATORS: readonly AvailableCalculatorDefinition[] =
  CALCULATOR_REGISTRY.filter(
    (calculator): calculator is AvailableCalculatorDefinition => calculator.state === 'available',
  );

export function findCalculator(idOrSlug: string): CalculatorDefinition | undefined {
  return getCalculatorRegistry().find(
    (calculator) =>
      calculator.id === idOrSlug ||
      (calculator.state === 'available' && calculator.slug === idOrSlug),
  );
}

export function searchCalculators(query: string): readonly CalculatorDefinition[] {
  const normalized = query.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const registry = getCalculatorRegistry();
  if (!normalized) return registry;
  return registry.filter((calculator) => {
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
