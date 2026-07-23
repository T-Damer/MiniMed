import type {
  QueryAnalysis,
  QueryBranch,
  QueryBranchKind,
  QueryFact,
  QueryFactKind,
  QueryFactPolarity,
  QueryIntent,
  SearchSuggestion,
  SearchSuggestionField,
  TextRange,
} from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';

import { expandAliases } from './aliases';
import { classifyMedicalQueryIntent } from './intent';
import { lightStemRussian, normalizeSurfaceText, tokenize } from './normalize';
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
};

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

function addFact(
  facts: QueryFact[],
  input: {
    readonly kind: QueryFactKind;
    readonly label: string;
    readonly value: string;
    readonly normalizedValue?: string;
    readonly unit?: string | null;
    readonly polarity?: QueryFactPolarity;
    readonly start: number;
    readonly end: number;
  },
): void {
  if (input.end <= input.start) return;
  const duplicate = facts.some(
    (fact) =>
      fact.kind === input.kind && fact.range.start === input.start && fact.range.end === input.end,
  );
  if (duplicate) return;
  facts.push({
    id: factId(input.kind, input.start, input.end),
    kind: input.kind,
    label: input.label,
    value: input.value.trim(),
    normalizedValue: normalizeSurfaceText(input.normalizedValue ?? input.value),
    unit: input.unit ?? null,
    polarity: input.polarity ?? 'positive',
    range: range(input.start, input.end),
  });
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
    [/(?:мальчик|мальчику|мужчина|мужчине|пациент|пол\s*[:=]?\s*мужской)/iu, 'мужской'],
    [/(?:девочка|девочке|женщина|женщине|пациентка|пол\s*[:=]?\s*женский)/iu, 'женский'],
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

function extractAge(query: string, facts: QueryFact[]): void {
  const patterns = [
    /возраст(?:ом)?\s*[:=]?\s*(\d{1,3})\s*(дн(?:я|ей)?|день|дней|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(?:мальчик|мальчику|девочка|девочке|ребенок|ребёнок|ребенку|ребёнку|пациент|пациентка|мужчина|женщина|младенец)\s*,?\s*(\d{1,3})\s*(дн(?:я|ей)?|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*,?\s*(?:мальчик|девочка|ребенок|ребёнок|пациент|пациентка|мужчина|женщина|младенец)/giu,
    /(?:у\s+)?(?:ребенка|ребёнка|ребенку|ребёнку|мальчика|девочки|младенца)\s+(?:в\s+возрасте\s+|в\s+)?(\d{1,3})\s*(дн(?:я|ей)?|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(\d{1,3})\s*[- ]\s*(?:летн|месячн|дневн)[а-я]*/giu,
  ] as const;
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const start = match.index ?? 0;
      const amount = match[1] ?? '';
      const unit = match[2] ?? (match[0].includes('месяч') ? 'месяцев' : 'лет');
      addFact(facts, {
        kind: 'age',
        label: 'Возраст',
        value: match[0],
        normalizedValue: `${amount} ${unit}`.trim(),
        unit,
        start,
        end: start + match[0].length,
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
    /(?:температур[а-я]*|лихорадк[а-я]*|t)\s*(?:до|около|примерно|=|:)?\s*((?:3[0-9]|4[0-3])(?:[.,]\d)?)\s*(?:°\s*)?[cс]?/giu,
    /((?:3[5-9]|4[0-3])(?:[.,]\d)?)\s*°\s*[cс]?/giu,
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
  const patterns = [
    /(?:в\s+течение|уже|болеет|длительность\s*[:=]?|жалобы\s+в\s+течение)?\s*(\d{1,3})\s*(час(?:а|ов)?|дн(?:я|ей)?|день|дней|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?)\s*(?:назад|подряд)?/giu,
    /(?:первый|второй|третий|четвертый|четвёртый|пятый|шестой|седьмой)\s+день/giu,
    /(?:сегодня|вчера|позавчера|несколько\s+дней|около\s+недели)/giu,
  ] as const;
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const start = match.index ?? 0;
      const matchRange = range(start, start + match[0].length);
      if (ageRanges.some((ageRange) => overlaps(ageRange, matchRange))) continue;
      addFact(facts, {
        kind: 'duration',
        label: 'Длительность',
        value: match[0],
        unit: match[2] ?? null,
        start: matchRange.start,
        end: matchRange.end,
      });
    }
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
      pattern: /(?:ад|давление)\s*[:=]?\s*(\d{2,3})\s*\/\s*(\d{2,3})/giu,
      label: 'АД',
      unit: 'мм рт. ст.',
      normalizer: (match) => `${match[1] ?? ''}/${match[2] ?? ''}`,
    },
  ];
  for (const item of patterns) {
    for (const match of query.matchAll(item.pattern)) {
      const start = match.index ?? 0;
      addFact(facts, {
        kind: 'measurement',
        label: item.label,
        value: match[0],
        normalizedValue: item.normalizer?.(match) ?? match[0],
        unit: match[2] && item.label === 'Масса' ? match[2] : item.unit,
        start,
        end: start + match[0].length,
      });
    }
  }
}

function trimPrefixNegation(captured: string, aliases: readonly AliasRecord[]): string {
  const normalizedCaptured = normalizeSurfaceText(captured);
  let boundary = captured.length;
  for (const alias of aliases) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const index = normalizedCaptured.indexOf(normalizedAlias);
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
    /(?:без|нет|отрицает|не\s+было|не\s+отмечается|не\s+отмечает|не\s+наблюдается)\s+([^,.;:\n]{2,80})/giu;
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
    /([^,.;:\n]{2,50}?)\s+(?:нет|не\s+было|не\s+отмечается|не\s+наблюдается)(?=[,.;:\n]|$)/giu;
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
  kind: QueryFactKind,
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
  aliases: readonly AliasRecord[],
  facts: QueryFact[],
): void {
  const normalizedQuery = normalizeSurfaceText(query);
  for (const alias of aliases) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const index = normalizedQuery.indexOf(normalizedAlias);
    if (index < 0) continue;
    const kindByCategory: Readonly<Record<string, QueryFactKind>> = {
      symptom: 'symptom',
      investigation: 'investigation',
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
    addFact(facts, {
      kind,
      label: alias.category === 'medication' ? 'Препарат' : 'Распознанный термин',
      value: query.slice(index, index + alias.alias.length),
      normalizedValue: alias.canonicalTerm,
      start: index,
      end: index + alias.alias.length,
    });
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

function termsWithStems(values: readonly string[]): readonly string[] {
  const terms = new Set<string>();
  for (const value of values) {
    for (const token of tokenize(value)) {
      if (/^\d+$/u.test(token) || STRUCTURAL_TERMS.has(token)) continue;
      terms.add(token);
      terms.add(lightStemRussian(token));
      for (const expansion of QUERY_EXPANSIONS[token] ?? []) {
        terms.add(expansion);
        terms.add(lightStemRussian(expansion));
      }
    }
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, MAX_FTS_TERMS);
}

function makeBranch(
  id: string,
  kind: QueryBranchKind,
  label: string,
  query: string,
  values: readonly string[],
  weight: number,
): LexicalQueryBranchPlan | null {
  const terms = termsWithStems(values);
  if (terms.length === 0) return null;
  return {
    id,
    kind,
    label,
    query,
    normalizedQuery: normalizeSurfaceText(query),
    terms,
    weight,
    ftsQuery: terms.map(ftsToken).join(' OR '),
  };
}

function termsInsideNegativeFacts(facts: readonly QueryFact[]): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const fact of facts) {
    if (fact.kind !== 'negative-finding') continue;
    for (const term of termsWithStems([fact.normalizedValue])) terms.add(term);
  }
  return terms;
}

function buildBranches(
  query: string,
  aliases: readonly AliasRecord[],
  facts: readonly QueryFact[],
  intent: QueryIntent,
): readonly LexicalQueryBranchPlan[] {
  const normalizedQuery = normalizeSurfaceText(query);
  const expansion = expandAliases(normalizedQuery, aliases);
  const negativeTerms = termsInsideNegativeFacts(facts);
  const originalTerms = termsWithStems([normalizedQuery]);
  const positiveTerms = originalTerms.filter((term) => !negativeTerms.has(term));
  const negativeRanges = facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.range);
  const canonicalTerms = termsWithStems(
    expansion.matchedAliases
      .filter((alias) => {
        const index = normalizedQuery.indexOf(normalizeSurfaceText(alias.alias));
        if (index < 0) return false;
        const aliasRange = range(index, index + normalizeSurfaceText(alias.alias).length);
        return !negativeRanges.some((negativeRange) => overlaps(negativeRange, aliasRange));
      })
      .map((alias) => alias.canonicalTerm),
  );
  const clinicalTerms = [...new Set([...positiveTerms, ...canonicalTerms])].slice(0, MAX_FTS_TERMS);
  const branches: LexicalQueryBranchPlan[] = [];
  const clinicalWeight = intent.primary === 'diagnosis' ? 1.32 : 1.18;
  const clinical = makeBranch(
    'clinical',
    'clinical',
    'Клинические признаки',
    query,
    clinicalTerms,
    clinicalWeight,
  );
  if (clinical) branches.push(clinical);

  const intentSpec = INTENT_BRANCH[intent.primary];
  if (intent.primary !== 'unknown') {
    const branch = makeBranch(
      'intent',
      'intent',
      intentSpec.label,
      query,
      [normalizedQuery, intentSpec.terms],
      intentSpec.weight,
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
    );
    if (nextDiagnostics) branches.unshift(nextDiagnostics);
  }
  return branches.slice(0, MAX_BRANCHES);
}

export function analyzeClinicalQuery(
  query: string,
  aliases: readonly AliasRecord[],
  includeSuggestions = true,
): ClinicalQueryPlan {
  const normalizedQuery = normalizeSurfaceText(query);
  const intent = classifyMedicalQueryIntent(query);
  const facts: QueryFact[] = [];
  extractSex(query, facts);
  extractAge(query, facts);
  extractTemperature(query, facts);
  extractDuration(query, facts);
  extractMeasurements(query, facts);
  extractNegations(query, aliases, facts);
  extractSymptomExpressions(query, facts);
  extractSymptoms(query, facts);
  extractAliasFacts(query, aliases, facts);
  extractKnownTerms(query, facts);
  extractMedicationPhrase(query, facts);
  const orderedFacts = facts.toSorted((left, right) => left.range.start - right.range.start);
  const branches = buildBranches(query, aliases, orderedFacts, intent);
  const expansion = expandAliases(normalizedQuery, aliases);
  const suggestions = includeSuggestions
    ? buildSuggestions(normalizedQuery, orderedFacts, intent)
    : [];
  const analysis: QueryAnalysis = {
    originalQuery: query,
    normalizedQuery,
    intent,
    facts: orderedFacts,
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
