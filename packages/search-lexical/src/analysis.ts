import type {
  QueryAnalysis,
  QueryBranch,
  QueryBranchKind,
  QueryFact,
  QueryFactKind,
  QueryFactPolarity,
  SearchSuggestion,
  SearchSuggestionField,
  TextRange,
} from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';

import { expandAliases } from './aliases';
import { lightStemRussian, normalizeSurfaceText, tokenize } from './normalize';

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

const MAX_FTS_TERMS = 28;
const MAX_BRANCHES = 7;

const STRUCTURAL_TERMS = new Set([
  'возраст',
  'пол',
  'мальчик',
  'девочка',
  'ребенок',
  'ребёнок',
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
  age: 'Возраст меняет применимость рекомендаций и маршрутизацию.',
  sex: 'Пол может сузить дифференциальный поиск.',
  duration: 'Время начала и динамика помогают выбрать нужный раздел.',
  temperature: 'Укажите максимум и текущую температуру, если измерялась.',
  medications: 'Добавьте уже принятые препараты и эффект от них.',
  investigations: 'Добавьте анализы, осмотр и инструментальные исследования.',
  epidemiology: 'Поездки, контакты, укусы и регион иногда меняют ветку поиска.',
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
  const patterns: readonly [RegExp, string, string][] = [
    [/(?:мальчик|мальчику|мужчина|мужчине|пациент|пол\s*[:=]?\s*мужской)/giu, 'Пол', 'мужской'],
    [/(?:девочка|девочке|женщина|женщине|пациентка|пол\s*[:=]?\s*женский)/giu, 'Пол', 'женский'],
  ];
  for (const [pattern, label, normalizedValue] of patterns) {
    const match = query.matchAll(pattern).next().value;
    if (!match) continue;
    const matchStart = match.index ?? 0;
    addFact(facts, {
      kind: 'sex',
      label,
      value: match[0],
      normalizedValue,
      start: matchStart,
      end: matchStart + match[0].length,
    });
    return;
  }
}

function extractAge(query: string, facts: QueryFact[]): void {
  const explicitPatterns = [
    /возраст(?:ом)?\s*[:=]?\s*(\d{1,3})\s*(дн(?:я|ей)?|день|дней|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(?:мальчик|мальчику|девочка|девочке|ребенок|ребёнок|ребенку|ребёнку|пациент|пациентка|мужчина|женщина|младенец)\s*,?\s*(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)/giu,
    /(\d{1,3})\s*[- ]\s*летн[а-я]*/giu,
  ] as const;

  for (const pattern of explicitPatterns) {
    for (const match of query.matchAll(pattern)) {
      const matchStart = match.index ?? 0;
      addFact(facts, {
        kind: 'age',
        label: 'Возраст',
        value: match[0],
        normalizedValue: `${match[1] ?? ''} ${match[2] ?? 'лет'}`.trim(),
        unit: match[2] ?? 'лет',
        start: matchStart,
        end: matchStart + match[0].length,
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
      const matchStart = match.index ?? 0;
      const value = (match[1] ?? match[0]).replace(',', '.');
      addFact(facts, {
        kind: 'temperature',
        label: 'Температура',
        value: match[0],
        normalizedValue: value,
        unit: '°C',
        start: matchStart,
        end: matchStart + match[0].length,
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
      const matchStart = match.index ?? 0;
      const matchRange = range(matchStart, matchStart + match[0].length);
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
      const matchStart = match.index ?? 0;
      addFact(facts, {
        kind: 'measurement',
        label: item.label,
        value: match[0],
        normalizedValue: item.normalizer?.(match) ?? match[0],
        unit: match[2] && item.label === 'Масса' ? match[2] : item.unit,
        start: matchStart,
        end: matchStart + match[0].length,
      });
    }
  }
}

function trimPrefixNegation(captured: string, aliases: readonly AliasRecord[]): string {
  const normalizedCaptured = normalizeSurfaceText(captured);
  let boundary = captured.length;

  // A common terse notation is `лихорадка без очага дизурия`: `дизурия` starts a new positive
  // concept rather than belonging to the negated phrase. Stop before a known concept unless it is
  // explicitly connected to the negative list with `и`, `или`, `либо`, or a comma.
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

  // A temporal reassessment phrase ends the negated finding. In `нет ответа на антибиотик через
  // 72 часа при пневмонии`, only the absent treatment response is negative; the diagnosis after
  // the time boundary must remain searchable.
  const temporalBoundary = normalizedCaptured.search(
    /\s+(?:через|спустя)\s+\d+(?:[.,]\d+)?\s*(?:минут[а-я]*|час[а-я]*|дн(?:я|ей|и)|сут(?:ок|ки)?|недел[а-я]*|месяц[а-я]*)(?=\s|$)/u,
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
  return warnings;
}

function suggestion(
  field: SearchSuggestionField,
  label: string,
  insertion: string,
  priority: number,
): SearchSuggestion {
  return {
    id: field,
    field,
    label,
    insertion,
    detail: FIELD_DETAILS[field],
    priority,
    kind: 'missing-field',
  };
}

function buildSuggestions(
  normalizedQuery: string,
  facts: readonly QueryFact[],
): readonly SearchSuggestion[] {
  const suggestions: SearchSuggestion[] = [];
  if (!hasFact(facts, 'age')) suggestions.push(suggestion('age', 'Возраст', 'Возраст: ', 100));
  if (!hasFact(facts, 'duration')) {
    suggestions.push(suggestion('duration', 'Длительность', 'Длительность: ', 95));
  }
  if (!hasFact(facts, 'temperature')) {
    suggestions.push(suggestion('temperature', 'Температура', 'Температура: ', 85));
  }
  if (!hasFact(facts, 'sex')) suggestions.push(suggestion('sex', 'Пол', 'Пол: ', 70));
  if (!hasFact(facts, 'investigation')) {
    suggestions.push(suggestion('investigations', 'Обследования', 'Обследования: ', 65));
  }
  if (!hasFact(facts, 'medication')) {
    suggestions.push(suggestion('medications', 'Препараты', 'Препараты: ', 55));
  }
  if (
    /(?:сып|лихорад|инфекц|укус|диаре|кашл|контакт|клещ)\w*/u.test(normalizedQuery) &&
    !hasFact(facts, 'epidemiology')
  ) {
    suggestions.push(suggestion('epidemiology', 'Контакты и поездки', 'Эпидемиология: ', 60));
  }
  return suggestions.toSorted((left, right) => right.priority - left.priority).slice(0, 6);
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

  const clinical = makeBranch(
    'clinical',
    'clinical',
    'Клинические признаки',
    query,
    clinicalTerms,
    1.25,
  );
  if (clinical) branches.push(clinical);

  const original = makeBranch(
    'original',
    'original',
    'Исходная формулировка',
    query,
    positiveTerms,
    1,
  );
  if (original && original.ftsQuery !== clinical?.ftsQuery) branches.push(original);

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

  return branches.slice(0, MAX_BRANCHES);
}

export function analyzeClinicalQuery(
  query: string,
  aliases: readonly AliasRecord[],
  includeSuggestions = true,
): ClinicalQueryPlan {
  const normalizedQuery = normalizeSurfaceText(query);
  const facts: QueryFact[] = [];
  extractSex(query, facts);
  extractAge(query, facts);
  extractTemperature(query, facts);
  extractDuration(query, facts);
  extractMeasurements(query, facts);
  extractNegations(query, aliases, facts);
  extractAliasFacts(query, aliases, facts);
  extractKnownTerms(query, facts);
  extractMedicationPhrase(query, facts);
  const orderedFacts = facts.toSorted((left, right) => left.range.start - right.range.start);
  const branches = buildBranches(query, aliases, orderedFacts);
  const expansion = expandAliases(normalizedQuery, aliases);
  const suggestions = includeSuggestions ? buildSuggestions(normalizedQuery, orderedFacts) : [];
  const analysis: QueryAnalysis = {
    originalQuery: query,
    normalizedQuery,
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
