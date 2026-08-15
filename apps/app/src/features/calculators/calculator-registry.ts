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
    state: 'planned',
    title: 'Рост плода и допплерометрия',
    summary:
      'Процентили роста плода и индексы допплерометрии (ПИ/ИР пуповинной и средней мозговой артерий).',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    sourceRequirement:
      'Требуются полные процентильные таблицы роста плода (например, Hadlock/INTERGROWTH-21st) и референсные диапазоны допплерометрии по сроку — набор таблиц, а не одна формула.',
  },
  {
    id: 'obstetric-efw-maternal-anthropometry',
    state: 'planned',
    title: 'Предполагаемая масса плода по антропометрии матери',
    summary: 'Оценка массы плода по росту, массе или ИМТ матери без ультразвуковой фетометрии.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    sourceRequirement:
      'Не найдено единой общепризнанной формулы по антропометрии именно матери (в отличие от высоты дна матки/окружности живота); требуется точная методика и первоисточник перед внедрением.',
  },
  {
    id: 'obstetric-efw-rudakov',
    state: 'planned',
    title: 'Предполагаемая масса плода по Рудакову',
    summary: 'Классический клинический метод оценки массы плода по пальпаторным полуокружностям.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    sourceRequirement:
      'Требуется таблица перевода индекса (произведение полуокружностей) в массу плода из первоисточника (отечественный учебник акушерства); только описание метода недостаточно для точного расчёта.',
  },
  {
    id: 'obstetric-vbac-antepartum',
    state: 'planned',
    title: 'Вероятность успешных родов после кесарева (при постановке на учёт)',
    summary: 'Прогностическая модель MFMU (Grobman, 2007) по данным первого дородового визита.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    sourceRequirement:
      'Требуются точные коэффициенты логистической регрессии из оригинальной публикации Grobman et al., 2007 — в открытых источниках воспроизведены не полностью.',
  },
  {
    id: 'obstetric-vbac-admission',
    state: 'planned',
    title: 'Вероятность успешных родов после кесарева (при поступлении на роды)',
    summary: 'Прогностическая модель MFMU (Grobman, 2009) с факторами, известными при поступлении.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    sourceRequirement:
      'Требуются точные коэффициенты логистической регрессии из оригинальной публикации Grobman et al., 2009 — в открытых источниках воспроизведены не полностью.',
  },
  {
    id: 'gynecology-breast-cancer-risk',
    state: 'planned',
    title: 'Риск рака молочной железы',
    summary: 'Оценка 5-летнего и пожизненного риска по модели Gail (BCRAT).',
    audience: 'adult',
    category: 'gynecology',
    clinical: true,
    sourceRequirement:
      'Требуются официальные возрастные и расовые таблицы базового риска NCI BCRAT — большой табличный набор данных, а не одна формула; нужна прямая интеграция с first-party таблицами перед внедрением.',
  },
  {
    id: 'gynecology-cervical-cancer-risk',
    state: 'planned',
    title: 'Риск рака шейки матки',
    summary: 'Стратификация риска по данным цитологии, ВПЧ-статуса и анамнеза.',
    audience: 'adult',
    category: 'gynecology',
    clinical: true,
    sourceRequirement:
      'Не найдено единого общепризнанного числового калькулятора риска (в отличие от Gail-модели для молочной железы); требуется зафиксировать конкретную модель (например, ASCCP risk-based management) перед внедрением.',
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
