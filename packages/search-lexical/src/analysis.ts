import type {
  ClinicalContextFact,
  ClinicalContextFactKind,
  LegacyQueryFactKind,
  QueryAnalysis,
  QueryBranch,
  QueryBranchKind,
  QueryCalculation,
  QueryClinicalContext,
  QueryFact,
  QueryFactKind,
  QueryFactPolarity,
  QueryIntent,
  QueryMedicationCandidate,
  SearchSuggestion,
  SearchSuggestionField,
  TextRange,
} from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';

import { expandAliases, findNormalizedPhraseIndex } from './aliases';
import { classifyMedicalQueryIntent } from './intent';
import { lightStemRussian, normalizeSurfaceText, searchSubjectText, tokenize } from './normalize';
import symptomExpressions from './symptom-expressions.ru.json';

export interface LexicalQueryBranchPlan extends QueryBranch {
  readonly ftsQuery: string;
}

export interface ClinicalQueryPlan {
  readonly analysis: QueryAnalysis;
  readonly branches: readonly LexicalQueryBranchPlan[];
  readonly aliasMatches: readonly string[];
  readonly terms: readonly string[];
  readonly ftsQuery: string;
}

const MAX_FTS_TERMS = 34;
const MAX_BRANCHES = 8;

const MEDICATION_DOSE_QUERY_PATTERNS: readonly RegExp[] = [
  /(?:^|[^а-яa-z])доз(?:а|у|ы|е|ой|ою|ами|ам|ах)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])дозиров[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:рассчит|расчет|вычисл|посчит)[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])сколько\s+(?:дать|принять|принимать|выпить|таблетк[а-яa-z]*|мг|мл)(?=$|[^а-яa-z])/u,
  /(?:^|[^0-9а-яa-z])\d+(?:[.,]\d+)?\s*(?:мг|мкг|г)\s*(?:\/\s*(?:кг|доз[а-яa-z]*|сут[а-яa-z]*|день)|на\s+(?:кг|сут[а-яa-z]*|день))(?=$|[^а-яa-z])/u,
];

const MEDICATION_DOSE_EXCLUSION_PATTERNS: readonly RegExp[] = [
  /(?:^|[^а-яa-z])(?:передоз[а-яa-z]*|отрав[а-яa-z]*|интоксикац[а-яa-z]*|токсич[а-яa-z]*)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])дозированн[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:уже\s+)?прин(?:ял|яла|яли|ят[а-яa-z]*)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:уже\s+)?приним(?:ал|ала|али|ает|ают|аю|аешь|аете)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:уже\s+)?вып(?:ил|ила|или|ито|ита|иты)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:уже\s+)?дал(?:а|и)?(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:уже\s+)?получ(?:ил|ила|или|ен|ена|ено|ены)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:лишн[а-яa-z]*|слишком\s+много)\s+доз[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])после\s+прием[а-яa-z]*(?=$|[^а-яa-z])/u,
];

const MEDICATION_INFORMATIONAL_QUERY_PATTERNS: readonly RegExp[] = [
  /(?:^|[^а-яa-z])инструкц[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])противопоказ[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])побочн[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])взаимодейств[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])совместим[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])аналоги?(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])состав(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])показани[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])можно\s+ли(?=$|[^а-яa-z])/u,
];

const INFUSION_VOLUME_QUERY_PATTERNS: readonly RegExp[] = [
  /(?:^|[^а-яa-z])объем\s+(?:жидкост[а-яa-z]*|инфузи[а-яa-z]*)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])рас(?:с)?чет\s+объем[а-яa-z]*\s+инфузи[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])сколько\s+раствор[а-яa-z]*\s+внутривенно(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])инфузионн[а-яa-z]*\s+терапи[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])в\s*\/\s*в\s+объем(?=$|[^а-яa-z])/u,
];

const INFUSION_VOLUME_EXCLUSION_PATTERNS: readonly RegExp[] = [
  /(?:^|[^а-яa-z])(?:уже\s+)?введен[а-яa-z]*(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])(?:уже\s+)?получ(?:ил|ила|или|ен|ена|ено|ены)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])передоз[а-яa-z]*\s+(?:раствор[а-яa-z]*|инфузи[а-яa-z]*)(?=$|[^а-яa-z])/u,
  /(?:^|[^а-яa-z])не\s+назначать\s+самостоятельно(?=$|[^а-яa-z])/u,
];

const STRUCTURAL_TERMS = new Set([
  'возраст',
  'пол',
  'мальчик',
  'мальчику',
  'девочка',
  'девочке',
  'ребенок',
  'ребенку',
  'ребёнок',
  'ребёнку',
  'пациент',
  'пациентка',
  'мужчина',
  'женщина',
  'лет',
  'год',
  'года',
  'месяц',
  'месяца',
  'месяцев',
  'день',
  'дня',
  'дней',
  'час',
  'часа',
  'часов',
  'неделя',
  'недели',
  'недель',
  'сегодня',
  'вчера',
  'часто',
  'быстро',
  'дышит',
  'дышать',
  'позавчера',
  'жалоба',
  'жалобы',
  'анамнез',
  'нет',
  'принимает',
  'получает',
  'назначен',
  'назначена',
  'первый',
  'второй',
  'третий',
  'четвертый',
  'четвёртый',
  'пятый',
  'со',
  'слов',
]);

const INVESTIGATION_TERMS = [
  'общий анализ крови',
  'общий анализ мочи',
  'оак',
  'оам',
  'узи',
  'ультразвуковое исследование',
  'кт',
  'мрт',
  'рентген',
  'с-реактивный белок',
  'crp',
  'прокальцитонин',
  'сатурация',
  'spo2',
] as const;

const EPIDEMIOLOGY_TERMS = [
  'контакт',
  'поездка',
  'путешествие',
  'дача',
  'лагерь',
  'укус',
  'клещ',
  'животное',
  'регион',
  'эндемич',
] as const;

const FIELD_DETAILS: Record<SearchSuggestionField, string> = {
  age: 'Возраст меняет применимость рекомендаций, дозировок и маршрутизацию.',
  sex: 'Пол может сузить дифференциальный поиск.',
  duration: 'Время начала и динамика помогают выбрать нужный раздел.',
  temperature: 'Укажите максимум и текущую температуру, если измерялась.',
  medications: 'Добавьте уже принятые препараты, дозы и эффект от них.',
  investigations: 'Добавьте анализы, осмотр и инструментальные исследования.',
  epidemiology: 'Поездки, контакты, укусы и регион иногда меняют ветку поиска.',
  diagnosis: 'Уточните заболевание, симптом или терапевтическую цель препарата.',
  severity: 'Степень тяжести и красные флаги влияют на тактику и маршрутизацию.',
  control: 'Для хронического заболевания укажите контроль, обострение и текущую ступень.',
  weight: 'Масса нужна для проверки многих детских доз и ограничений.',
  context: 'Добавьте беременность, лактацию, аллергии, сопутствующие болезни и функцию органов.',
  goal: 'Укажите, какой результат нужен: купирование симптома, профилактика или базисная терапия.',
};

const QUERY_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  контоля: ['контроль', 'контроля'],
  ссаденой: ['ссадина', 'ссадиной'],
  ссаденая: ['ссадина'],
  детский: ['детей'],
  сироп: ['суспензия для приема внутрь'],
  спироп: ['сироп', 'суспензия для приема внутрь'],
  суспенз: ['сироп'],
  суспензи: ['сироп'],
};

const QUERY_PHRASE_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  'в/м': ['внутримышечно'],
  'в/в': ['внутривенно'],
};

const QUERY_EXPANSION_PHRASES = new Set(
  Object.values(QUERY_EXPANSIONS)
    .flat()
    .filter((value) => value.includes(' ')),
);

const INTENT_BRANCH: Readonly<
  Record<QueryIntent['primary'], { label: string; terms: string; weight: number }>
> = {
  diagnosis: {
    label: 'Диагностический поиск',
    terms: 'диагноз диагностика клиническая картина',
    weight: 1.28,
  },
  treatment: {
    label: 'Лечение и тактика',
    terms: 'лечение терапия назначение тактика',
    weight: 1.36,
  },
  medication: {
    label: 'Лекарственные средства',
    terms: 'препарат лекарство фармакотерапия дозировка',
    weight: 1.34,
  },
  'disease-reference': {
    label: 'Справка о заболевании',
    terms: 'определение классификация течение прогноз',
    weight: 1.2,
  },
  'care-guidance': {
    label: 'Уход и рекомендации',
    terms: 'рекомендации уход питание развитие профилактика',
    weight: 1.3,
  },
  'administrative-reference': {
    label: 'Нормативная справка',
    terms: 'критерии правила группа здоровья наблюдение',
    weight: 1.32,
  },
  mixed: {
    label: 'Смешанный клинический запрос',
    terms: 'диагностика лечение рекомендации',
    weight: 1.3,
  },
  unknown: { label: 'Свободный запрос', terms: '', weight: 1 },
};

function range(start: number, end: number): TextRange {
  return { start, end };
}

function factId(kind: QueryFactKind, start: number, end: number): string {
  return `${kind}:${start}:${end}`;
}

function addFact(facts: QueryFact[], input: FactInput<LegacyQueryFactKind>): void {
  if (input.end <= input.start) return;
  const duplicate = facts.some(
    (fact) =>
      fact.kind === input.kind && fact.range.start === input.start && fact.range.end === input.end,
  );
  if (duplicate) return;
  const fact = makeFact(input);
  if (fact) facts.push(fact);
}

interface FactInput<Kind extends QueryFactKind> {
  readonly kind: Kind;
  readonly label: string;
  readonly value: string;
  readonly normalizedValue?: string;
  readonly unit?: string | null;
  readonly polarity?: QueryFactPolarity;
  readonly start: number;
  readonly end: number;
}

function makeFact<Kind extends QueryFactKind>(input: FactInput<Kind>): QueryFact<Kind> | null {
  if (input.end <= input.start) return null;
  return {
    id: factId(input.kind, input.start, input.end),
    kind: input.kind,
    label: input.label,
    value: input.value.trim(),
    normalizedValue: normalizeSurfaceText(input.normalizedValue ?? input.value),
    unit: input.unit ?? null,
    polarity: input.polarity ?? 'positive',
    range: range(input.start, input.end),
  };
}

function addContextFact<Kind extends ClinicalContextFactKind>(
  facts: ClinicalContextFact<Kind>[],
  input: FactInput<Kind>,
  skipRanges: readonly TextRange[] = [],
): void {
  const factRange = range(input.start, input.end);
  if (skipRanges.some((skipRange) => overlaps(skipRange, factRange))) return;
  if (facts.some((fact) => fact.kind === input.kind && overlaps(fact.range, factRange))) {
    return;
  }
  const fact = makeFact(input);
  if (fact) facts.push(fact);
}

function groupRange(match: RegExpMatchArray, groupIndex: number): TextRange {
  const full = match[0];
  const group = match[groupIndex] ?? '';
  const offset = full.indexOf(group);
  const start = (match.index ?? 0) + Math.max(offset, 0);
  return range(start, start + group.length);
}

function overlaps(left: TextRange, right: TextRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function hasFact(facts: readonly QueryFact[], kind: QueryFactKind): boolean {
  return facts.some((fact) => fact.kind === kind);
}

function extractSex(query: string, facts: QueryFact[]): void {
  const patterns: readonly [RegExp, string][] = [
    [
      /(?:мальчику|мальчик|мужчине|мужчина|пациент|пол\s*[:=]?\s*мужской)(?=$|[^а-яёa-z])/iu,
      'мужской',
    ],
    [
      /(?:девочке|девочка|женщине|женщина|пациентка|пол\s*[:=]?\s*женский)(?=$|[^а-яёa-z])/iu,
      'женский',
    ],
  ];
  for (const [pattern, normalizedValue] of patterns) {
    const match = pattern.exec(query);
    if (!match) continue;
    const start = match.index;
    addFact(facts, {
      kind: 'sex',
      label: 'Пол',
      value: match[0],
      normalizedValue,
      start,
      end: start + match[0].length,
    });
    return;
  }
}

function russianPluralUnit(amount: number, forms: readonly [string, string, string]): string {
  const mod100 = amount % 100;
  const mod10 = amount % 10;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function extractAge(query: string, facts: QueryFact[]): void {
  const protectedAgeRanges: TextRange[] = [];
  const compoundPattern =
    /(?:^|[^а-яёa-z])((\d{1,3})\s*год(?:а|ов)?\s+(\d{1,2})\s*месяц(?:а|ев)?)(?=$|[^а-яёa-z])/giu;
  for (const match of query.matchAll(compoundPattern)) {
    const matchRange = groupRange(match, 1);
    const years = Number(match[2] ?? '');
    const months = Number(match[3] ?? '');
    if (!Number.isInteger(years) || !Number.isInteger(months)) continue;
    const totalMonths = years * 12 + months;
    const unit = russianPluralUnit(totalMonths, ['месяц', 'месяца', 'месяцев']);
    protectedAgeRanges.push(matchRange);
    addFact(facts, {
      kind: 'age',
      label: 'Возраст',
      value: match[1] ?? match[0],
      normalizedValue: `${totalMonths} ${unit}`,
      unit,
      start: matchRange.start,
      end: matchRange.end,
    });
  }

  const halfYearPattern = /(?:^|[^а-яёa-z])(полтора\s+года)(?=$|[^а-яёa-z])/giu;
  for (const match of query.matchAll(halfYearPattern)) {
    const matchRange = groupRange(match, 1);
    const unit = russianPluralUnit(18, ['месяц', 'месяца', 'месяцев']);
    protectedAgeRanges.push(matchRange);
    addFact(facts, {
      kind: 'age',
      label: 'Возраст',
      value: match[1] ?? match[0],
      normalizedValue: `18 ${unit}`,
      unit,
      start: matchRange.start,
      end: matchRange.end,
    });
  }

  const abbreviatedMonthsPattern = /(?:^|[^а-яёa-z])((\d{1,3})\s*мес\.?)(?=$|[^а-яёa-z])/giu;
  for (const match of query.matchAll(abbreviatedMonthsPattern)) {
    const matchRange = groupRange(match, 1);
    const amount = Number(match[2] ?? '');
    if (!Number.isInteger(amount)) continue;
    const unit = russianPluralUnit(amount, ['месяц', 'месяца', 'месяцев']);
    protectedAgeRanges.push(matchRange);
    addFact(facts, {
      kind: 'age',
      label: 'Возраст',
      value: match[1] ?? match[0],
      normalizedValue: `${amount} ${unit}`,
      unit,
      start: matchRange.start,
      end: matchRange.end,
    });
  }

  const newbornPattern =
    /(?:^|[^а-яёa-z])((?:новорождённый|новорожденный|новорождённая|новорожденная|новорождённое|новорожденное))(?=$|[^а-яёa-z])/giu;
  for (const match of query.matchAll(newbornPattern)) {
    const matchRange = groupRange(match, 1);
    protectedAgeRanges.push(matchRange);
    addFact(facts, {
      kind: 'age',
      label: 'Возрастной этап',
      value: match[1] ?? match[0],
      normalizedValue: 'неонатальный период',
      unit: null,
      start: matchRange.start,
      end: matchRange.end,
    });
  }

  const patterns = [
    /возраст(?:ом)?\s*[:=]?\s*(\d{1,3})\s*(дн(?:я|ей)?|день|дней|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(?:мальчик|мальчику|девочка|девочке|ребенок|ребёнок|ребенку|ребёнку|пациент|пациентка|мужчина|женщина|младенец|подрост(?:ок|ка|ку|ком|ке))\s*,?\s*(\d{1,3})\s*(дн(?:я|ей)?|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*,?\s*(?:мальчик|девочка|ребенок|ребёнок|пациент|пациентка|мужчина|женщина|младенец)/giu,
    /(?:у\s+)?(?:ребенка|ребёнка|ребенку|ребёнку|мальчика|девочки|младенца)\s+(?:в\s+возрасте\s+|в\s+)?(\d{1,3})\s*(дн(?:я|ей)?|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(\d{1,3})\s*[- ]\s*(?:летн|месячн|дневн)[а-я]*/giu,
  ] as const;
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const start = match.index ?? 0;
      const matchRange = range(start, start + match[0].length);
      if (protectedAgeRanges.some((protectedRange) => overlaps(protectedRange, matchRange))) {
        continue;
      }
      const amount = match[1] ?? '';
      const unit = match[2] ?? (match[0].includes('месяч') ? 'месяцев' : 'лет');
      addFact(facts, {
        kind: 'age',
        label: 'Возраст',
        value: match[0],
        normalizedValue: `${amount} ${unit}`.trim(),
        unit,
        start,
        end: matchRange.end,
      });
    }
  }
  if (
    !hasFact(facts, 'age') &&
    /(?:прикорм|вскармливан|прибавк[а-я]*\s+(?:в\s+)?вес)/iu.test(query)
  ) {
    for (const match of query.matchAll(
      /в\s+(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)(?=$|[\s,.;!?])/giu,
    )) {
      const start = match.index ?? 0;
      addFact(facts, {
        kind: 'age',
        label: 'Возраст',
        value: match[0],
        normalizedValue: `${match[1] ?? ''} ${match[2] ?? ''}`.trim(),
        unit: match[2] ?? null,
        start,
        end: start + match[0].length,
      });
    }
  }
}

function extractTemperature(query: string, facts: QueryFact[]): void {
  const patterns = [
    /(?:температур[а-я]*|лихорадк[а-я]*|t)\s*(?:до|около|примерно|=|:)?\s*((?:3[0-9]|4[0-3])(?:[.,]\d)?)(?:\s*°(?:\s*[cс])?)?/giu,
    /((?:3[5-9]|4[0-3])(?:[.,]\d)?)\s*°(?:\s*[cс])?/giu,
  ] as const;
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const start = match.index ?? 0;
      addFact(facts, {
        kind: 'temperature',
        label: 'Температура',
        value: match[0],
        normalizedValue: (match[1] ?? match[0]).replace(',', '.'),
        unit: '°C',
        start,
        end: start + match[0].length,
      });
    }
  }
}

function extractDuration(query: string, facts: QueryFact[]): void {
  const ageRanges = facts.filter((fact) => fact.kind === 'age').map((fact) => fact.range);
  const gestationalAgeRanges = GESTATIONAL_AGE_PATTERNS.flatMap((pattern) =>
    [...query.matchAll(pattern)].map((match) => groupRange(match, 1)),
  );
  const excludedRanges = [...ageRanges, ...gestationalAgeRanges];
  const patterns = [
    /(?:в\s+течение|уже|болеет|длительность\s*[:=]?|жалобы\s+в\s+течение)?\s*(\d{1,3}(?:\s*[-–—−]\s*\d{1,3})?)\s*(час(?:а|ов)?|дн(?:я|ей)?|день|дней|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|сут(?:ок|ки)?)(?:\s+(?:назад|подряд))?/giu,
    /(?:первый|второй|третий|четвертый|четвёртый|пятый|шестой|седьмой)\s+день/giu,
    /(?:сегодня|вчера|позавчера|несколько\s+дней|около\s+недели)/giu,
  ] as const;
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const start = match.index ?? 0;
      const matchRange = match[1]
        ? range(groupRange(match, 1).start, start + match[0].length)
        : range(start, start + match[0].length);
      if (excludedRanges.some((excludedRange) => overlaps(excludedRange, matchRange))) continue;
      addFact(facts, {
        kind: 'duration',
        label: 'Длительность',
        value: query.slice(matchRange.start, matchRange.end),
        normalizedValue: query
          .slice(matchRange.start, matchRange.end)
          .replace(/\s*[-–—−]\s*/gu, '-'),
        unit: match[2] ?? null,
        start: matchRange.start,
        end: matchRange.end,
      });
    }
  }
  for (const match of query.matchAll(/(?:до\s+еды|после\s+еды|с\s+рождения)/giu)) {
    const start = match.index ?? 0;
    addFact(facts, {
      kind: 'duration',
      label: 'Временная привязка',
      value: match[0],
      normalizedValue: match[0],
      unit: null,
      start,
      end: start + match[0].length,
    });
  }
}

function extractMeasurements(query: string, facts: QueryFact[]): void {
  const patterns: readonly {
    readonly pattern: RegExp;
    readonly label: string;
    readonly unit: string | null;
    readonly normalizer?: (match: RegExpMatchArray) => string;
  }[] = [
    {
      pattern: /(?:вес|масса)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(кг|г)/giu,
      label: 'Масса',
      unit: null,
      normalizer: (match) => `${match[1] ?? ''} ${match[2] ?? ''}`.trim(),
    },
    {
      pattern: /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(кг)(?=$|[^а-яёa-z])/giu,
      label: 'Масса',
      unit: 'кг',
      normalizer: (match) => `${match[1] ?? ''} ${match[2] ?? ''}`.trim(),
    },
    {
      pattern: /(?:spo2|сатурац[а-я]*)\s*[:=]?\s*(\d{2,3})\s*%?/giu,
      label: 'Сатурация',
      unit: '%',
      normalizer: (match) => match[1] ?? match[0],
    },
    {
      pattern: /(?:чсс|пульс)\s*[:=]?\s*(\d{2,3})/giu,
      label: 'ЧСС',
      unit: 'в мин',
      normalizer: (match) => match[1] ?? match[0],
    },
    {
      pattern: /(?:чдд|частота\s+дыхания)\s*[:=]?\s*(\d{1,3})/giu,
      label: 'ЧДД',
      unit: 'в мин',
      normalizer: (match) => match[1] ?? match[0],
    },
    {
      pattern: /(?:ад|давлен[а-я]*)\s*[:=]?\s*(\d{2,3})\s*(?:\/\s*|на\s+)(\d{2,3})/giu,
      label: 'АД',
      unit: 'мм рт. ст.',
      normalizer: (match) => `${match[1] ?? ''}/${match[2] ?? ''}`,
    },
    {
      pattern: /(?<![\d.,])\d{2,3}\s*\/\s*\d{2,3}(?![\d.,])/gu,
      label: 'АД',
      unit: 'мм рт. ст.',
      normalizer: (match) => match[0].replace(/\s+/gu, ''),
    },
  ];
  for (const item of patterns) {
    for (const match of query.matchAll(item.pattern)) {
      const start = match.index ?? 0;
      const matchRange = range(start, start + match[0].length);
      if (
        item.label === 'Масса' &&
        facts.some(
          (fact) =>
            fact.kind === 'measurement' &&
            fact.label === 'Масса' &&
            overlaps(fact.range, matchRange),
        )
      ) {
        continue;
      }
      if (
        item.label === 'АД' &&
        facts.some(
          (fact) =>
            fact.kind === 'measurement' && fact.label === 'АД' && overlaps(fact.range, matchRange),
        )
      ) {
        continue;
      }
      addFact(facts, {
        kind: 'measurement',
        label: item.label,
        value: match[0],
        normalizedValue: item.normalizer?.(match) ?? match[0],
        unit: match[2] && item.label === 'Масса' ? match[2] : item.unit,
        start,
        end: matchRange.end,
      });
    }
  }
}

const RUSSIAN_NUMBER_VALUES: Readonly<Record<string, number>> = {
  ноль: 0,
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
};

const RUSSIAN_NUMBER_WORDS = Object.keys(RUSSIAN_NUMBER_VALUES).join('|');
const WEIGHT_AMOUNT_PATTERN = `(?:\\d+(?:[.,]\\d+)?|(?:${RUSSIAN_NUMBER_WORDS})(?:\\s+(?:${RUSSIAN_NUMBER_WORDS})){0,2})`;
const WEIGHT_KILOGRAM_UNIT_PATTERN = '(?:кг\\.?|килограмм(?:а|ов)?)';
const WEIGHT_UNIT_PATTERN = '(?:кг\\.?|килограмм(?:а|ов)?|г\\.?|грамм(?:а|ов)?)';

const WEIGHT_PREFIX_PATTERN = new RegExp(
  `(?:вес(?:ом)?|масс(?:а|ой|у|е)?)\\s*[:=]?\\s*(?:примерно\\s+|около\\s+|приблизительно\\s+)?(${WEIGHT_AMOUNT_PATTERN})\\s*(${WEIGHT_UNIT_PATTERN})`,
  'giu',
);
const APPROXIMATE_WEIGHT_PATTERN = new RegExp(
  `(?:примерно|около|приблизительно)\\s+(${WEIGHT_AMOUNT_PATTERN})\\s*(${WEIGHT_KILOGRAM_UNIT_PATTERN})(?=$|[^а-яёa-z])`,
  'giu',
);
const BARE_WEIGHT_PATTERN = new RegExp(
  `(?<![\\d.,а-яёa-z])(${WEIGHT_AMOUNT_PATTERN})\\s*(${WEIGHT_KILOGRAM_UNIT_PATTERN})(?=$|[^а-яёa-z])`,
  'giu',
);
const WEIGHT_TEXT_PATTERN = new RegExp(
  `(${WEIGHT_AMOUNT_PATTERN})\\s*(${WEIGHT_UNIT_PATTERN})`,
  'iu',
);

interface NormalizedWeight {
  readonly normalizedValue: string;
  readonly unit: 'кг';
}

function parseRussianNumber(value: string): number | null {
  const tokens = normalizeSurfaceText(value).split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.some((token) => !(token in RUSSIAN_NUMBER_VALUES))) {
    return null;
  }
  return tokens.reduce((sum, token) => sum + (RUSSIAN_NUMBER_VALUES[token] ?? 0), 0);
}

function parseWeightAmount(amount: string, unit: string): NormalizedWeight | null {
  const normalizedAmount = normalizeSurfaceText(amount).replace(',', '.');
  const numericAmount = /^\d+(?:\.\d+)?$/u.test(normalizedAmount)
    ? Number(normalizedAmount)
    : parseRussianNumber(normalizedAmount);
  if (numericAmount === null || !Number.isFinite(numericAmount)) return null;
  const normalizedUnit = normalizeSurfaceText(unit);
  const kilograms =
    normalizedUnit.startsWith('г') || normalizedUnit.startsWith('грамм')
      ? numericAmount / 1_000
      : numericAmount;
  const formatted = Number(kilograms.toFixed(6)).toString();
  return { normalizedValue: `${formatted} кг`, unit: 'кг' };
}

function parseWeightText(value: string): NormalizedWeight | null {
  const match = WEIGHT_TEXT_PATTERN.exec(value);
  if (!match) return null;
  return parseWeightAmount(match[1] ?? '', match[2] ?? '');
}

function extractWeightContext(
  query: string,
  facts: readonly QueryFact[],
): readonly ClinicalContextFact<'weight'>[] {
  const weights: ClinicalContextFact<'weight'>[] = [];
  for (const pattern of [WEIGHT_PREFIX_PATTERN, APPROXIMATE_WEIGHT_PATTERN, BARE_WEIGHT_PATTERN]) {
    for (const match of query.matchAll(pattern)) {
      const normalized = parseWeightAmount(match[1] ?? '', match[2] ?? '');
      if (!normalized) continue;
      const start = match.index ?? 0;
      addContextFact(weights, {
        kind: 'weight',
        label: 'Масса',
        value: match[0],
        normalizedValue: normalized.normalizedValue,
        unit: normalized.unit,
        start,
        end: start + match[0].length,
      });
    }
  }

  for (const fact of facts) {
    if (fact.kind !== 'measurement' || fact.label !== 'Масса') continue;
    const normalized = parseWeightText(fact.value);
    if (!normalized) continue;
    addContextFact(weights, {
      kind: 'weight',
      label: 'Масса',
      value: fact.value,
      normalizedValue: normalized.normalizedValue,
      unit: normalized.unit,
      polarity: fact.polarity,
      start: fact.range.start,
      end: fact.range.end,
    });
  }
  return weights;
}

const ROUTE_PATTERNS: readonly [RegExp, string][] = [
  [/(?:^|[^а-яёa-z])(в\s*\/\s*м|вм|внутримышечно)(?=$|[^а-яёa-z])/giu, 'внутримышечно'],
  [/(?:^|[^а-яёa-z])(в\s*\/\s*в|в\s+вену|внутривенно)(?=$|[^а-яёa-z])/giu, 'внутривенно'],
  [/(?:^|[^а-яёa-z])(per\s+os|peros|перорально)(?=$|[^а-яёa-z])/giu, 'перорально'],
  [/(?:^|[^а-яёa-z])(под\s+язык)(?=$|[^а-яёa-z])/giu, 'сублингвально'],
  [/(?:^|[^а-яёa-z])(ингаляционно)(?=$|[^а-яёa-z])/giu, 'ингаляционно'],
  [/(?:^|[^а-яёa-z])(ректально)(?=$|[^а-яёa-z])/giu, 'ректально'],
  [/(?:^|[^а-яёa-z])(местно)(?=$|[^а-яёa-z])/giu, 'местно'],
  [/(?:^|[^а-яёa-z])(в\s+обе\s+ноздр(?:и|ю))(?:$|[^а-яёa-z])/giu, 'интраназально'],
];

function extractRouteContext(query: string): readonly ClinicalContextFact<'route'>[] {
  const routes: ClinicalContextFact<'route'>[] = [];
  for (const [pattern, normalizedValue] of ROUTE_PATTERNS) {
    for (const match of query.matchAll(pattern)) {
      const routeRange = groupRange(match, 1);
      addContextFact(routes, {
        kind: 'route',
        label: 'Путь введения',
        value: match[1] ?? match[0],
        normalizedValue,
        start: routeRange.start,
        end: routeRange.end,
      });
    }
  }
  return routes;
}

const DOSE_FORM_PATTERN =
  /(?:^|[^а-яёa-z])(суспенз(?:ия|ии|ию|ией)?|сироп(?:а|ом|е)?|спироп(?:а|ом|е)?|таблетк(?:а|и|у|ами|ах)?|маз(?:ь|и|ью)|кап(?:ля|ли|ель|лями))(?=$|[^а-яёa-z])/giu;

function doseFormValue(value: string): string {
  const normalized = normalizeSurfaceText(value);
  if (normalized.startsWith('суспенз')) return 'суспензия';
  if (normalized.startsWith('сироп') || normalized.startsWith('спироп')) return 'сироп';
  if (normalized.startsWith('таблет')) return 'таблетки';
  if (normalized.startsWith('маз')) return 'мазь';
  return 'капли';
}

function extractDoseFormContext(query: string): readonly ClinicalContextFact<'dose-form'>[] {
  const forms: ClinicalContextFact<'dose-form'>[] = [];
  for (const match of query.matchAll(DOSE_FORM_PATTERN)) {
    const formRange = groupRange(match, 1);
    addContextFact(forms, {
      kind: 'dose-form',
      label: 'Лекарственная форма',
      value: match[1] ?? match[0],
      normalizedValue: doseFormValue(match[1] ?? match[0]),
      start: formRange.start,
      end: formRange.end,
    });
  }
  return forms;
}

function decimalValue(value: string): string {
  return value.replace(',', '.');
}

const STRENGTH_CONCENTRATION_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(мг|г|мкг)\s*(?:\/\s*|\s+в\s+)(?:(\d+(?:[.,]\d+)?)\s*)?(мл|доз[ауы]?)/giu;
const STRENGTH_PERCENT_PATTERN = /(\d+(?:[.,]\d+)?)\s*%/giu;
const STRENGTH_VIAL_PATTERN = /(\d+(?:[.,]\d+)?)\s*(мг|г|мкг)\s+(?:во|в)\s+флаконе/giu;
const STRENGTH_AMOUNT_PATTERN = /(?<![\d.,])((?:\d+(?:[.,]\d+)?))\s*(мг|г|мкг)(?=$|[^а-яёa-z])/giu;

function strengthFromMatch(match: RegExpMatchArray): { normalizedValue: string; unit: string } {
  const amount = decimalValue(match[1] ?? '');
  const baseUnit = normalizeSurfaceText(match[2] ?? '');
  const denominator = match[3] ? decimalValue(match[3]) : '';
  const denominatorUnit = normalizeSurfaceText(match[4] ?? '');
  if (denominatorUnit) {
    const denominatorValue = denominator ? `${denominator} ` : '';
    const unit = `${baseUnit}/${denominatorValue}${denominatorUnit}`;
    return { normalizedValue: `${amount} ${unit}`, unit };
  }
  return { normalizedValue: `${amount} ${baseUnit}`, unit: baseUnit };
}

function extractStrengthContext(
  query: string,
  facts: readonly QueryFact[],
): readonly ClinicalContextFact<'strength'>[] {
  const strengths: ClinicalContextFact<'strength'>[] = [];
  const reservedRanges = facts
    .filter((fact) => fact.kind === 'measurement')
    .map((fact) => fact.range);
  const patterns = [
    STRENGTH_CONCENTRATION_PATTERN,
    STRENGTH_PERCENT_PATTERN,
    STRENGTH_VIAL_PATTERN,
    STRENGTH_AMOUNT_PATTERN,
  ] as const;
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const normalized =
        pattern === STRENGTH_PERCENT_PATTERN
          ? { normalizedValue: `${decimalValue(match[1] ?? '')}%`, unit: '%' }
          : strengthFromMatch(match);
      const start = match.index ?? 0;
      addContextFact(
        strengths,
        {
          kind: 'strength',
          label: 'Сила/концентрация',
          value: match[0],
          normalizedValue: normalized.normalizedValue,
          unit: normalized.unit,
          start,
          end: start + match[0].length,
        },
        reservedRanges,
      );
    }
  }
  return strengths;
}

const FREQUENCY_PATTERNS: readonly RegExp[] = [
  /\d+(?:[.,]\d+)?\s*раз(?:а|у)?\s+в\s+(?:день|сутки|суток)/giu,
  /(?:дважды|два\s+раза)\s+в\s+(?:день|сутки|суток)/giu,
  /каждые\s+\d+(?:[.,]\d+)?\s*час(?:а|ов)?/giu,
  /утром\s+и\s+вечером/giu,
  /(?<!\d)\d+\s*-\s*\d+\s*-\s*\d+(?!\d)/gu,
  /однократно|на\s+ночь|по\s+необходимости/giu,
];

function frequencyValue(value: string): { normalizedValue: string; unit: string | null } {
  const normalized = normalizeSurfaceText(value).replace(/\s*-\s*/gu, '-');
  if (/(?:дважды|два\s+раза)/u.test(normalized)) {
    return { normalizedValue: '2 раза в сутки', unit: 'раз/сут' };
  }
  const times = normalized.match(/^(\d+(?:\.\d+)?)\s*раз(?:а|у)?\s+в\s+/u);
  if (times) {
    return { normalizedValue: `${times[1]} раза в сутки`, unit: 'раз/сут' };
  }
  if (/^каждые\s+/u.test(normalized)) return { normalizedValue: normalized, unit: 'ч' };
  return { normalizedValue: normalized, unit: null };
}

function extractFrequencyContext(query: string): readonly ClinicalContextFact<'frequency'>[] {
  const frequencies: ClinicalContextFact<'frequency'>[] = [];
  for (const pattern of FREQUENCY_PATTERNS) {
    for (const match of query.matchAll(pattern)) {
      const normalized = frequencyValue(match[0]);
      const start = match.index ?? 0;
      addContextFact(frequencies, {
        kind: 'frequency',
        label: 'Кратность',
        value: match[0],
        normalizedValue: normalized.normalizedValue,
        unit: normalized.unit,
        start,
        end: start + match[0].length,
      });
    }
  }
  return frequencies;
}

const GESTATIONAL_AGE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^а-яёa-z])((\d{1,3})\s*(недел(?:я|и|ь|ей|ю)?|нед\.?)\s+гестации)(?=$|[^а-яёa-z])/giu,
  /(?:^|[^а-яёa-z])беременность\s+((\d{1,3})\s*(недел(?:я|и|ь|ей|ю)?|нед\.?))(?=$|[^а-яёa-z])/giu,
];

function extractGestationalAgeContext(
  query: string,
): readonly ClinicalContextFact<'gestational-age'>[] {
  const gestationalAges: ClinicalContextFact<'gestational-age'>[] = [];
  for (const pattern of GESTATIONAL_AGE_PATTERNS) {
    for (const match of query.matchAll(pattern)) {
      const matchRange = groupRange(match, 1);
      const amount = Number(match[2] ?? '');
      if (!Number.isInteger(amount)) continue;
      const unit = russianPluralUnit(amount, ['неделя', 'недели', 'недель']);
      addContextFact(gestationalAges, {
        kind: 'gestational-age',
        label: 'Срок беременности',
        value: match[1] ?? match[0],
        normalizedValue: `${amount} ${unit}`,
        unit,
        start: matchRange.start,
        end: matchRange.end,
      });
    }
  }
  return gestationalAges;
}

const PREGNANCY_PATTERN =
  /(?:^|[^а-яёa-z])((?:не\s+беременна|не\s+беременен|не\s+беременны|нет\s+беременности|беременности\s+нет|беременность(?:\s+\d{1,3}\s+недел(?:я|и|ь|ей|ю)?)))(?=$|[^а-яёa-z])/giu;

function extractPregnancyContext(query: string): readonly ClinicalContextFact<'pregnancy'>[] {
  const pregnancies: ClinicalContextFact<'pregnancy'>[] = [];
  for (const match of query.matchAll(PREGNANCY_PATTERN)) {
    const matchRange = groupRange(match, 1);
    const value = match[1] ?? match[0];
    const normalized = normalizeSurfaceText(value);
    const polarity: QueryFactPolarity = /^(?:не\s+|нет\s+)|\s+нет$/u.test(normalized)
      ? 'negative'
      : 'positive';
    addContextFact(pregnancies, {
      kind: 'pregnancy',
      label: 'Беременность',
      value,
      normalizedValue: 'беременность',
      polarity,
      start: matchRange.start,
      end: matchRange.end,
    });
  }
  return pregnancies;
}

const ORGAN_FUNCTION_PATTERN =
  /(?:^|[^а-яёa-z])((?:(?:без|нет|не\s+было|не\s+наблюдается)\s+)?(?:почечн(?:ая|ой|ую|ом|ей)|печеночн(?:ая|ой|ую|ом|ей)|печёночн(?:ая|ой|ую|ом|ей))\s+недостаточн(?:ость|ости|остью)(?:\s+(?:нет|не\s+было|не\s+наблюдается))?)(?=$|[^а-яёa-z])/giu;

function extractOrganFunctionContext(
  query: string,
): readonly ClinicalContextFact<'organ-function'>[] {
  const organFunctions: ClinicalContextFact<'organ-function'>[] = [];
  for (const match of query.matchAll(ORGAN_FUNCTION_PATTERN)) {
    const matchRange = groupRange(match, 1);
    const value = match[1] ?? match[0];
    const normalized = normalizeSurfaceText(value);
    const concept = normalized
      .replace(/^(?:без|нет|не\s+было|не\s+наблюдается)\s+/u, '')
      .replace(/\s+(?:нет|не\s+было|не\s+наблюдается)$/u, '')
      .replace(/почечной\s+недостаточности/u, 'почечная недостаточность')
      .replace(/печеночной\s+недостаточности/u, 'печеночная недостаточность');
    const polarity: QueryFactPolarity =
      /^(?:без|нет|не\s+было|не\s+наблюдается)\s+/u.test(normalized) ||
      /\s+(?:нет|не\s+было|не\s+наблюдается)$/u.test(normalized)
        ? 'negative'
        : 'positive';
    addContextFact(organFunctions, {
      kind: 'organ-function',
      label: 'Функция органа',
      value,
      normalizedValue: concept,
      polarity,
      start: matchRange.start,
      end: matchRange.end,
    });
  }
  return organFunctions;
}

const ALLERGY_PATTERN =
  /(?:^|[^а-яёa-z])((?:аллерг(?:ия|ии|ию|ией|иями)\s+на\s+[^,.;:—–/\s](?:[^,.;:—–/\n]*[^,.;:—–/\s])?|нет\s+аллерги(?:и|я)|аллерги(?:я|и)\s+(?:нет|не\s+было|не\s+отмечается)))(?=$|[^а-яёa-z])/giu;

function extractAllergyContext(query: string): readonly ClinicalContextFact<'allergy'>[] {
  const allergies: ClinicalContextFact<'allergy'>[] = [];
  for (const match of query.matchAll(ALLERGY_PATTERN)) {
    const matchRange = groupRange(match, 1);
    const value = match[1] ?? match[0];
    const normalized = normalizeSurfaceText(value);
    const polarity: QueryFactPolarity =
      /^(?:нет\s+аллерги|аллерги(?:я|и)\s+(?:нет|не\s+было|не\s+отмечается))/u.test(normalized)
        ? 'negative'
        : 'positive';
    const normalizedValue =
      polarity === 'negative'
        ? 'аллергия'
        : `аллергия на ${normalized.replace(/^аллерги(?:я|и|ю|ией|иями)\s+на\s+/u, '')}`;
    addContextFact(allergies, {
      kind: 'allergy',
      label: 'Аллергия',
      value,
      normalizedValue,
      polarity,
      start: matchRange.start,
      end: matchRange.end,
    });
  }
  return allergies;
}

function buildClinicalContext(query: string, facts: readonly QueryFact[]): QueryClinicalContext {
  const age = facts.filter((fact): fact is ClinicalContextFact<'age'> => fact.kind === 'age');
  const sex = facts.filter((fact): fact is QueryFact<'sex'> => fact.kind === 'sex');
  const duration = facts.filter((fact): fact is QueryFact<'duration'> => fact.kind === 'duration');
  const measurements = facts.filter(
    (fact): fact is ClinicalContextFact<'measurement'> => fact.kind === 'measurement',
  );
  const positiveFindings = facts.filter(
    (fact) =>
      fact.polarity === 'positive' &&
      (fact.kind === 'symptom' || fact.kind === 'temperature' || fact.kind === 'measurement'),
  );
  const negativeFindings = facts.filter((fact) => fact.polarity === 'negative');
  const currentMedicines = facts.filter(
    (fact): fact is QueryFact<'medication'> => fact.kind === 'medication',
  );
  return {
    age,
    gestationalAge: extractGestationalAgeContext(query),
    sex,
    duration,
    weight: extractWeightContext(query, facts),
    route: extractRouteContext(query),
    doseForm: extractDoseFormContext(query),
    strength: extractStrengthContext(query, facts),
    frequency: extractFrequencyContext(query),
    measurements,
    positiveFindings,
    negativeFindings,
    currentMedicines,
    pregnancy: extractPregnancyContext(query),
    organFunction: extractOrganFunctionContext(query),
    allergies: extractAllergyContext(query),
  };
}

function trimPrefixNegation(captured: string, aliases: readonly AliasRecord[]): string {
  const normalizedCaptured = normalizeSurfaceText(captured);
  let boundary = captured.length;
  for (const alias of aliases) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const index = findNormalizedPhraseIndex(normalizedCaptured, normalizedAlias);
    if (index <= 0) continue;
    const before = normalizedCaptured.slice(0, index).trimEnd();
    if (/(?:^|\s)(?:и|или|либо)$/u.test(before) || before.endsWith(',')) continue;
    boundary = Math.min(boundary, index);
  }
  const explicitBoundary = normalizedCaptured.search(
    /\s+(?:жалуется|принимает|получает|назначен[а-я]*|обследован[а-я]*|оак|оам|сатурац[а-я]*)(?=\s|$)/u,
  );
  if (explicitBoundary >= 0) boundary = Math.min(boundary, explicitBoundary);
  const temporalBoundary = normalizedCaptured.search(
    /\s+(?:через|спустя)\s+\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:минут[а-я]*|час[а-я]*|дн(?:я|ей|и)|сут(?:ок|ки)?|недел[а-я]*|месяц[а-я]*)(?=\s|$)/u,
  );
  if (temporalBoundary >= 0) boundary = Math.min(boundary, temporalBoundary);
  return (
    captured
      .slice(0, boundary)
      .split(/\s+(?:но|однако|при\s+этом|а)\s+/iu)[0]
      ?.trim() ?? ''
  );
}

function extractNegations(
  query: string,
  aliases: readonly AliasRecord[],
  facts: QueryFact[],
): void {
  const prefixPattern =
    /(?:без|нет|отрицает|не\s+было|не\s+отмечается|не\s+отмечает|не\s+наблюдается)\s+([^,.;:—/\n]{2,80})/giu;
  for (const match of query.matchAll(prefixPattern)) {
    const captured = match[1] ?? '';
    const shortened = trimPrefixNegation(captured, aliases);
    if (!shortened) continue;
    const capturedRange = groupRange(match, 1);
    addFact(facts, {
      kind: 'negative-finding',
      label: 'Отрицательный признак',
      value: shortened,
      polarity: 'negative',
      start: capturedRange.start,
      end: capturedRange.start + shortened.length,
    });
  }
  const postfixPattern =
    /([^,.;:—/\n]{2,50}?)\s+(?:нет|не\s+было|не\s+отмечается|не\s+наблюдается|не\s+помог(?:ло|ла|ли)?|не\s+принимал(?:а|и)?|не\s+принима(?:ет|ют|ю|ешь|ете))(?=\s*[,.;:—/\n]|$)/giu;
  for (const match of query.matchAll(postfixPattern)) {
    const captured = (match[1] ?? '').trim();
    if (!captured) continue;
    const capturedRange = groupRange(match, 1);
    const leadingWhitespace = (match[1] ?? '').length - (match[1] ?? '').trimStart().length;
    addFact(facts, {
      kind: 'negative-finding',
      label: 'Отрицательный признак',
      value: captured,
      polarity: 'negative',
      start: capturedRange.start + leadingWhitespace,
      end: capturedRange.start + leadingWhitespace + captured.length,
    });
  }
}

function addTermFact(
  query: string,
  facts: QueryFact[],
  kind: LegacyQueryFactKind,
  label: string,
  term: string,
): void {
  const normalizedQuery = normalizeSurfaceText(query);
  const normalizedTerm = normalizeSurfaceText(term);
  const index = normalizedQuery.indexOf(normalizedTerm);
  if (index < 0) return;
  addFact(facts, {
    kind,
    label,
    value: query.slice(index, index + term.length),
    normalizedValue: normalizedTerm,
    start: index,
    end: index + term.length,
  });
}

function extractAliasFacts(
  query: string,
  matches: ReturnType<typeof expandAliases>['matchSpans'],
  facts: QueryFact[],
): void {
  const aliases = matches.map((match) => match.alias);
  for (const match of matches) {
    if (match.matchType !== 'exact') continue;
    const alias = match.alias;
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const index = match.range.start;
    const kindByCategory: Readonly<Record<string, LegacyQueryFactKind>> = {
      symptom: 'symptom',
      investigation: 'investigation',
      measurement: 'measurement',
      medication: 'medication',
      location: 'location',
      epidemiology: 'epidemiology',
    };
    const kind = alias.category ? kindByCategory[alias.category] : undefined;
    if (!kind) continue;
    const aliasRange = range(index, index + alias.alias.length);
    const isNegated = facts.some(
      (fact) => fact.kind === 'negative-finding' && overlaps(fact.range, aliasRange),
    );
    if (isNegated) continue;
    const meanings = new Set(
      aliases
        .filter((candidate) => normalizeSurfaceText(candidate.alias) === normalizedAlias)
        .map((candidate) => normalizeSurfaceText(candidate.canonicalTerm)),
    );
    const input: FactInput<LegacyQueryFactKind> = {
      kind,
      label: alias.category === 'medication' ? 'Препарат' : 'Распознанный термин',
      value: query.slice(index, index + alias.alias.length),
      normalizedValue: alias.canonicalTerm,
      start: index,
      end: index + alias.alias.length,
    };
    if (meanings.size > 1) {
      const fact = makeFact({ ...input, polarity: 'uncertain' });
      if (fact) {
        const id = `${fact.id}:${encodeURIComponent(normalizeSurfaceText(alias.canonicalTerm))}`;
        if (!facts.some((existing) => existing.id === id)) facts.push({ ...fact, id });
      }
    } else addFact(facts, input);
  }
}

interface SymptomExpressionEntry {
  readonly id: string;
  readonly canonical: string;
  readonly label: string;
  readonly system: string;
  readonly phrases: readonly string[];
}

const SYMPTOM_EXPRESSION_ENTRIES = symptomExpressions.entries as readonly SymptomExpressionEntry[];

function escapeExpression(value: string): string {
  return value
    .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    .replace(/[её]/gu, '[её]')
    .replace(/\s+/gu, '\\s+');
}

function extractSymptomExpressions(query: string, facts: QueryFact[]): void {
  const negativeRanges = facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.range);
  for (const entry of SYMPTOM_EXPRESSION_ENTRIES) {
    for (const phrase of entry.phrases) {
      const pattern = new RegExp(
        `(?:^|[^а-яёa-z])(${escapeExpression(phrase)})(?=$|[^а-яёa-z])`,
        'giu',
      );
      for (const match of query.matchAll(pattern)) {
        const symptomRange = groupRange(match, 1);
        if (negativeRanges.some((negativeRange) => overlaps(negativeRange, symptomRange))) continue;
        addFact(facts, {
          kind: 'symptom',
          label: entry.label,
          value: match[1] ?? match[0],
          normalizedValue: entry.canonical,
          start: symptomRange.start,
          end: symptomRange.end,
        });
      }
    }
  }
}

const SYMPTOM_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly canonical: string;
  readonly label: string;
}[] = [
  {
    pattern:
      /(?:^|[^а-яёa-z])((?:кашл(?:яет|яют|яю|яешь|ять|ель|я|ем|ете)|покашливает))(?=$|[^а-яёa-z])/giu,
    canonical: 'кашель',
    label: 'Кашель',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:лихорад(?:ка|ит|ило)|температурит))(?=$|[^а-яёa-z])/giu,
    canonical: 'лихорадка',
    label: 'Лихорадка',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:рвота|рвало|рвет|рвёт|тошнит))(?=$|[^а-яёa-z])/giu,
    canonical: 'рвота',
    label: 'Рвота',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:диаре[яию]|понос|жидкий\s+стул))(?=$|[^а-яёa-z])/giu,
    canonical: 'диарея',
    label: 'Диарея',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:сыпь|сыпи|высыпания|высыпало))(?=$|[^а-яёa-z])/giu,
    canonical: 'сыпь',
    label: 'Сыпь',
  },
  {
    pattern:
      /(?:^|[^а-яёa-z])((?:одышка|одышку|задыхается|тяжело\s+дышит|часто\s+дышит))(?=$|[^а-яёa-z])/giu,
    canonical: 'одышка тахипноэ',
    label: 'Нарушение дыхания',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:тошнота|тошнит))(?=$|[^а-яёa-z])/giu,
    canonical: 'тошнота',
    label: 'Тошнота',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:вялость|вялый|вялая|сонливость|сонливый))(?=$|[^а-яёa-z])/giu,
    canonical: 'вялость',
    label: 'Вялость',
  },
  {
    pattern: /(?:^|[^а-яёa-z])((?:боль|болит|болело|болит\s+живот))(?=$|[^а-яёa-z])/giu,
    canonical: 'боль',
    label: 'Боль',
  },
];

function extractSymptoms(query: string, facts: QueryFact[]): void {
  const negativeRanges = facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.range);
  for (const item of SYMPTOM_PATTERNS) {
    for (const match of query.matchAll(item.pattern)) {
      const symptomRange = groupRange(match, 1);
      if (negativeRanges.some((negativeRange) => overlaps(negativeRange, symptomRange))) continue;
      addFact(facts, {
        kind: 'symptom',
        label: item.label,
        value: match[1] ?? match[0],
        normalizedValue: item.canonical,
        start: symptomRange.start,
        end: symptomRange.end,
      });
    }
  }
}

function extractKnownTerms(query: string, facts: QueryFact[]): void {
  for (const term of INVESTIGATION_TERMS) {
    addTermFact(query, facts, 'investigation', 'Обследование', term);
  }
  const normalized = normalizeSurfaceText(query);
  for (const term of EPIDEMIOLOGY_TERMS) {
    const index = normalized.indexOf(term);
    if (index < 0) continue;
    addFact(facts, {
      kind: 'epidemiology',
      label: 'Эпидемиология',
      value: query.slice(index, index + term.length),
      normalizedValue: term,
      start: index,
      end: index + term.length,
    });
  }
}

function extractMedicationPhrase(query: string, facts: QueryFact[]): void {
  const pattern =
    /(?:принимает|получает|назначен(?:а|о|ы)?|терапия\s*[:=]?)\s+([а-яa-z][а-яa-z-]+(?:\s+[а-яa-z][а-яa-z-]+){0,2})/giu;
  for (const match of query.matchAll(pattern)) {
    const value = (match[1] ?? '').split(/\s+(?:и|но|по|при)\s+/iu)[0]?.trim() ?? '';
    if (value.length < 3) continue;
    const valueRange = groupRange(match, 1);
    addFact(facts, {
      kind: 'medication',
      label: 'Терапия',
      value,
      start: valueRange.start,
      end: valueRange.start + value.length,
    });
  }
}

function buildWarnings(normalizedQuery: string, facts: readonly QueryFact[]): readonly string[] {
  const warnings: string[] = [];
  if (/(?:вроде|кажется|возможно|вероятно|со\s+слов)/u.test(normalizedQuery)) {
    warnings.push(
      'В описании есть неопределённые формулировки; исходный текст сохранён без изменений.',
    );
  }
  if (facts.filter((fact) => fact.kind === 'temperature').length > 1) {
    warnings.push(
      'Найдено несколько значений температуры; учитывайте временную последовательность.',
    );
  }
  if (normalizedQuery.length > 4_000) {
    warnings.push('Описание длинное: поиск выполнен по нескольким независимым веткам.');
  }
  if (/(?:менингит.*энцефалит|энцефалит.*менингит|менингоэнцефалит)/u.test(normalizedQuery)) {
    warnings.push(
      'Менингит и энцефалит могут перекрываться по симптомам: уточнения показаны, но поиск по диагнозам уже выполнен.',
    );
  }
  return warnings;
}

function suggestion(
  field: SearchSuggestionField,
  label: string,
  insertion: string,
  priority: number,
  kind: SearchSuggestion['kind'] = 'missing-field',
): SearchSuggestion {
  return {
    id: field,
    field,
    label,
    insertion,
    detail: FIELD_DETAILS[field],
    priority,
    kind,
  };
}

function buildSuggestions(
  normalizedQuery: string,
  facts: readonly QueryFact[],
  intent: QueryIntent,
): readonly SearchSuggestion[] {
  const suggestions: SearchSuggestion[] = [];
  const add = (item: SearchSuggestion): void => {
    if (!suggestions.some((candidate) => candidate.id === item.id)) suggestions.push(item);
  };
  const childContext = /(?:ребен|ребён|мальчик|девоч|младен|\b\d+\s*месяц)/u.test(normalizedQuery);
  const hasTarget = /(?:лечени[ея]|терапи[яию]|при|для)\s+[а-яa-z][а-яa-z-]{3,}/u.test(
    normalizedQuery,
  );
  const neuroinfectionAmbiguity = /(?:менингит|энцефалит|менингоэнцефалит|нейроинфекц)/u.test(
    normalizedQuery,
  );

  if (neuroinfectionAmbiguity) {
    add(
      suggestion('severity', 'Сознание и судороги', 'Сознание/судороги: ', 118, 'query-refinement'),
    );
    add(
      suggestion(
        'investigations',
        'Менингеальные и очаговые признаки',
        'Менингеальные/очаговые признаки: ',
        116,
        'query-refinement',
      ),
    );
    add(
      suggestion('context', 'Сыпь и гемодинамика', 'Сыпь/гемодинамика: ', 108, 'query-refinement'),
    );
  }

  if (intent.primary === 'diagnosis' || intent.primary === 'mixed') {
    if (!hasFact(facts, 'age')) add(suggestion('age', 'Возраст', 'Возраст: ', 100));
    if (!hasFact(facts, 'duration'))
      add(suggestion('duration', 'Длительность', 'Длительность: ', 95));
    if (!hasFact(facts, 'temperature'))
      add(suggestion('temperature', 'Температура', 'Температура: ', 85));
    if (!hasFact(facts, 'sex')) add(suggestion('sex', 'Пол', 'Пол: ', 70));
    if (!hasFact(facts, 'investigation'))
      add(suggestion('investigations', 'Обследования', 'Обследования: ', 65));
    if (!hasFact(facts, 'medication'))
      add(suggestion('medications', 'Препараты', 'Препараты: ', 55));
    if (
      /(?:сып|лихорад|инфекц|укус|диаре|кашл|контакт|клещ)\w*/u.test(normalizedQuery) &&
      !hasFact(facts, 'epidemiology')
    ) {
      add(suggestion('epidemiology', 'Контакты и поездки', 'Эпидемиология: ', 60));
    }
  }

  if (
    intent.primary === 'treatment' ||
    intent.primary === 'medication' ||
    intent.primary === 'mixed'
  ) {
    if (!hasTarget) add(suggestion('diagnosis', 'Диагноз или цель', 'Диагноз/цель: ', 100));
    if (!hasFact(facts, 'age')) add(suggestion('age', 'Возраст', 'Возраст: ', 98));
    add(suggestion('severity', 'Тяжесть', 'Тяжесть/красные флаги: ', 88));
    if (
      /астм/u.test(normalizedQuery) &&
      !/(?:контрол|контол|обострен|ступен)/u.test(normalizedQuery)
    ) {
      add(suggestion('control', 'Контроль заболевания', 'Контроль/ступень: ', 92));
    }
    if (!hasFact(facts, 'medication'))
      add(suggestion('medications', 'Текущая терапия', 'Текущая терапия: ', 75));
    if (
      childContext &&
      !facts.some((fact) => fact.kind === 'measurement' && fact.label === 'Масса')
    ) {
      add(suggestion('weight', 'Масса', 'Масса: ', 82));
    }
    add(suggestion('context', 'Ограничения', 'Аллергии/сопутствующие состояния: ', 64));
  }

  if (intent.primary === 'medication') {
    add(suggestion('goal', 'Цель терапии', 'Цель терапии: ', 90, 'query-refinement'));
  }
  if (intent.primary === 'care-guidance') {
    if (!hasFact(facts, 'age')) add(suggestion('age', 'Возраст', 'Возраст: ', 100));
    add(suggestion('context', 'Контекст', 'Тип вскармливания/особенности: ', 74));
  }
  if (intent.primary === 'administrative-reference') {
    add(suggestion('severity', 'Тяжесть и осложнения', 'Тяжесть/осложнения: ', 100));
    add(suggestion('context', 'Текущее состояние', 'Ремиссия/обострение/ограничения: ', 92));
  }

  return suggestions.toSorted((left, right) => right.priority - left.priority).slice(0, 7);
}

function ftsToken(term: string): string {
  const escaped = term.replaceAll('"', '""');
  return `"${escaped}"*`;
}

const ICD10_CODE_PATTERN =
  /(?<![A-ZА-Я0-9])(?<code>[A-ZА-Я]?\d{2}(?:[.\-\s]\s*\d+|\d+)?)(?![A-ZА-Я0-9])/giu;

function icd10LegacyFtsQueries(
  value: string,
  excludedNumericTerms?: ReadonlySet<string>,
): readonly string[] {
  const queries = new Set<string>();
  for (const match of value.matchAll(ICD10_CODE_PATTERN)) {
    // biome-ignore lint/complexity/useLiteralKeys: named RegExp groups use an index signature.
    const compact = match.groups?.['code']?.replace(/[.\-\s]/gu, '').toLowerCase();
    const numeric = compact?.replace(/^[a-zа-я]/u, '');
    if (!numeric || numeric.length < 3 || excludedNumericTerms?.has(numeric)) continue;
    const prefix = numeric.slice(0, 2);
    const suffix = numeric.slice(2);
    queries.add(`(${ftsToken(prefix)} AND ${ftsToken(suffix)})`);
    queries.add(`(${ftsToken(`i${prefix}`)} AND ${ftsToken(suffix)})`);
  }
  return [...queries];
}

function buildFtsQuery(
  query: string,
  terms: readonly string[],
  excludedNumericTerms?: ReadonlySet<string>,
): string {
  return [
    ...new Set([...terms.map(ftsToken), ...icd10LegacyFtsQueries(query, excludedNumericTerms)]),
  ].join(' OR ');
}

function icd10CodeFragments(values: readonly string[]): ReadonlySet<string> {
  const fragments = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(ICD10_CODE_PATTERN)) {
      for (const token of tokenize(match[0])) fragments.add(token);
    }
  }
  return fragments;
}

function icd10SearchTerms(values: readonly string[]): readonly string[] {
  const terms = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(ICD10_CODE_PATTERN)) {
      // biome-ignore lint/complexity/useLiteralKeys: named RegExp groups use an index signature.
      const compact = match.groups?.['code']?.replace(/[.\-\s]/gu, '').toLowerCase();
      if (!compact || compact.length < 3) continue;
      terms.add(compact);
      const numeric = compact.replace(/^[a-zа-я]/u, '');
      if (numeric.length >= 3) terms.add(numeric);
    }
  }
  return [...terms];
}

function termsWithStems(
  values: readonly string[],
  excludedNumericTerms?: ReadonlySet<string>,
): readonly string[] {
  const terms = new Set<string>();
  const icd10Fragments = icd10CodeFragments(values);
  for (const value of values) {
    const normalizedValue = normalizeSurfaceText(value);
    const paddedValue = ` ${normalizedValue} `;
    for (const [phrase, expansions] of Object.entries(QUERY_PHRASE_EXPANSIONS)) {
      if (!paddedValue.includes(` ${phrase} `)) continue;
      for (const expansion of expansions) {
        terms.add(expansion);
        terms.add(lightStemRussian(expansion));
      }
    }
    if (QUERY_EXPANSION_PHRASES.has(normalizedValue)) {
      terms.add(normalizedValue);
      continue;
    }
    for (const token of tokenize(value)) {
      if (icd10Fragments.has(token)) continue;
      if (/^\d+$/u.test(token) || STRUCTURAL_TERMS.has(token)) continue;
      terms.add(token);
      terms.add(lightStemRussian(token));
      const expansionKeys = new Set([token, lightStemRussian(token)]);
      for (const expansionKey of expansionKeys) {
        for (const expansion of QUERY_EXPANSIONS[expansionKey] ?? []) {
          terms.add(expansion);
          if (!QUERY_EXPANSION_PHRASES.has(expansion)) terms.add(lightStemRussian(expansion));
        }
      }
    }
  }
  for (const term of icd10SearchTerms(values)) {
    if (!excludedNumericTerms?.has(term)) terms.add(term);
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, MAX_FTS_TERMS);
}

function strengthPresentationFtsQuery(values: readonly string[]): string {
  return values
    .map((value) => {
      const normalized = normalizeSurfaceText(value);
      const [numerator = normalized, denominator] = normalized.split(/\s*\/\s*/u);
      const numeratorTerms = termsWithStems([numerator]).filter((term) => !term.includes(' '));
      const denominatorTerms = denominator
        ? termsWithStems([denominator]).filter(
            (term) => !term.includes(' ') && !/^\d+$/u.test(term),
          )
        : [];
      const terms = [...new Set([...numeratorTerms, ...denominatorTerms])];
      return terms.length > 0 ? terms.map(ftsToken).join(' AND ') : ftsToken(normalized);
    })
    .filter((query) => query.length > 0)
    .map((query) => `(${query})`)
    .join(' OR ');
}

function makeBranch(
  id: string,
  kind: QueryBranchKind,
  label: string,
  query: string,
  values: readonly string[],
  weight: number,
  excludedNumericTerms?: ReadonlySet<string>,
): LexicalQueryBranchPlan | null {
  const terms = termsWithStems(values, excludedNumericTerms);
  if (terms.length === 0) return null;
  return {
    id,
    kind,
    label,
    query,
    normalizedQuery: normalizeSurfaceText(query),
    terms,
    weight,
    ftsQuery: buildFtsQuery(query, terms, excludedNumericTerms),
  };
}

function measurementNumericTerms(facts: readonly QueryFact[]): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const fact of facts) {
    if (fact.kind !== 'measurement') continue;
    for (const token of tokenize(fact.normalizedValue)) {
      if (/^\d+$/u.test(token)) terms.add(token);
    }
  }
  return terms;
}

function termsInsideNegativeFacts(facts: readonly QueryFact[]): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const fact of facts) {
    if (fact.kind !== 'negative-finding') continue;
    for (const term of termsWithStems([fact.normalizedValue])) terms.add(term);
  }
  // Include the shared stem of inflected/generated forms (пневмонии → пневмони → пневмон).
  return new Set([...terms, ...[...terms].map(lightStemRussian)]);
}

function buildMedicationDoseCalculation(
  normalizedQuery: string,
  expansion: ReturnType<typeof expandAliases>,
  facts: readonly QueryFact[],
  clinicalContext: QueryClinicalContext,
): QueryCalculation | undefined {
  const hasExplicitDoseIntent = MEDICATION_DOSE_QUERY_PATTERNS.some((pattern) =>
    pattern.test(normalizedQuery),
  );
  const hasPatientContext = clinicalContext.age.length > 0 || clinicalContext.weight.length > 0;
  if (!hasExplicitDoseIntent && !hasPatientContext) {
    return undefined;
  }
  if (MEDICATION_DOSE_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalizedQuery))) {
    return undefined;
  }
  if (MEDICATION_INFORMATIONAL_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedQuery))) {
    return undefined;
  }

  const negativeRanges = facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.range);
  const candidates = new Map<string, QueryMedicationCandidate>();
  for (const matchSpan of expansion.matchSpans) {
    if (matchSpan.alias.category !== 'medication') continue;
    if (negativeRanges.some((negativeRange) => overlaps(negativeRange, matchSpan.range))) continue;
    const matchedText = normalizedQuery.slice(matchSpan.range.start, matchSpan.range.end);
    if (!matchedText) continue;

    const candidate = {
      canonicalTerm: matchSpan.alias.canonicalTerm,
      matchedText,
      matchType: matchSpan.matchType,
    } as const;
    const key = normalizeSurfaceText(candidate.canonicalTerm);
    const current = candidates.get(key);
    if (!current || (current.matchType === 'fuzzy' && candidate.matchType === 'exact')) {
      candidates.set(key, candidate);
    }
  }
  if (candidates.size === 0) return undefined;
  return { kind: 'medication-dose', medicationCandidates: [...candidates.values()] };
}

function buildInfusionVolumeCalculation(
  normalizedQuery: string,
  clinicalContext: QueryClinicalContext,
): QueryCalculation | undefined {
  const hasExplicitIntent = INFUSION_VOLUME_QUERY_PATTERNS.some((pattern) =>
    pattern.test(normalizedQuery),
  );
  const hasContextualIntent =
    /(?:^|[^а-яa-z])инфузи(?:я|и)(?=$|[^а-яa-z])/u.test(normalizedQuery) &&
    (clinicalContext.age.length > 0 || clinicalContext.weight.length > 0);
  if (!hasExplicitIntent && !hasContextualIntent) {
    return undefined;
  }
  if (
    INFUSION_VOLUME_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalizedQuery)) ||
    MEDICATION_INFORMATIONAL_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedQuery))
  ) {
    return undefined;
  }
  return { kind: 'infusion-volume' };
}

function buildBranches(
  query: string,
  aliases: readonly AliasRecord[],
  facts: readonly QueryFact[],
  clinicalContext: QueryClinicalContext,
  intent: QueryIntent,
): readonly LexicalQueryBranchPlan[] {
  const normalizedQuery = normalizeSurfaceText(query);
  const expansion = expandAliases(normalizedQuery, aliases);
  const negativeTerms = termsInsideNegativeFacts(facts);
  const measurementTerms = measurementNumericTerms(facts);
  const subjectQuery = searchSubjectText(query);
  const originalTerms = termsWithStems([subjectQuery], measurementTerms);
  const positiveTerms = originalTerms.filter((term) => !negativeTerms.has(term));
  const negativeRanges = facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.range);
  const positiveMatches = expansion.matchSpans.filter(
    (matchSpan) =>
      !negativeRanges.some((negativeRange) => overlaps(negativeRange, matchSpan.range)),
  );
  const exactCanonicalTerms = termsWithStems(
    positiveMatches
      .filter((matchSpan) => matchSpan.matchType === 'exact')
      .map((matchSpan) => matchSpan.alias.canonicalTerm),
  );
  const fuzzyTerms = termsWithStems(
    positiveMatches
      .filter((matchSpan) => matchSpan.matchType === 'fuzzy')
      .flatMap((matchSpan) =>
        matchSpan.alias.category === 'medication'
          ? [matchSpan.alias.canonicalTerm, matchSpan.alias.alias]
          : [matchSpan.alias.canonicalTerm],
      ),
  );
  const clinicalTerms = [...new Set([...positiveTerms, ...exactCanonicalTerms])].slice(
    0,
    MAX_FTS_TERMS,
  );
  const branches: LexicalQueryBranchPlan[] = [];
  const exactMedicationAliases = positiveMatches
    .filter(
      (matchSpan) =>
        matchSpan.matchType === 'exact' &&
        matchSpan.alias.category === 'medication' &&
        normalizeSurfaceText(matchSpan.alias.alias) !==
          normalizeSurfaceText(matchSpan.alias.canonicalTerm),
    )
    .map((matchSpan) => matchSpan.alias.alias);
  const strengthValues = clinicalContext.strength
    .filter((fact) => fact.polarity === 'positive')
    .map((fact) => fact.normalizedValue);
  const presentationTermGroups = [
    termsWithStems(exactMedicationAliases),
    termsWithStems(
      clinicalContext.doseForm
        .filter((fact) => fact.polarity === 'positive')
        .map((fact) => fact.normalizedValue),
    ),
    termsWithStems(
      clinicalContext.route
        .filter((fact) => fact.polarity === 'positive')
        .map((fact) => fact.normalizedValue),
    ),
    [
      ...termsWithStems(strengthValues),
      ...strengthValues.map((value) => normalizeSurfaceText(value)),
    ],
  ].map((terms) => [...new Set(terms)]);
  const presentationFtsQueries = presentationTermGroups.map((terms, index) =>
    index === 3 ? strengthPresentationFtsQuery(strengthValues) : terms.map(ftsToken).join(' OR '),
  );
  const presentationGroups = presentationTermGroups
    .map((terms, index) => ({ terms, ftsQuery: presentationFtsQueries[index] ?? '' }))
    .filter((group) => group.terms.length > 0 && group.ftsQuery.length > 0);
  const [medicationAliasGroup, ...structuredPresentationGroups] = presentationGroups;
  if (medicationAliasGroup && structuredPresentationGroups.length > 0) {
    branches.push({
      id: 'medication-presentation',
      kind: 'medication',
      label: 'Точная форма препарата',
      query,
      normalizedQuery,
      terms: [
        ...new Set([
          ...medicationAliasGroup.terms,
          ...structuredPresentationGroups.flatMap((group) => group.terms),
        ]),
      ].slice(0, MAX_FTS_TERMS),
      weight: 1.7,
      ftsQuery: [medicationAliasGroup, ...structuredPresentationGroups]
        .map((group) => `(${group.ftsQuery})`)
        .join(' AND '),
    });
  }
  const clinicalWeight = intent.primary === 'diagnosis' ? 1.32 : 1.18;
  const clinical = makeBranch(
    'clinical',
    'clinical',
    'Клинические признаки',
    query,
    clinicalTerms,
    clinicalWeight,
    measurementTerms,
  );
  if (clinical) branches.push(clinical);
  const phrase = subjectQuery;
  if (
    (tokenize(phrase).length >= 3 ||
      (subjectQuery !== normalizedQuery && tokenize(phrase).length >= 2)) &&
    negativeTerms.size === 0
  ) {
    branches.push({
      id: 'source-phrase',
      kind: 'original',
      label: 'Точная фраза источника',
      query,
      normalizedQuery,
      terms: positiveTerms,
      weight: 1.7,
      ftsQuery: `"${phrase.replaceAll('"', '""')}"`,
    });
  }

  const fuzzyAliases = makeBranch(
    'fuzzy-aliases',
    'clinical',
    'Похожие клинические термины',
    fuzzyTerms.join(' '),
    fuzzyTerms,
    0.72,
  );
  if (fuzzyAliases && exactCanonicalTerms.length === 0) branches.push(fuzzyAliases);

  const intentSpec = INTENT_BRANCH[intent.primary];
  if (intent.primary !== 'unknown') {
    const branch = makeBranch(
      'intent',
      'intent',
      intentSpec.label,
      query,
      [subjectQuery, intentSpec.terms],
      intentSpec.weight,
      measurementTerms,
    );
    if (branch && !branches.some((item) => item.ftsQuery === branch.ftsQuery))
      branches.push(branch);
  }

  const original = makeBranch(
    'original',
    'original',
    'Исходная формулировка',
    query,
    positiveTerms,
    1,
    measurementTerms,
  );
  if (original && !branches.some((item) => item.ftsQuery === original.ftsQuery))
    branches.push(original);

  const investigations = facts
    .filter((fact) => fact.kind === 'investigation' || fact.label === 'Сатурация')
    .map((fact) => fact.normalizedValue);
  const investigation = makeBranch(
    'investigations',
    'investigation',
    'Обследования',
    investigations.join(' '),
    investigations,
    0.95,
  );
  if (investigation) branches.push(investigation);

  const medications = facts
    .filter((fact) => fact.kind === 'medication')
    .map((fact) => fact.normalizedValue);
  const medication = makeBranch(
    'medications',
    'medication',
    'Препараты и терапия',
    medications.join(' '),
    medications,
    1.05,
  );
  if (medication) branches.push(medication);

  if (query.length >= 100 || /[.;\n]/u.test(query)) {
    const clauses = query
      .split(/[.;\n]+/u)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length >= 18)
      .slice(0, 3);
    for (const [index, clause] of clauses.entries()) {
      const clauseNormalized = normalizeSurfaceText(clause);
      if (/^(?:без|нет|отрицает|не\s+)/u.test(clauseNormalized)) continue;
      const branch = makeBranch(
        `clause-${index + 1}`,
        'clause',
        `Фрагмент ${index + 1}`,
        clause,
        [clause],
        0.82,
        measurementTerms,
      );
      if (branch && !branches.some((item) => item.ftsQuery === branch.ftsQuery))
        branches.push(branch);
    }
  }
  if (/(?:как\s+отличить|чем\s+отличается|дифференциальн[а-я]*\s+диагноз)/u.test(normalizedQuery)) {
    const differential = makeBranch(
      'differential',
      'intent',
      'Критерии дифференциальной диагностики',
      query,
      [normalizedQuery, 'дифференциальная диагностика отличия критерии'],
      1.38,
      measurementTerms,
    );
    if (differential) branches.unshift(differential);
  }
  if (
    /(?:как\s+диагностировать\s+дальше|что\s+(?:обследовать|проверить)|какие\s+(?:анализы|обследования))/u.test(
      normalizedQuery,
    )
  ) {
    const nextDiagnostics = makeBranch(
      'next-diagnostics',
      'intent',
      'Следующий этап диагностики',
      query,
      [normalizedQuery, 'диагностика обследование лабораторная инструментальная'],
      1.4,
      measurementTerms,
    );
    if (nextDiagnostics) branches.unshift(nextDiagnostics);
  }
  const selected = branches.slice(0, MAX_BRANCHES).flatMap((branch) => {
    const terms = branch.terms.filter(
      (term) => !negativeTerms.has(term) && !negativeTerms.has(lightStemRussian(term)),
    );
    if (terms.length === branch.terms.length) return [branch];
    if (terms.length === 0) return [];
    // Alias/intent/clause expansion must not reintroduce a finding excluded in the original query.
    return [{ ...branch, terms, ftsQuery: terms.map(ftsToken).join(' OR ') }];
  });
  // Informational words such as “instruction” must not fill the candidate window with other drugs.
  // Keep clinical/mixed queries broad; only explicit medication intent requires a named product.
  if (
    intent.primary !== 'medication' &&
    !(
      intent.primary === 'unknown' &&
      MEDICATION_INFORMATIONAL_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedQuery))
    )
  )
    return selected;
  const namedMedications = facts.filter(
    (fact) => fact.kind === 'medication' && fact.polarity === 'positive',
  );
  const names = [
    ...new Set(namedMedications.flatMap((fact) => [fact.value, fact.normalizedValue])),
  ];
  const medicationQuery = names
    .map((name) =>
      tokenize(normalizeSurfaceText(name))
        .map((term) => `(${termsWithStems([term]).map(ftsToken).join(' OR ')})`)
        .join(' AND '),
    )
    .filter(Boolean)
    .map((name) => `(${name})`)
    .join(' OR ');
  return medicationQuery
    ? selected.map((branch) => ({
        ...branch,
        ftsQuery: `(${branch.ftsQuery}) AND (${medicationQuery})`,
      }))
    : selected;
}

/** Source lookup keeps vocabulary expansion but does not interpret a patient's clinical case. */
export function buildLookupQueryPlan(
  query: string,
  aliases: readonly AliasRecord[],
): ClinicalQueryPlan {
  const expansion = expandAliases(query, aliases);
  const branch = makeBranch(
    'lookup',
    'original',
    'Поиск по источникам',
    query,
    [query, ...expansion.terms],
    1,
  );
  const branches = branch ? [branch] : [];
  return {
    analysis: {
      originalQuery: query,
      normalizedQuery: normalizeSurfaceText(query),
      facts: [],
      branches,
      suggestions: [],
      warnings: [],
    },
    branches,
    aliasMatches: expansion.matches,
    terms: branch?.terms ?? [],
    ftsQuery: branch?.ftsQuery ?? '',
  };
}

export function analyzeClinicalQuery(
  query: string,
  aliases: readonly AliasRecord[],
  includeSuggestions = true,
): ClinicalQueryPlan {
  const normalizedQuery = normalizeSurfaceText(query);
  const intent = classifyMedicalQueryIntent(query);
  const expansion = expandAliases(normalizedQuery, aliases);
  const facts: QueryFact[] = [];
  extractSex(query, facts);
  extractAge(query, facts);
  extractTemperature(query, facts);
  extractDuration(query, facts);
  extractMeasurements(query, facts);
  extractNegations(query, aliases, facts);
  extractSymptomExpressions(query, facts);
  extractSymptoms(query, facts);
  extractAliasFacts(query, expansion.matchSpans, facts);
  extractKnownTerms(query, facts);
  extractMedicationPhrase(query, facts);
  const orderedFacts = facts.toSorted((left, right) => left.range.start - right.range.start);
  const clinicalContext = buildClinicalContext(query, orderedFacts);
  const branches = buildBranches(query, aliases, orderedFacts, clinicalContext, intent);
  const suggestions = includeSuggestions
    ? buildSuggestions(normalizedQuery, orderedFacts, intent)
    : [];
  const calculation =
    buildMedicationDoseCalculation(normalizedQuery, expansion, orderedFacts, clinicalContext) ??
    buildInfusionVolumeCalculation(normalizedQuery, clinicalContext);
  const analysis: QueryAnalysis = {
    originalQuery: query,
    normalizedQuery,
    intent,
    ...(calculation ? { calculation } : {}),
    facts: orderedFacts,
    clinicalContext,
    branches: branches.map(({ ftsQuery: _ftsQuery, ...branch }) => branch),
    suggestions,
    warnings: buildWarnings(normalizedQuery, orderedFacts),
  };
  const terms = [...new Set(branches.flatMap((branch) => branch.terms))].slice(0, MAX_FTS_TERMS);
  return {
    analysis,
    branches,
    aliasMatches: expansion.matches,
    terms,
    ftsQuery: branches[0]?.ftsQuery ?? '',
  };
}
