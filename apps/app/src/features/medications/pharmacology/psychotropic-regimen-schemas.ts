import {
  type DrugRegimenBranch,
  normalizeInnLookupKey,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';

/**
 * Schema-declared block-schema dosing protocols per patient group, route, and clinical scenario,
 * grounded in official GRLS instructions and Russian Clinical Recommendations (КР).
 * Rendered generically by `DrugUsageSchemaView` without UI branching on drug IDs.
 */

const REGIMEN_SCHEMAS_BY_INN: Readonly<Record<string, readonly DrugRegimenBranch[]>> = {
  алимемазин: [
    {
      id: 'alimemazine-adult-sleep',
      scenario: 'Снотворный и седативный эффект',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Приём',
          dose: '5–10 мг однократно',
          duration: 'за 20–30 мин до сна',
          note: 'Таблетки проглатывать целиком, не разжёвывая',
        },
      ],
      sourceLabel: 'Инструкция ГРЛС (Тералиджен®)',
    },
    {
      id: 'alimemazine-adult-anxiety',
      scenario: 'Тревога, неврозы и вегетостабилизация',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт',
          dose: '2,5–5 мг вечером',
          note: 'Оценка переносимости и сонливости',
        },
        {
          stage: 'Титрация',
          dose: '↑ постепенно на 3–4 приёма',
          note: 'Большую долю дозы — на вечер',
        },
        {
          stage: 'Поддержка',
          dose: '15–60 мг/сут · тревога 20–80 мг/сут',
          duration: '2–6+ мес',
          note: '15–60 мг — вегетостабилизация; 20–80 мг — анксиолитик',
        },
      ],
      maxDaily: '500 мг/сут',
      courseLength: '2–6 и более мес',
      sourceLabel: 'Инструкция ГРЛС (Тералиджен®)',
    },
    {
      id: 'alimemazine-elderly',
      scenario: 'Пожилые пациенты (>60 лет)',
      group: 'elderly',
      patientBadge: 'Пожилые (>60 лет)',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт',
          dose: '2,5 мг вечером',
          note: 'Контроль ортостаза, седации и риска падений',
        },
        {
          stage: 'Поддержка',
          dose: 'Минимальная эффективная доза',
          duration: '2–6 мес',
        },
      ],
      maxDaily: '200 мг/сут',
      courseLength: 'Индивидуально',
      sourceLabel: 'Инструкция ГРЛС (Тералиджен®)',
    },
    {
      id: 'alimemazine-child-7',
      scenario: 'Тревога, бессонница, расстройства поведения',
      group: 'child',
      patientBadge: 'Дети с 7 лет',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт / сон',
          dose: '2,5–5 мг/сут',
          duration: 'за 20–30 мин до сна',
          note: 'При аллергии: 5–20 мг/сут',
        },
        {
          stage: 'Поддержка',
          dose: '20–40 мг/сут в 3–4 приёма',
          duration: '2–6+ мес',
          note: 'При психотических нарушениях поведения — до 60 мг/сут',
        },
      ],
      maxDaily: '60 мг/сут',
      courseLength: '2–6+ мес',
      sourceLabel: 'Инструкция ГРЛС · КР 676_2',
    },
    {
      id: 'alimemazine-child-3',
      scenario: 'Аллергия и премедикация',
      group: 'child',
      patientBadge: 'Дети 3–7 лет',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Аллергия',
          dose: '2,5–5 мг × 3–4 р/сут',
          duration: '2–6+ мес',
        },
        {
          stage: 'Премедикация',
          dose: '2 мг/кг однократно',
          duration: 'за 1–2 ч до операции',
          note: 'Макс. сут. 2 мг/кг',
        },
      ],
      maxDaily: '2 мг/кг (премедикация)',
      sourceLabel: 'Инструкция ГРЛС (Тералиджен®)',
    },
    {
      id: 'alimemazine-im-acute',
      scenario: 'Острые состояния, абстиненция, премедикация',
      group: 'acute',
      patientBadge: 'Взрослые (18+)',
      route: 'В/м (5 мг/мл)',
      steps: [
        {
          stage: 'Аллергия / премедикация',
          dose: '25 мг 1–2 р/сут · премед. 25–50 мг',
          duration: 'за 1–2 ч до операции',
        },
        {
          stage: 'Абстинентный синдром',
          dose: '50 мг 1–2 р/сут',
          note: 'Строго в/м (избегать п/к — риск некроза)',
        },
        {
          stage: 'Психиатрия / острые',
          dose: '100–200 мг/сут',
        },
      ],
      maxDaily: '200 мг/сут',
      sourceLabel: 'Инструкция ГРЛС (Тералиджен® в/м)',
    },
  ],

  кветиапин: [
    {
      id: 'quetiapine-schizo',
      scenario: 'Шизофрения',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 2 р/сут',
      steps: [
        {
          stage: 'Титрация',
          dose: '50 → 100 → 200 → 300 мг/сут',
          duration: 'дни 1–4',
        },
        {
          stage: 'Поддержка',
          dose: '300–450 мг/сут',
          note: 'Диапазон 150–750 мг/сут по эффекту',
        },
        {
          stage: 'Отмена',
          dose: 'Постепенное снижение',
          duration: 'минимум 1–2 нед',
        },
      ],
      maxDaily: '750 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'quetiapine-mania',
      scenario: 'Маниакальные эпизоды при БАР',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 2 р/сут',
      steps: [
        {
          stage: 'Титрация',
          dose: '100 → 200 → 300 → 400 мг/сут',
          duration: 'дни 1–4',
        },
        {
          stage: 'Эскалация',
          dose: 'До 800 мг/сут к 6-му дню',
          duration: 'шаг ≤200 мг/сут',
        },
      ],
      maxDaily: '800 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'quetiapine-bipolar-dep',
      scenario: 'Депрессивные эпизоды при БАР',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут на ночь',
      steps: [
        {
          stage: 'Титрация',
          dose: '50 → 100 → 200 → 300 мг/сут',
          duration: 'дни 1–4',
        },
        {
          stage: 'Поддержка',
          dose: '300 мг/сут на ночь',
          note: 'Снижение до 200 мг при плохой переносимости; в отдельных случаях до 600 мг',
        },
      ],
      maxDaily: '600 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'quetiapine-elderly-hepatic',
      scenario: 'Пожилые (65+) и нарушения функции печени',
      group: 'elderly',
      patientBadge: 'Пожилые 65+ / печень',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт',
          dose: '25 мг/сут',
          note: 'Медленный шаг 25–50 мг/сут; при почечной недостаточности коррекция не требуется',
        },
        {
          stage: 'Поддержка',
          dose: 'Минимальная эффективная доза',
        },
      ],
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  рисперидон: [
    {
      id: 'risperidone-schizo',
      scenario: 'Шизофрения',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · 1–2 р/сут',
      steps: [
        { stage: 'Старт', dose: '2 мг/сут', duration: 'день 1' },
        { stage: 'Титрация', dose: '4 мг/сут', duration: 'день 2' },
        {
          stage: 'Поддержка',
          dose: '4–6 мг/сут',
          note: 'Выше 6–8 мг/сут резко растёт риск ЭПС и гиперпролактинемии',
        },
      ],
      maxDaily: '16 мг/сут (обычно ≤8 мг)',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'risperidone-elderly',
      scenario: 'Пожилые, почечная/печёночная недостаточность',
      group: 'elderly',
      patientBadge: 'Пожилые / ХБП / печень',
      route: 'Внутрь · 2 р/сут',
      steps: [
        { stage: 'Старт', dose: '0,5 мг × 2 р/сут' },
        { stage: 'Титрация', dose: '+0,5 мг × 2 р/сут', duration: 'до 1–2 мг × 2 р/сут' },
      ],
      maxDaily: '4 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'risperidone-child-asd',
      scenario: 'Нарушения поведения при РАС',
      group: 'child',
      patientBadge: 'Дети с 5 лет',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '0,25 мг (<20 кг) · 0,5 мг (≥20 кг)', duration: 'дни 1–3' },
        { stage: 'Поддержка', dose: '0,5–1,5 мг/сут (<50 кг) · до 2,5 мг (≥50 кг)' },
      ],
      sourceLabel: 'Инструкция ГРЛС · КР 676_2',
    },
  ],

  оланзапин: [
    {
      id: 'olanzapine-schizo',
      scenario: 'Шизофрения и биполярная мания',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '10 мг/сут (шизофрения) · 15 мг (мания)' },
        {
          stage: 'Поддержка',
          dose: '5–20 мг/сут',
          note: 'Коррекция дозы не чаще 1 раза в сутки; контроль массы, глюкозы, липидов',
        },
      ],
      maxDaily: '20 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'olanzapine-elderly',
      scenario: 'Пожилые (65+), печень/почки, некурящие женщины',
      group: 'elderly',
      patientBadge: 'Пожилые / замедленный клиренс',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '5 мг/сут' },
        { stage: 'Поддержка', dose: '5–10 мг/сут', note: 'Повышать осторожно' },
      ],
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  арипипразол: [
    {
      id: 'aripiprazole-adult',
      scenario: 'Шизофрения и мания при БАР',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '10–15 мг/сут (мания: 15 мг)', note: 'Независимо от приёма пищи' },
        {
          stage: 'Оценка / титрация',
          dose: '15–30 мг/сут',
          duration: 'не ранее чем через 2 нед',
          note: 'Длинный t½ (~75 ч); контроль акатизии',
        },
      ],
      maxDaily: '30 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'aripiprazole-teen',
      scenario: 'Шизофрения / БАР у подростков',
      group: 'child',
      patientBadge: 'Подростки 13–17 лет',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '2 мг/сут', duration: '2 дня' },
        { stage: 'Титрация', dose: '5 мг/сут', duration: '2 дня' },
        { stage: 'Поддержка', dose: '10 мг/сут', note: 'При необходимости шаг +5 мг' },
      ],
      maxDaily: '30 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  галоперидол: [
    {
      id: 'haloperidol-acute-im',
      scenario: 'Острое психомоторное возбуждение / психоз',
      group: 'acute',
      patientBadge: 'Взрослые',
      route: 'В/м',
      steps: [
        { stage: 'Старт', dose: '5 мг в/м', note: 'ЭКГ-контроль интервала QTc' },
        {
          stage: 'Повтор',
          dose: '5 мг каждый час при сохранении возбуждения',
          duration: '≤20 мг/сут',
        },
        {
          stage: 'Перевод',
          dose: 'Переход на пероральную форму',
          note: 'Как только состояние стабилизируется',
        },
      ],
      maxDaily: '20 мг/сут (в/м)',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'haloperidol-oral',
      scenario: 'Поддерживающая антипсихотическая терапия',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '2–5 мг/сут' },
        {
          stage: 'Поддержка',
          dose: '2–10 мг/сут в 1–2 приёма',
          note: 'Высокий риск ЭПС выше 5–10 мг/сут',
        },
      ],
      maxDaily: '20 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'haloperidol-elderly',
      scenario: 'Пожилые пациенты / делирий',
      group: 'elderly',
      patientBadge: 'Пожилые',
      route: 'Внутрь / в/м',
      steps: [
        { stage: 'Старт', dose: '0,5–1 мг/сут' },
        {
          stage: 'Поддержка',
          dose: '0,5–5 мг/сут',
          note: 'Минимальная эффективная доза и короткий курс',
        },
      ],
      maxDaily: '5 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  сульпирид: [
    {
      id: 'sulpiride-low',
      scenario: 'Депрессивные / астено-апатические и соматоформные состояния',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · утром/днём',
      steps: [
        {
          stage: 'Старт',
          dose: '50–100 мг/сут',
          note: 'Принимать до 16:00 из-за активирующего действия',
        },
        { stage: 'Поддержка', dose: '50–200 мг/сут', duration: '4–8 нед' },
      ],
      maxDaily: '300 мг/сут (малые дозы)',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'sulpiride-psychosis',
      scenario: 'Острые и хронические психозы',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь / в/м',
      steps: [
        { stage: 'Негативная симптоматика', dose: '200–600 мг/сут' },
        {
          stage: 'Продуктивная симптоматика',
          dose: '600–1200 мг/сут',
          note: 'Контроль пролактина и функции почек',
        },
      ],
      maxDaily: '1200–1600 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  сертралин: [
    {
      id: 'sertraline-depression',
      scenario: 'Депрессия и ОКР',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '50 мг/сут', duration: '1–2 нед' },
        { stage: 'Титрация', dose: '+50 мг не чаще 1 р/нед', duration: 'до эффекта' },
        { stage: 'Поддержка', dose: '50–200 мг/сут', duration: '≥6 мес после ремиссии' },
        { stage: 'Отмена', dose: 'Плавное снижение', duration: '1–2+ нед' },
      ],
      maxDaily: '200 мг/сут',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'sertraline-panic',
      scenario: 'Паническое расстройство, ПТСР, социофобия',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · 1 р/сут',
      steps: [
        {
          stage: 'Старт',
          dose: '25 мг/сут',
          duration: '1 нед',
          note: 'Мягкий старт снижает начальную тревогу',
        },
        { stage: 'Переход', dose: '50 мг/сут', duration: '2–4 нед' },
        { stage: 'Поддержка', dose: '50–200 мг/сут', duration: '6–12 мес' },
      ],
      maxDaily: '200 мг/сут',
      courseLength: '6–12 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'sertraline-child-ocd',
      scenario: 'ОКР у детей и подростков',
      group: 'child',
      patientBadge: 'Дети 6–17 лет',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '25 мг (6–12 лет) · 50 мг (13–17 лет)' },
        { stage: 'Титрация', dose: '+50 мг/нед при необходимости' },
      ],
      maxDaily: '200 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  эсциталопрам: [
    {
      id: 'escitalopram-dep-gad',
      scenario: 'Депрессия, ГТР, ОКР, социофобия',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '10 мг/сут', duration: '2–4 нед' },
        { stage: 'Поддержка', dose: '10–20 мг/сут', duration: '≥6 мес после ремиссии' },
        { stage: 'Отмена', dose: 'Постепенное снижение', duration: '1–2 нед' },
      ],
      maxDaily: '20 мг/сут',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'escitalopram-panic',
      scenario: 'Паническое расстройство',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '5 мг/сут', duration: '1 нед' },
        { stage: 'Поддержка', dose: '10–20 мг/сут', duration: 'несколько мес' },
      ],
      maxDaily: '20 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'escitalopram-elderly',
      scenario: 'Пожилые (>65 лет) и нарушения функции печени',
      group: 'elderly',
      patientBadge: 'Пожилые >65 / печень',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '5 мг/сут', duration: '2 нед' },
        {
          stage: 'Поддержка',
          dose: 'до 10 мг/сут',
          note: 'Ограничение 10 мг из-за дозозависимого QTc',
        },
      ],
      maxDaily: '10 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  флуоксетин: [
    {
      id: 'fluoxetine-dep',
      scenario: 'Депрессия, ОКР, нервная булимия',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · утром',
      steps: [
        {
          stage: 'Старт',
          dose: '20 мг/сут утром',
          duration: '3–4 нед',
          note: 'Активирующий профиль — принимать в первой половине дня',
        },
        { stage: 'Титрация', dose: '20–60 мг/сут (булимия: 60 мг)', duration: '≥6 мес' },
      ],
      maxDaily: '60–80 мг/сут',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  миртазапин: [
    {
      id: 'mirtazapine-dep',
      scenario: 'Депрессивный эпизод (особенно с бессонницей и потерей веса)',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · на ночь',
      steps: [
        {
          stage: 'Старт',
          dose: '15 мг на ночь',
          duration: '4–7 дней',
          note: 'На 15 мг седация H1 максимальна',
        },
        { stage: 'Поддержка', dose: '30–45 мг/сут на ночь', duration: '4–6+ мес после ремиссии' },
        { stage: 'Отмена', dose: 'Постепенное снижение', duration: '1–2 нед' },
      ],
      maxDaily: '45 мг/сут',
      courseLength: '4–6+ мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  тразодон: [
    {
      id: 'trazodone-sleep',
      scenario: 'Инсомния и тревога',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · вечером',
      steps: [
        {
          stage: 'Старт',
          dose: '50–100 мг на ночь',
          note: 'После еды — меньше ортостатических пиков',
        },
      ],
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'trazodone-dep',
      scenario: 'Депрессивные расстройства',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '75–150 мг/сут вечером' },
        { stage: 'Титрация', dose: '+50 мг каждые 3–4 дня' },
        { stage: 'Поддержка', dose: '150–300 мг/сут (стационар до 600 мг)', duration: '≥4–6 мес' },
      ],
      maxDaily: '300 мг амбул. / 600 мг стац.',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'trazodone-elderly',
      scenario: 'Пожилые и ослабленные пациенты',
      group: 'elderly',
      patientBadge: 'Пожилые',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт',
          dose: '50–100 мг/сут вечером',
          note: 'Не превышать 100 мг на один приём',
        },
        { stage: 'Поддержка', dose: 'Обычно ≤300 мг/сут' },
      ],
      maxDaily: '300 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  гидроксизин: [
    {
      id: 'hydroxyzine-adult',
      scenario: 'Тревожные состояния у взрослых',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Стандарт',
          dose: '50 мг/сут (12,5 + 12,5 + 25 мг)',
          note: 'Большая доза — на ночь; кратчайший эффективный курс',
        },
        { stage: 'Выраженная тревога', dose: 'До 100 мг/сут', note: 'Контроль QTc и седации' },
      ],
      maxDaily: '100 мг/сут',
      sourceLabel: 'Инструкция ГРЛС (Атаракс®)',
    },
    {
      id: 'hydroxyzine-elderly',
      scenario: 'Пожилые пациенты',
      group: 'elderly',
      patientBadge: 'Пожилые',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт',
          dose: '50% от взрослой дозы',
          note: 'Повышенный антихолинергический и QTc риск',
        },
      ],
      maxDaily: '50 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'hydroxyzine-child',
      scenario: 'Симптоматическое лечение зуда',
      group: 'child',
      patientBadge: 'Дети с 3 лет',
      route: 'Внутрь',
      steps: [{ stage: 'Доза', dose: '1–2 мг/кг/сут в несколько приёмов' }],
      maxDaily: '2 мг/кг/сут (≤100 мг при массе >40 кг)',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  ламотриджин: [
    {
      id: 'lamotrigine-mono',
      scenario: 'Профилактика депрессивных эпизодов БАР (монотерапия)',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Нед. 1–2',
          dose: '25 мг 1 р/сут',
          duration: '14 дней',
          note: 'Строгая медленная титрация — профилактика ССД/ТЭН',
        },
        { stage: 'Нед. 3–4', dose: '50 мг/сут', duration: '14 дней' },
        { stage: 'Нед. 5', dose: '100 мг/сут', duration: '7 дней' },
        { stage: 'Поддержка', dose: '200 мг/сут (100–400 мг)', duration: 'длительно' },
      ],
      maxDaily: '400 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'lamotrigine-valproate',
      scenario: 'БАР в комбинации с вальпроатом',
      group: 'adult',
      patientBadge: 'Взрослые + вальпроат',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Нед. 1–2',
          dose: '25 мг через день',
          duration: '14 дней',
          note: 'Вальпроат вдвое замедляет клиренс ламотриджина',
        },
        { stage: 'Нед. 3–4', dose: '25 мг 1 р/сут', duration: '14 дней' },
        { stage: 'Нед. 5', dose: '50 мг/сут', duration: '7 дней' },
        { stage: 'Поддержка', dose: '100 мг/сут (макс. 200 мг)' },
      ],
      maxDaily: '200 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  'вальпроевая кислота': [
    {
      id: 'valproate-bipolar',
      scenario: 'Маниакальные эпизоды и профилактика БАР',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        {
          stage: 'Старт',
          dose: '750 мг/сут (или 20 мг/кг/сут)',
          note: 'Избегать у женщин репродуктивного возраста при наличии альтернатив',
        },
        {
          stage: 'Поддержка',
          dose: '1000–2000 мг/сут',
          note: 'Целевая концентрация в плазме: 50–125 мкг/мл',
        },
      ],
      maxDaily: '3000 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  палиперидон: [
    {
      id: 'paliperidone-oral',
      scenario: 'Шизофрения и шизоаффективное расстройство',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут утром',
      steps: [
        {
          stage: 'Старт / целевая',
          dose: '6 мг/сут утром',
          note: 'Начальная титрация не требуется; проглатывать целиком (OROS)',
        },
        {
          stage: 'Коррекция',
          dose: '3–12 мг/сут',
          duration: 'шаг ±3 мг каждые ≥5 дней',
        },
      ],
      maxDaily: '12 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'paliperidone-renal',
      scenario: 'Снижение функции почек (СКФ 50–80 / 10–50)',
      group: 'elderly',
      patientBadge: 'ХБП / пожилые',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'СКФ 50–80', dose: 'Старт 3 мг · макс. 6 мг/сут' },
        {
          stage: 'СКФ 10–50',
          dose: 'Старт 1,5 мг · макс. 3 мг/сут',
          note: 'При СКФ <10 не рекомендован',
        },
      ],
      maxDaily: '3–6 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  карипразин: [
    {
      id: 'cariprazine-schizo',
      scenario: 'Шизофрения (в т.ч. преобладание негативных симптомов)',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [
        { stage: 'Старт', dose: '1,5 мг/сут', duration: 'дни 1–2' },
        {
          stage: 'Титрация',
          dose: '+1,5 мг/сут',
          note: 'Медленное накопление активного метаболита DDCAR (t½ 1–3 нед)',
        },
        { stage: 'Поддержка', dose: '1,5–6 мг/сут', note: 'Контроль акатизии' },
      ],
      maxDaily: '6 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  луразидон: [
    {
      id: 'lurasidone-schizo',
      scenario: 'Шизофрения',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · с едой ≥350 ккал',
      steps: [
        {
          stage: 'Старт',
          dose: '40 мг 1 р/сут',
          note: 'Обязательно во время еды (≥350 ккал) — биодоступность выше в 2 раза',
        },
        { stage: 'Поддержка', dose: '40–160 мг/сут' },
      ],
      maxDaily: '160 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'lurasidone-bipolar-dep',
      scenario: 'Биполярная депрессия',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · с едой ≥350 ккал',
      steps: [
        { stage: 'Старт', dose: '20 мг 1 р/сут' },
        { stage: 'Поддержка', dose: '20–120 мг/сут' },
      ],
      maxDaily: '120 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  амисульприд: [
    {
      id: 'amisulpride-negative',
      scenario: 'Преимущественно негативная симптоматика',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [{ stage: 'Диапазон', dose: '50–300 мг/сут', note: 'Дозы ≤300 мг — в 1 приём' }],
      maxDaily: '300 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'amisulpride-acute',
      scenario: 'Острые психотические эпизоды',
      group: 'acute',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 2 р/сут (>400 мг)',
      steps: [
        { stage: 'Стандарт', dose: '400–800 мг/сут в 2 приёма' },
        {
          stage: 'Максимум',
          dose: 'До 1200 мг/сут',
          note: 'При ХБП (СКФ 30–60) — доза снижается вдвое',
        },
      ],
      maxDaily: '1200 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  хлорпромазин: [
    {
      id: 'chlorpromazine-oral',
      scenario: 'Психомоторное возбуждение и психозы',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '25–100 мг/сут', note: 'Риск выраженного ортостаза' },
        { stage: 'Поддержка', dose: '100–400 мг/сут в 2–3 приёма' },
      ],
      maxDaily: '1000 мг/сут (стационар)',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'chlorpromazine-im',
      scenario: 'Купирование острого возбуждения',
      group: 'acute',
      patientBadge: 'Взрослые',
      route: 'В/м',
      steps: [
        {
          stage: 'Введение',
          dose: '25–50 мг глубоко в/м',
          note: 'Покой лёжа ≥30–60 мин после инъекции (контроль АД)',
        },
      ],
      maxDaily: '600 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  хлорпротиксен: [
    {
      id: 'chlorprothixene-anxiety',
      scenario: 'Тревога, раздражительность, нарушения сна',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · вечером',
      steps: [
        { stage: 'Сон / седация', dose: '15–30 мг за 1 ч до сна' },
        {
          stage: 'Тревога / неврозы',
          dose: '15–100 мг/сут в 2–3 приёма',
          note: 'Основная часть — на ночь',
        },
      ],
      maxDaily: '100 мг/сут (неврозы)',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'chlorprothixene-psychosis',
      scenario: 'Психотические состояния и возбуждение',
      group: 'acute',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '50–100 мг/сут' },
        {
          stage: 'Поддержка',
          dose: '100–400 мг/сут',
          note: 'Контроль АД, QTc и М-холинолитических эффектов',
        },
      ],
      maxDaily: '600 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  зуклопентиксол: [
    {
      id: 'zuclopenthixol-oral',
      scenario: 'Острая и хроническая шизофрения',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '10–25 мг/сут' },
        { stage: 'Поддержка', dose: '20–50 мг/сут', note: 'Пожилые: 2–6 мг → до 20 мг/сут' },
      ],
      maxDaily: '150 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'zuclopenthixol-acuphase',
      scenario: 'Острый психоз / мания (Акуфаз в/м)',
      group: 'acute',
      patientBadge: 'Взрослые (18+)',
      route: 'В/м (ацетат)',
      steps: [
        { stage: 'Инъекция', dose: '50–150 мг в/м', duration: 'действие 2–3 дня' },
        {
          stage: 'Повтор',
          dose: 'При необходимости через 2–3 дня',
          duration: 'курс ≤2 нед, ≤4 инъекций',
        },
      ],
      maxDaily: '400 мг на курс',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  флупентиксол: [
    {
      id: 'flupentixol-low',
      scenario: 'Депрессивные и астено-апатические состояния',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · утром/днём',
      steps: [
        {
          stage: 'Старт',
          dose: '0,5–1 мг утром',
          note: 'Приём до 16:00 — выраженный активирующий эффект',
        },
        { stage: 'Поддержка', dose: '1–3 мг/сут', duration: 'оценка через 1 нед' },
      ],
      maxDaily: '3 мг/сут (малые дозы)',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'flupentixol-psychosis',
      scenario: 'Шизофрения и психозы',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '3–15 мг/сут в 2–3 приёма' },
        { stage: 'Поддержка', dose: '5–20 мг/сут' },
      ],
      maxDaily: '40 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  клозапин: [
    {
      id: 'clozapine-resistant',
      scenario: 'Резистентная шизофрения (строгий протокол ОАК)',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1–2 р/сут',
      steps: [
        {
          stage: 'Старт',
          dose: '12,5 мг 1–2 р/сут',
          duration: 'день 1',
          note: 'До начала — исходный ОАК (лейкоциты ≥3,5×10⁹/л, нейтрофилы ≥2,0×10⁹/л)',
        },
        {
          stage: 'Титрация',
          dose: '25–50 мг (день 2) → +25–50 мг/сут',
          duration: '2–3 нед до 300 мг',
          note: 'ОАК еженедельно первые 18 нед, далее 1 р/мес',
        },
        {
          stage: 'Поддержка',
          dose: '200–450 мг/сут',
          note: 'При перерыве >48 ч — повторная титрация с 12,5 мг',
        },
      ],
      maxDaily: '900 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  бипериден: [
    {
      id: 'biperiden-eps',
      scenario: 'Лекарственные ЭПС (акинезия, ригидность, тремор)',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '1–2 мг 1–2 р/сут' },
        {
          stage: 'Поддержка',
          dose: '2–6 мг/сут в 2–3 приёма',
          note: 'Пожилые: начинать с 1 мг/сут',
        },
      ],
      maxDaily: '16 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
    {
      id: 'biperiden-acute-dystonia',
      scenario: 'Острая дистония (неотложное купирование)',
      group: 'acute',
      patientBadge: 'Взрослые',
      route: 'В/м или медленно в/в',
      steps: [
        { stage: 'Введение', dose: '2,5–5 мг в/м или медленно в/в' },
        {
          stage: 'Повтор',
          dose: 'При необходимости через 30 мин',
          note: 'Эффект обычно через 10–20 мин',
        },
      ],
      maxDaily: '10–20 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  тригексифенидил: [
    {
      id: 'trihexyphenidyl-eps',
      scenario: 'Коррекция нейролептических ЭПС',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '1–2 мг/сут' },
        {
          stage: 'Поддержка',
          dose: '2–6 мг/сут (до 10–15 мг)',
          note: 'Учитывать антихолинергическую нагрузку и потенциал злоупотребления',
        },
      ],
      maxDaily: '16 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  пароксетин: [
    {
      id: 'paroxetine-dep-anx',
      scenario: 'Депрессия, ГТР, ПТСР, социофобия, ОКР',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут утром с едой',
      steps: [
        { stage: 'Старт', dose: '20 мг/сут (паническое: 10 мг)', duration: '1–2 нед' },
        { stage: 'Титрация', dose: '+10 мг/нед при необходимости' },
        { stage: 'Поддержка', dose: '20–50 мг/сут (ОКР до 60 мг)', duration: '≥6 мес' },
        {
          stage: 'Отмена',
          dose: 'Очень плавное снижение (-10 мг/нед)',
          duration: '2–4+ нед',
          note: 'Выраженный синдром отмены при резком прекращении',
        },
      ],
      maxDaily: '50–60 мг/сут (пожилые: 40 мг)',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  флувоксамин: [
    {
      id: 'fluvoxamine-dep-ocd',
      scenario: 'Депрессия и ОКР',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · вечером',
      steps: [
        { stage: 'Старт', dose: '50 мг 1 р/сут вечером', duration: '3–7 дней' },
        {
          stage: 'Поддержка',
          dose: '100–200 мг (ОКР до 300 мг/сут)',
          duration: '≥6 мес',
          note: 'Дозы >150 мг делить на 2–3 приёма',
        },
      ],
      maxDaily: '300 мг/сут',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'fluvoxamine-child-ocd',
      scenario: 'ОКР у детей и подростков',
      group: 'child',
      patientBadge: 'Дети с 8 лет',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '25 мг на ночь', duration: '4–7 дней' },
        {
          stage: 'Титрация',
          dose: '+25 мг каждые 4–7 дней',
          note: 'Макс. 200 мг/сут (>50 мг в 2 приёма)',
        },
      ],
      maxDaily: '200 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  венлафаксин: [
    {
      id: 'venlafaxine-dep-gad',
      scenario: 'Депрессия, ГТР, паническое расстройство',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · с едой',
      steps: [
        { stage: 'Старт', dose: '75 мг/сут (паническое: 37,5 мг)', duration: '1–2 нед' },
        {
          stage: 'Титрация',
          dose: '150–225 мг/сут',
          duration: 'шаг +75 мг ≥через 2 нед',
          note: 'Контроль АД выше 150 мг/сут',
        },
        { stage: 'Отмена', dose: 'Плавное снижение', duration: '≥2 нед' },
      ],
      maxDaily: '375 мг/сут (тяжёлая депрессия)',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  дулоксетин: [
    {
      id: 'duloxetine-dep-pain',
      scenario: 'Депрессия, ГТР, болевая нейропатия',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [
        {
          stage: 'Старт',
          dose: '30–60 мг/сут',
          duration: '1–2 нед',
          note: 'Старт с 30 мг снижает тошноту',
        },
        {
          stage: 'Поддержка',
          dose: '60 мг/сут (при необходимости до 120 мг)',
          duration: '≥6 мес',
        },
        { stage: 'Отмена', dose: 'Плавное снижение', duration: '≥1–2 нед' },
      ],
      maxDaily: '120 мг/сут',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  вортиоксетин: [
    {
      id: 'vortioxetine-dep',
      scenario: 'Большие депрессивные эпизоды',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 1 р/сут',
      steps: [
        {
          stage: 'Старт / стандарт',
          dose: '10 мг 1 р/сут',
          note: 'Пожилые (≥65 лет): старт 5 мг/сут',
        },
        { stage: 'Коррекция', dose: '5–20 мг/сут', duration: '≥6 мес после ремиссии' },
      ],
      maxDaily: '20 мг/сут',
      courseLength: '≥6 мес',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  амитриптилин: [
    {
      id: 'amitriptyline-pain',
      scenario: 'Нейропатическая боль и профилактика мигрени',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · вечером',
      steps: [
        { stage: 'Старт', dose: '10–25 мг на ночь' },
        { stage: 'Поддержка', dose: '25–75 мг/сут на ночь', note: 'ЭКГ-контроль QTc/QRS' },
      ],
      maxDaily: '75 мг/сут (боль/мигрень)',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
    {
      id: 'amitriptyline-dep',
      scenario: 'Депрессивные эпизоды',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '25–50 мг/сут вечером' },
        {
          stage: 'Титрация',
          dose: '75–150 мг/сут',
          note: 'Пожилые: 10–25 мг → обычно ≤50–75 мг/сут',
        },
      ],
      maxDaily: '150–300 мг/сут',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  кломипрамин: [
    {
      id: 'clomipramine-ocd-dep',
      scenario: 'ОКР, депрессия, панические и фобические расстройства',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '25 мг 1–2 р/сут (паника: 10 мг/сут)' },
        { stage: 'Титрация', dose: 'Постепенно до 100–150 мг/сут', duration: '1–2 нед' },
        {
          stage: 'Поддержка',
          dose: '75–250 мг/сут',
          note: 'Контроль ЭКГ и порога судорожной готовности (>250 мг риск судорог)',
        },
      ],
      maxDaily: '250 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  'лития карбонат': [
    {
      id: 'lithium-bipolar',
      scenario: 'Мания и профилактика фаз БАР (контроль Li⁺ в крови)',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · после еды',
      steps: [
        { stage: 'Старт', dose: '300–600 мг/сут', note: 'Исходно: креатинин/СКФ, ТТГ, Ca²⁺, ЭКГ' },
        {
          stage: 'Титрация по уровню',
          dose: '600–1200 мг/сут',
          duration: 'анализ Li⁺ через 5–7 дней (через 12 ч после приёма)',
          note: 'Целевой уровень: 0,6–0,8 ммоль/л (профилактика) · 0,8–1,2 (острая мания)',
        },
        {
          stage: 'Наблюдение',
          dose: 'Li⁺, СКФ, ТТГ каждые 3–6 мес',
          note: 'Осторожность с НПВС, иАПФ, тиазидами',
        },
      ],
      maxDaily: '2400 мг/сут (по концентрации Li⁺)',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  карбамазепин: [
    {
      id: 'carbamazepine-bipolar',
      scenario: 'Мания и профилактика БАР / невралгия тройничного нерва',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь · во время еды',
      steps: [
        { stage: 'Старт', dose: '200–400 мг/сут в 2 приёма' },
        {
          stage: 'Поддержка',
          dose: '400–1200 мг/сут',
          note: 'Мощный индуктор CYP3A4; контроль ОАК, Na⁺, АЛТ/АСТ',
        },
      ],
      maxDaily: '1600 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  буспирон: [
    {
      id: 'buspirone-gad',
      scenario: 'Генерализованное тревожное расстройство',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · 2–3 р/сут',
      steps: [
        { stage: 'Старт', dose: '15 мг/сут (5 мг × 3 р/сут)' },
        {
          stage: 'Титрация',
          dose: '+5 мг каждые 2–3 дня → 20–30 мг/сут',
          duration: 'эффект через 2–4 нед',
          note: 'Не вызывает зависимости и седации; не купирует панику мгновенно',
        },
      ],
      maxDaily: '60 мг/сут',
      sourceLabel: 'Инструкция ГРЛС · КР',
    },
  ],

  диазепам: [
    {
      id: 'diazepam-short',
      scenario: 'Острая тревога, возбуждение, алкогольная абстиненция',
      group: 'acute',
      patientBadge: 'Взрослые',
      route: 'Внутрь / в/м / в/в',
      steps: [
        { stage: 'Тревога внутрь', dose: '2–10 мг 2–4 р/сут', duration: 'короткий курс ≤2–4 нед' },
        {
          stage: 'Абстиненция / острые',
          dose: '10 мг в/м или медленно в/в',
          note: 'Пожилые: старт 2–2,5 мг 1–2 р/сут',
        },
        { stage: 'Отмена', dose: 'Плавное снижение', note: 'Риск зависимости и синдрома отмены' },
      ],
      maxDaily: '40 мг/сут (внутрь)',
      courseLength: '≤2–4 нед',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  лоразепам: [
    {
      id: 'lorazepam-short',
      scenario: 'Острая тревога, кататония, премедикация',
      group: 'acute',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        { stage: 'Стандарт', dose: '1–4 мг/сут в 2–3 приёма', duration: 'короткий курс ≤2–4 нед' },
        {
          stage: 'Пожилые / печень',
          dose: '0,5–2 мг/сут',
          note: 'Глюкуронируется без CYP — предпочтителен при болезнях печени',
        },
      ],
      maxDaily: '10 мг/сут (стационар)',
      courseLength: '≤2–4 нед',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  алпразолам: [
    {
      id: 'alprazolam-short',
      scenario: 'Тревожные и панические состояния (краткосрочно)',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '0,25–0,5 мг 2–3 р/сут', note: 'Пожилые: 0,25 мг 2–3 р/сут' },
        { stage: 'Поддержка', dose: '0,5–3 мг/сут', duration: 'короткий курс ≤2–4 нед' },
        { stage: 'Отмена', dose: 'Снижать не быстрее 0,5 мг каждые 3 дня' },
      ],
      maxDaily: '4 мг/сут (паника до 6 мг)',
      courseLength: '≤2–4 нед',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  бромдигидрохлорфенилбензодиазепин: [
    {
      id: 'phenazepam-short',
      scenario: 'Острая тревога, страх, нарушения сна, абстиненция',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь',
      steps: [
        { stage: 'Сон', dose: '0,25–0,5 мг за 20–30 мин до сна' },
        {
          stage: 'Тревога',
          dose: '0,5–1 мг 2–3 р/сут',
          duration: '≤2 нед (макс. до 2 мес с отменой)',
        },
        { stage: 'Отмена', dose: 'Постепенное снижение дозы' },
      ],
      maxDaily: '10 мг/сут (стационар · амбул. ≤3–5 мг)',
      courseLength: '≤2 нед',
      sourceLabel: 'Инструкция ГРЛС (Феназепам®)',
    },
  ],

  клоназепам: [
    {
      id: 'clonazepam-adult',
      scenario: 'Эпилепсия / панические расстройства (краткосрочно)',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'Внутрь',
      steps: [
        { stage: 'Старт', dose: '0,25–0,5 мг 2 р/сут' },
        {
          stage: 'Поддержка',
          dose: '1–4 мг/сут',
          note: 'Плавная отмена из-за риска судорог отмены',
        },
      ],
      maxDaily: '20 мг/сут (эпилепсия) · 4 мг (паника)',
      sourceLabel: 'Инструкция ГРЛС',
    },
  ],

  тофизопам: [
    {
      id: 'tofisopam-day',
      scenario: 'Дневной анксиолитик при неврозах и вегетативных расстройствах',
      group: 'adult',
      patientBadge: 'Взрослые (18+)',
      route: 'Внутрь · утром и днём',
      steps: [
        {
          stage: 'Стандарт',
          dose: '50–100 мг 1–3 р/сут',
          duration: '2–12 нед',
          note: 'Последний приём не позднее 15–16 ч (возможна лёгкая активация/бессонница)',
        },
      ],
      maxDaily: '300 мг/сут',
      courseLength: '2–12 нед',
      sourceLabel: 'Инструкция ГРЛС (Грандаксин®)',
    },
  ],
};

export function lookupPsychotropicRegimenSchemas(
  inns: readonly string[],
): readonly DrugRegimenBranch[] | undefined {
  for (const inn of inns) {
    const found = REGIMEN_SCHEMAS_BY_INN[normalizeInnLookupKey(inn)];
    if (found) return found;
  }
  return undefined;
}
