import {
  type DrugFactSourceRef,
  type DrugPharmacologyProfile,
  normalizeInnLookupKey,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';

/**
 * Cited psychopharmacology reference profiles (Wave 3.1): pharmacokinetics (`t½`, CYP, Tmax) and
 * receptor binding profiles with anatomical pathways and clinical effects.
 *
 * Per `docs/REFERENCE_SOURCE_POLICY.md`, every entry retains explicit published reference
 * attribution and supplements — never replaces — the official GRLS/ESKLP instruction text.
 */

const SOURCE_STAHL: DrugFactSourceRef = {
  title:
    "Stahl's Essential Psychopharmacology: Neuroscientific Basis and Practical Applications (5th ed.)",
  publisher: 'Cambridge University Press',
  year: 2021,
};

const SOURCE_IUPHAR: DrugFactSourceRef = {
  title: 'IUPHAR/BPS Guide to PHARMACOLOGY & NIMH PDSP Ki Database',
  publisher: 'IUPHAR / NIMH',
  year: 2024,
};

const SOURCE_MAUDSLEY: DrugFactSourceRef = {
  title: 'The Maudsley Prescribing Guidelines in Psychiatry (14th ed.)',
  publisher: 'Wiley-Blackwell',
  year: 2021,
};

export const PSYCHOTROPIC_PHARMACOLOGY_PROFILES: readonly DrugPharmacologyProfile[] = [
  {
    inns: ['рисперидон', 'risperidone'],
    classLabel: 'Атипичный антипсихотик (SDA)',
    pk: {
      halfLife: '~3 ч (активный метаболит палиперидон ~20–24 ч)',
      tmax: '1–2 ч',
      metabolism: 'CYP2D6 → 9-гидроксирисперидон (палиперидон)',
      steadyState: '4–5 дней',
      activeMetabolites: '9-гидроксирисперидон (палиперидон)',
    },
    receptors: [
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~0.2–0.5 нМ',
        pathway: 'Префронтальная кора, нигростриарная система',
        clinicalEffect:
          'Модуляция дофамина в стриатуме, снижение риска ЭПС при низких/средних дозах',
      },
      {
        receptor: 'D2L',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~3–5 нМ',
        pathway: 'Мезолимбический, нигростриарный и тубероинфундибулярный пути',
        clinicalEffect: 'Антипсихотический эффект; дозозависимые ЭПС и гиперпролактинемия',
      },
      {
        receptor: 'α1',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~2–5 нМ',
        pathway: 'Сосудистая стенка и центральные норадренергические проекции',
        clinicalEffect: 'Ортостатическая гипотензия, рефлекторная тахикардия, головокружение',
      },
      {
        receptor: 'α2',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~3–8 нМ',
        pathway: 'Пресинаптические терминалы (голубое пятно, кора)',
        clinicalEffect: 'Усиление высвобождения норадреналина и серотонина',
      },
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'moderate',
        kiNm: '~15–20 нМ',
        pathway: 'Гипоталамус (туберомамиллярное ядро)',
        clinicalEffect: 'Умеренная седация и прибавка массы тела',
      },
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'low',
        kiNm: '>1000 нМ',
        pathway: 'Кортикальные и периферические холинергические пути',
        clinicalEffect: 'Минимальный антихолинергический эффект',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['кветиапин', 'quetiapine'],
    classLabel: 'Атипичный антипсихотик (MARTA)',
    pk: {
      halfLife: '~6–7 ч (норкветиапин ~12 ч)',
      tmax: '1.5 ч (XR ~6 ч)',
      metabolism: 'CYP3A4 → норкветиапин (активный метаболит)',
      steadyState: '2 дня',
      activeMetabolites: 'Норкветиапин (ингибитор NET, частичный агонист 5-HT1A)',
    },
    receptors: [
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~7–11 нМ',
        pathway: 'Гипоталамус (туберомамиллярное ядро)',
        clinicalEffect: 'Выраженная седация уже на низких дозах (25–100 мг), прибавка массы тела',
      },
      {
        receptor: 'α1',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~22 нМ',
        pathway: 'Сосудистые и центральные α1-адренорецепторы',
        clinicalEffect: 'Ортостатическая гипотензия и сонливость при титрации',
      },
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'moderate',
        kiNm: '~100–300 нМ',
        pathway: 'Кора и лимбическая система',
        clinicalEffect: 'Атипичный профиль антипсихотического и антидепрессивного действия',
      },
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'moderate',
        kiNm: '~120 нМ (норкветиапин ~38 нМ)',
        pathway: 'ЦНС и парасимпатическая система',
        clinicalEffect: 'Сухость во рту, запор, лёгкая тахикардия',
      },
      {
        receptor: 'D2L',
        action: 'Антагонист (быстрая диссоциация)',
        affinity: 'low',
        kiNm: '~300–700 нМ',
        pathway: 'Мезолимбический путь (высокие дозы 400–800 мг)',
        clinicalEffect:
          'Антипсихотический эффект на высоких дозах; минимальный риск ЭПС и гиперпролактинемии',
      },
      {
        receptor: 'NET',
        action: 'Ингибитор обратного захвата (норкветиапин)',
        affinity: 'high',
        kiNm: '~35 нМ (норкветиапин)',
        pathway: 'Префронтальная кора, лимбические структуры',
        clinicalEffect: 'Вклад в антидепрессивный эффект (биполярная депрессия, ГТР)',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['оланзапин', 'olanzapine'],
    classLabel: 'Атипичный антипсихотик (MARTA)',
    pk: {
      halfLife: '~30–38 ч (у курящих короче)',
      tmax: '5–8 ч',
      metabolism: 'UGT1A4, CYP1A2 (индуцируется табачным дымом), минорно CYP2D6',
      steadyState: '~7 дней',
    },
    receptors: [
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~2–7 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Сильная седация и высокий риск прибавки массы тела',
      },
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~4 нМ',
        pathway: 'Кора и стриатум',
        clinicalEffect: 'Низкий риск ЭПС, антипсихотический и антиманиакальный эффект',
      },
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~2–25 нМ',
        pathway: 'ЦНС и периферические холинорецепторы',
        clinicalEffect: 'Сухость во рту, запор, метаболические нарушения (в т.ч. через M3)',
      },
      {
        receptor: '5-HT2C',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~11 нМ',
        pathway: 'Гипоталамус и префронтальная кора',
        clinicalEffect: 'Усиление аппетита, метаболический риск (совместно с H1)',
      },
      {
        receptor: 'D2L',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~17–31 нМ',
        pathway: 'Мезолимбический путь',
        clinicalEffect: 'Выраженный антипсихотический эффект',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['арипипразол', 'aripiprazole'],
    classLabel: 'Атипичный антипсихотик (частичный агонист D2/D3)',
    pk: {
      halfLife: '~75 ч (дегидроарипипразол ~94 ч)',
      tmax: '3–5 ч',
      metabolism: 'CYP2D6, CYP3A4',
      steadyState: '~14 дней',
      activeMetabolites: 'Дегидроарипипразол',
    },
    receptors: [
      {
        receptor: 'D2L',
        action: 'Частичный агонист',
        affinity: 'very-high',
        kiNm: '~0.3–1 нМ',
        pathway: 'Мезолимбический, мезокортикальный и тубероинфундибулярный пути',
        clinicalEffect:
          'Стабилизация дофамина: антипсихотический эффект, снижение пролактина, возможна акатизия',
      },
      {
        receptor: '5-HT1A',
        action: 'Частичный агонист',
        affinity: 'very-high',
        kiNm: '~1.7–5 нМ',
        pathway: 'Ядра шва, префронтальная кора, гиппокамп',
        clinicalEffect: 'Анксиолитический и антидепрессивный вклад',
      },
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~3.4–8 нМ',
        pathway: 'Кора и стриатум',
        clinicalEffect: 'Снижение риска паркинсонизма',
      },
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'moderate',
        kiNm: '~25–60 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Низкий седативный и метаболический потенциал',
      },
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'low',
        kiNm: '>1000 нМ',
        pathway: 'Холинергическая система',
        clinicalEffect: 'Практически без антихолинергических эффектов',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['галоперидол', 'haloperidol'],
    classLabel: 'Типичный антипсихотик (бутирофенон)',
    pk: {
      halfLife: '~14–26 ч (внутрь); деканоат ~3 нед',
      tmax: '2–6 ч (внутрь), ~20 мин (в/м)',
      metabolism: 'CYP3A4, CYP2D6, UGT',
      steadyState: '4–6 дней',
    },
    receptors: [
      {
        receptor: 'D2L',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~1–2 нМ',
        pathway: 'Мезолимбический, нигростриарный, тубероинфундибулярный пути',
        clinicalEffect:
          'Сильное купирование психоза; высокий риск острых ЭПС, акатизии и гиперпролактинемии',
      },
      {
        receptor: 'α1',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~12 нМ',
        pathway: 'Сосудистые и центральные α1-рецепторы',
        clinicalEffect: 'Умеренная ортостатическая гипотензия',
      },
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'moderate',
        kiNm: '~50–120 нМ',
        pathway: 'Кора',
        clinicalEffect: 'Относительно слабая серотонинергическая буферизация ЭПС',
      },
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'low',
        kiNm: '>500 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Слабая прямая гистаминергическая седация',
      },
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'low',
        kiNm: '>1000 нМ',
        pathway: 'Холинергические пути',
        clinicalEffect: 'Низкий антихолинергический эффект → частая потребность в корректорах ЭПС',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['клозапин', 'clozapine'],
    classLabel: 'Атипичный антипсихотик (резерв при резистентности)',
    pk: {
      halfLife: '~12 ч (диапазон 8–16 ч)',
      tmax: '1.5–2.5 ч',
      metabolism: 'CYP1A2 (основной; табачный дым ускоряет клиренс), CYP3A4, CYP2C19',
      steadyState: '3–5 дней',
      activeMetabolites: 'Норклозапин (N-десметилклозапин)',
    },
    receptors: [
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~1–3 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Выраженная седация и прибавка массы тела',
      },
      {
        receptor: 'M1',
        action: 'Антагонист (M4 — частичный агонист)',
        affinity: 'very-high',
        kiNm: '~2–10 нМ',
        pathway: 'ЦНС, ЖКТ, слюнные железы',
        clinicalEffect: 'Запор (риск кишечной непроходимости), тахикардия; сиалорея за счёт M4',
      },
      {
        receptor: 'α1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~2–7 нМ',
        pathway: 'Сосудистая стенка и ЦНС',
        clinicalEffect: 'Выраженная ортостатическая гипотензия → обязательна медленная титрация',
      },
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~5–10 нМ',
        pathway: 'Кора и стриатум',
        clinicalEffect: 'Антипсихотический и антисуицидальный профиль при резистентной шизофрении',
      },
      {
        receptor: 'D2L',
        action: 'Антагонист (быстрая диссоциация)',
        affinity: 'low',
        kiNm: '~120–210 нМ',
        pathway: 'Мезолимбический путь',
        clinicalEffect: 'Практически без ЭПС и гиперпролактинемии',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['бипериден', 'biperiden'],
    classLabel: 'Центральный антихолинергик (корректор ЭПС)',
    pk: {
      halfLife: '~18–24 ч',
      tmax: '1–1.5 ч',
      metabolism: 'Печёночное гидроксилирование',
      steadyState: '4–5 дней',
    },
    receptors: [
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~0.5–1.5 нМ',
        pathway: 'Стриатум (холинергические интернейроны), кора, гиппокамп',
        clinicalEffect:
          'Купирование лекарственного паркинсонизма и острой дистонии; риск когнитивного снижения и сухости во рту',
      },
      {
        receptor: 'M3',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~3–6 нМ',
        pathway: 'Гладкая мускулатура, экзокринные железы, аккомодация',
        clinicalEffect:
          'Мидриаз, нарушение аккомодации, задержка мочи, запор (осторожно при глаукоме и ДГПЖ)',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL],
  },
  {
    inns: ['сертралин', 'sertraline'],
    classLabel: 'Антидепрессант (СИОЗС)',
    pk: {
      halfLife: '~26 ч (N-десметилсертралин ~62–104 ч)',
      tmax: '4.5–8.5 ч',
      metabolism: 'CYP2B6, CYP2C19, CYP2C9, CYP3A4 (слабый ингибитор CYP2D6)',
      steadyState: '~7 дней',
    },
    receptors: [
      {
        receptor: 'SERT',
        action: 'Ингибитор обратного захвата',
        affinity: 'very-high',
        kiNm: '~0.3 нМ',
        pathway: 'Ядра шва → лимбическая система и префронтальная кора',
        clinicalEffect: 'Основной антидепрессивный, противотревожный и антиобсессивный эффект',
      },
      {
        receptor: 'DAT',
        action: 'Слабый ингибитор обратного захвата',
        affinity: 'moderate',
        kiNm: '~25 нМ',
        pathway: 'Стриатум и префронтальная кора',
        clinicalEffect: 'Лёгкий активирующий профиль (энергия, мотивация)',
      },
      {
        receptor: 'σ1',
        action: 'Антагонист / модулятор',
        affinity: 'moderate',
        kiNm: '~57 нМ',
        pathway: 'Лимбические и корковые структуры',
        clinicalEffect: 'Предполагаемый вклад в анксиолитический эффект',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['эсциталопрам', 'escitalopram'],
    classLabel: 'Антидепрессант (высокоселективный СИОЗС)',
    pk: {
      halfLife: '~27–32 ч',
      tmax: '3–4 ч',
      metabolism: 'CYP2C19, CYP3A4, CYP2D6 (минимальные CYP-взаимодействия)',
      steadyState: '~7–10 дней',
    },
    receptors: [
      {
        receptor: 'SERT',
        action: 'Ингибитор обратного захвата (орто- и аллостерический)',
        affinity: 'very-high',
        kiNm: '~1.1 нМ',
        pathway: 'Серотонинергические проекции ядер шва',
        clinicalEffect:
          'Высокоселективное антидепрессивное и анксиолитическое действие; хорошая переносимость',
      },
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'low',
        kiNm: '>1000 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Отсутствие выраженной гистаминергической седации',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['флуоксетин', 'fluoxetine'],
    classLabel: 'Антидепрессант (СИОЗС)',
    pk: {
      halfLife: '~1–4 дня (норфлуоксетин ~7–15 дней!)',
      tmax: '6–8 ч',
      metabolism: 'CYP2D6, CYP2C9 (сильный ингибитор CYP2D6)',
      steadyState: '4–5 недель',
      activeMetabolites: 'Норфлуоксетин (очень длительный вымывной период)',
    },
    receptors: [
      {
        receptor: 'SERT',
        action: 'Ингибитор обратного захвата',
        affinity: 'very-high',
        kiNm: '~0.8–1 нМ',
        pathway: 'Серотонинергические пути ЦНС',
        clinicalEffect:
          'Антидепрессивный и антиобсессивный эффект; минимальный синдром отмены благодаря норфлуоксетину',
      },
      {
        receptor: '5-HT2C',
        action: 'Антагонист',
        affinity: 'moderate',
        kiNm: '~70–100 нМ',
        pathway: 'Префронтальная кора',
        clinicalEffect: 'Растормаживание дофамина и норадреналина → активирующий эффект',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['венлафаксин', 'venlafaxine'],
    classLabel: 'Антидепрессант (СИОЗСН)',
    pk: {
      halfLife: '~5 ч (O-десметилвенлафаксин ~11 ч)',
      tmax: '2 ч (XR ~5.5 ч)',
      metabolism: 'CYP2D6 → O-десметилвенлафаксин (десвенлафаксин)',
      steadyState: '3 дня',
      activeMetabolites: 'O-десметилвенлафаксин',
    },
    receptors: [
      {
        receptor: 'SERT',
        action: 'Ингибитор обратного захвата',
        affinity: 'high',
        kiNm: '~9–82 нМ',
        pathway: 'Серотонинергические пути (начиная с 75 мг/сут)',
        clinicalEffect:
          'Антидепрессивный и противотревожный эффект на любых дозах; короткий t½ → риск синдрома отмены',
      },
      {
        receptor: 'NET',
        action: 'Ингибитор обратного захвата',
        affinity: 'moderate',
        kiNm: '~250–1000 нМ (клинически значим с ≥150 мг/сут)',
        pathway: 'Норадренергические проекции (кора, спинной мозг)',
        clinicalEffect:
          'Энергия, внимание, обезболивание при нейропатической боли; дозозависимый рост АД',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['миртазапин', 'mirtazapine'],
    classLabel: 'Антидепрессант (NaSSA)',
    pk: {
      halfLife: '~20–40 ч',
      tmax: '2 ч',
      metabolism: 'CYP2D6, CYP1A2, CYP3A4',
      steadyState: '4–5 дней',
    },
    receptors: [
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~0.14 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Сильная седация и повышение аппетита (максимально выражены на 7.5–15 мг)',
      },
      {
        receptor: 'α2',
        action: 'Антагонист (ауто- и гетерорецепторы)',
        affinity: 'high',
        kiNm: '~20–80 нМ',
        pathway: 'Голубое пятно и ядра шва',
        clinicalEffect: 'Усиление высвобождения норадреналина и серотонина (дозы 30–45 мг)',
      },
      {
        receptor: '5-HT2A',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~16–69 нМ',
        pathway: 'Кора и спинной мозг',
        clinicalEffect: 'Улучшение сна, минимальный риск сексуальной дисфункции',
      },
      {
        receptor: '5-HT3',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~8–12 нМ',
        pathway: 'Триггерная зона рвотного центра и ЖКТ',
        clinicalEffect: 'Противорвотный эффект, низкий риск тошноты',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['амитриптилин', 'amitriptyline'],
    classLabel: 'Трициклический антидепрессант (ТЦА)',
    pk: {
      halfLife: '~10–28 ч (нортриптилин ~18–44 ч)',
      tmax: '2–6 ч',
      metabolism: 'CYP2C19 → нортриптилин, CYP2D6 → гидроксиметаболиты',
      steadyState: '4–7 дней',
      activeMetabolites: 'Нортриптилин',
    },
    receptors: [
      {
        receptor: 'H1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~1 нМ',
        pathway: 'Гипоталамус',
        clinicalEffect: 'Выраженная седация и прибавка массы тела',
      },
      {
        receptor: 'SERT',
        action: 'Ингибитор обратного захвата',
        affinity: 'very-high',
        kiNm: '~4 нМ',
        pathway: 'Серотонинергические пути ЦНС и нисходящие болевые пути',
        clinicalEffect: 'Антидепрессивный и анальгетический эффект (мигрень, нейропатическая боль)',
      },
      {
        receptor: 'M1',
        action: 'Антагонист',
        affinity: 'very-high',
        kiNm: '~10–15 нМ',
        pathway: 'ЦНС и периферические холинорецепторы',
        clinicalEffect: 'Сухость во рту, запор, задержка мочи, спутанность у пожилых',
      },
      {
        receptor: 'NET',
        action: 'Ингибитор обратного захвата',
        affinity: 'high',
        kiNm: '~20–35 нМ',
        pathway: 'Норадренергические проекции',
        clinicalEffect: 'Антидепрессивный и антиноцицептивный эффект',
      },
      {
        receptor: 'α1',
        action: 'Антагонист',
        affinity: 'high',
        kiNm: '~24 нМ',
        pathway: 'Сосуды и ЦНС',
        clinicalEffect: 'Ортостатическая гипотензия и риск падений',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['ламотриджин', 'lamotrigine'],
    classLabel: 'Нормотимик / противоэпилептическое средство',
    pk: {
      halfLife: '~25–33 ч (с вальпроатом ~60–70 ч; с карбамазепином ~13–14 ч)',
      tmax: '1–3 ч',
      metabolism:
        'UGT1A4 (глюкуронирование; ингибируется вальпроатом, индуцируется карбамазепином/эстрогенами)',
      steadyState: '5–7 дней',
    },
    receptors: [
      {
        receptor: 'Nav (вольтаж-зависимые Na+-каналы)',
        action: 'Блокатор каналов (стабилизация инактивированного состояния)',
        affinity: 'high',
        pathway: 'Глутаматергические нейроны коры и лимбической системы',
        clinicalEffect:
          'Снижение избыточного выброса глутамата; профилактика депрессивных фаз при БАР и судорог',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['лития карбонат', 'литий', 'lithium', 'lithium carbonate'],
    classLabel: 'Нормотимик',
    pk: {
      halfLife: '~18–24 ч (у пожилых до 36 ч)',
      tmax: '1–2 ч (пролонгированные ~4 ч)',
      metabolism: 'Не метаболизируется; выводится почками (реабсорбция конкурирует с Na+)',
      steadyState: '5–7 дней (контроль концентрации в сыворотке через 12 ч после вечерней дозы)',
    },
    receptors: [
      {
        receptor: 'GSK-3β / IMPase',
        action: 'Ингибитор внутриклеточных сигнальных каскадов',
        affinity: 'high',
        pathway: 'Лимбическая система, префронтальная кора, гиппокамп',
        clinicalEffect:
          'Нормотимический, нейропротективный и доказанный антисуицидальный эффект при БАР',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL, SOURCE_MAUDSLEY],
  },
  {
    inns: ['диазепам', 'diazepam'],
    classLabel: 'Бензодиазепин (длительного действия)',
    pk: {
      halfLife: '~20–50 ч (десметилдиазепам ~36–100 ч)',
      tmax: '0.5–1.5 ч',
      metabolism: 'CYP2C19, CYP3A4 → десметилдиазепам, темазепам, оксазепам',
      steadyState: '1–2 недели (кумуляция при повторном приёме)',
      activeMetabolites: 'Десметилдиазепам (нордиазепам), оксазепам',
    },
    receptors: [
      {
        receptor: 'GABA-A (α1, α2, α3, α5)',
        action: 'Положительный аллостерический модулятор',
        affinity: 'very-high',
        kiNm: '~5–15 нМ',
        pathway:
          'Амигдала (α2/α3 — анксиолизис), кора (α1 — седация/противосудорожное), спинной мозг (миорелаксация)',
        clinicalEffect:
          'Быстрое купирование тревоги, судорог и алкогольной абстиненции; риск седации, зависимости и кумуляции',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL],
  },
  {
    inns: ['лоразепам', 'lorazepam'],
    classLabel: 'Бензодиазепин (средней длительности, без активных метаболитов)',
    pk: {
      halfLife: '~10–20 ч',
      tmax: '2 ч',
      metabolism: 'Прямое глюкуронирование (UGT) — без CYP и без активных метаболитов',
      steadyState: '2–3 дня',
    },
    receptors: [
      {
        receptor: 'GABA-A (α1, α2, α3)',
        action: 'Положительный аллостерический модулятор',
        affinity: 'very-high',
        kiNm: '~1–3 нМ',
        pathway: 'Лимбическая система, кора, базальные ганглии',
        clinicalEffect:
          'Анксиолитический, противосудорожный, антикататонический эффект; предпочтителен при патологии печени',
      },
    ],
    sources: [SOURCE_IUPHAR, SOURCE_STAHL],
  },
];

const BY_INN: ReadonlyMap<string, DrugPharmacologyProfile> = (() => {
  const index = new Map<string, DrugPharmacologyProfile>();
  for (const profile of PSYCHOTROPIC_PHARMACOLOGY_PROFILES) {
    for (const inn of profile.inns) {
      index.set(normalizeInnLookupKey(inn), profile);
    }
  }
  return index;
})();

/** Looks up a pharmacology profile by Russian/Latin INN (exact or first component before «+»). */
export function lookupDrugPharmacology(
  inn: string | null | undefined,
): DrugPharmacologyProfile | null {
  if (!inn) return null;
  const key = normalizeInnLookupKey(inn);
  if (!key) return null;
  const exact = BY_INN.get(key);
  if (exact) return exact;
  // Some registry titles append salt forms («рисперидон», «биперидена гидрохлорид», «лития карбонат»).
  const firstWord = key.split(/\s+/u)[0] ?? '';
  if (firstWord && firstWord.length >= 4) {
    const byFirstWord = BY_INN.get(firstWord);
    if (byFirstWord) return byFirstWord;
  }
  return null;
}
