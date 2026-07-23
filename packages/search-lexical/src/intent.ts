import type { QueryIntent, SearchIntentKind } from '@localmed/contracts';

import { normalizeSurfaceText } from './normalize';

export interface IntentSignal<TIntent extends string> {
  readonly intent: TIntent;
  readonly pattern: RegExp;
  readonly weight: number;
  readonly label: string;
}

export interface ClassifiedIntent<TIntent extends string> {
  readonly primary: TIntent;
  readonly secondary: readonly TIntent[];
  readonly confidence: number;
  readonly matchedSignals: readonly string[];
  readonly scores: Readonly<Record<TIntent, number>>;
}

export function classifyIntent<TIntent extends string>(
  query: string,
  intents: readonly TIntent[],
  signals: readonly IntentSignal<TIntent>[],
  fallback: TIntent,
): ClassifiedIntent<TIntent> {
  const normalized = normalizeSurfaceText(query);
  const scores = Object.fromEntries(intents.map((intent) => [intent, 0])) as Record<
    TIntent,
    number
  >;
  const matched: { readonly intent: TIntent; readonly label: string; readonly weight: number }[] =
    [];

  for (const signal of signals) {
    signal.pattern.lastIndex = 0;
    if (!signal.pattern.test(normalized)) continue;
    scores[signal.intent] += signal.weight;
    matched.push({ intent: signal.intent, label: signal.label, weight: signal.weight });
  }

  const ranked = intents
    .map((intent) => ({ intent, score: scores[intent] }))
    .toSorted((left, right) => right.score - left.score);
  const first = ranked[0];
  if (!first || first.score <= 0) {
    return {
      primary: fallback,
      secondary: [],
      confidence: 0.2,
      matchedSignals: [],
      scores,
    };
  }
  const second = ranked[1];
  const margin = first.score - (second?.score ?? 0);
  const confidence = Math.min(0.99, 0.48 + first.score * 0.075 + margin * 0.035);
  return {
    primary: first.intent,
    secondary: ranked
      .slice(1)
      .filter((item) => item.score > 0 && item.score >= first.score * 0.45)
      .map((item) => item.intent),
    confidence,
    matchedSignals: matched
      .toSorted((left, right) => right.weight - left.weight)
      .map((item) => item.label)
      .filter((label, index, values) => values.indexOf(label) === index),
    scores,
  };
}

const MEDICAL_BASE_INTENTS = [
  'diagnosis',
  'treatment',
  'medication',
  'disease-reference',
  'care-guidance',
  'administrative-reference',
] as const satisfies readonly SearchIntentKind[];

type MedicalBaseIntent = (typeof MEDICAL_BASE_INTENTS)[number];

const MEDICAL_SIGNALS: readonly IntentSignal<MedicalBaseIntent>[] = [
  {
    intent: 'administrative-reference',
    pattern: /(?:групп[а-я]*\s+здоровья|мсэ|инвалидност|диспансерн[а-я]*\s+групп|справк[а-я]*)/u,
    weight: 5,
    label: 'административное правило',
  },
  {
    intent: 'care-guidance',
    pattern:
      /(?:вскармливан|прикорм|грудн[а-я]*\s+молок|смес[ьи]|питани[ея]\s+ребен|питани[ея]\s+ребён)/u,
    weight: 4.5,
    label: 'вскармливание и прикорм',
  },
  {
    intent: 'care-guidance',
    pattern: /(?:прибавк[а-я]*\s+(?:в\s+)?вес|развити[ея]\s+ребен|рост\s+и\s+вес)/u,
    weight: 4.2,
    label: 'рост и развитие',
  },
  {
    intent: 'treatment',
    pattern: /(?:лечени[ея]|лечить|терапи[яию]|тактик[а-я]*\s+лечен|неотложн[а-я]*\s+помощ)/u,
    weight: 4.5,
    label: 'прямой запрос лечения',
  },
  {
    intent: 'treatment',
    pattern: /(?:помощ[ьи]\s+при|что\s+делать\s+при|обработать\s+(?:ран|ожог|ссадин))/u,
    weight: 4.2,
    label: 'практическая помощь',
  },
  {
    intent: 'treatment',
    pattern: /(?:маз[ьи]\s+при|крем\s+при|гель\s+при|средств[оа]\s+при)/u,
    weight: 4,
    label: 'местное лечение',
  },
  {
    intent: 'medication',
    pattern: /(?:препарат[а-я]*|лекарств[а-я]*|таблетк[а-я]*|маз[ьи]|крем|гель)/u,
    weight: 3.2,
    label: 'поиск лекарственного средства',
  },
  {
    intent: 'medication',
    pattern: /(?:снизить|снижения|повысить|купировать)\s+(?:давлен|температур|боль|тошнот)/u,
    weight: 2.2,
    label: 'фармакологическая цель',
  },
  {
    intent: 'diagnosis',
    pattern:
      /(?:как\s+диагностировать\s+дальше|что\s+(?:обследовать|проверить)|какие\s+(?:анализы|обследования)|диагностическ[а-я]*\s+тактик)/u,
    weight: 5,
    label: 'следующий этап диагностики',
  },
  {
    intent: 'diagnosis',
    pattern: /(?:как\s+отличить|чем\s+отличается|дифференциальн[а-я]*\s+диагноз\s+с)/u,
    weight: 5,
    label: 'дифференциальный вопрос',
  },
  {
    intent: 'diagnosis',
    pattern: /(?:диагноз|дифференциальн|что\s+это|на\s+что\s+похож|причин[а-я]*\s+симптом)/u,
    weight: 4.5,
    label: 'прямой диагностический вопрос',
  },
  {
    intent: 'diagnosis',
    pattern: /(?:появил[а-я]*|жалоб[а-я]*|болеет|дн(?:я|ей)?\s+назад|час(?:а|ов)?\s+назад)/u,
    weight: 2.3,
    label: 'описание клинического случая',
  },
  {
    intent: 'diagnosis',
    pattern:
      /(?:сып[а-я]*|каш[а-я]*|лихорад[а-я]*|боль|рвот[а-я]*|диаре[а-я]*|одышк[а-я]*|зуд[а-я]*|вздут[а-я]*|метеоризм|судорог[а-я]*|ригидн[а-я]*|сознани[а-я]*)/u,
    weight: 1.6,
    label: 'симптомы',
  },
  {
    intent: 'disease-reference',
    pattern:
      /(?:что\s+такое|классификац|степен[ьи]\s+тяжест|прогноз|осложнен|течени[ея]\s+болезн)/u,
    weight: 3.8,
    label: 'справка о заболевании',
  },
  {
    intent: 'disease-reference',
    pattern: /(?:симптом[ыа]|признак[иа]|клиническ[а-я]*\s+картин)/u,
    weight: 2.2,
    label: 'справка о проявлениях',
  },
];

function hasAge(normalized: string): boolean {
  return /\b\d{1,3}\s*(?:дн|день|дня|дней|недел|месяц|месяца|месяцев|год|года|лет)\b/u.test(
    normalized,
  );
}

function hasNamedClinicalTarget(normalized: string): boolean {
  return /(?:лечени[ея]|терапи[яию]|при|для)\s+[а-яa-z][а-яa-z-]{3,}/u.test(normalized);
}

export function classifyMedicalQueryIntent(query: string): QueryIntent {
  const normalized = normalizeSurfaceText(query)
    .replace(/\bконтоля\b/gu, 'контроля')
    .replace(/\bссаденой\b/gu, 'ссадиной');
  const classified = classifyIntent(normalized, MEDICAL_BASE_INTENTS, MEDICAL_SIGNALS, 'diagnosis');
  const scores = { ...classified.scores };

  if (hasAge(normalized) && /(?:появил|жалоб|болеет|сып|кашл|боль|температур)/u.test(normalized)) {
    scores.diagnosis += 1.4;
  }
  if (/\b(?:и|плюс)\b.*(?:лечени|диагноз)|(?:диагноз).*\bи\b.*(?:лечени)/u.test(normalized)) {
    scores.diagnosis += 2;
    scores.treatment += 2;
  }

  const ranked = MEDICAL_BASE_INTENTS.map((intent) => ({ intent, score: scores[intent] })).toSorted(
    (left, right) => right.score - left.score,
  );
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first.score <= 0) {
    return {
      primary: 'unknown',
      secondary: [],
      confidence: 0.2,
      matchedSignals: classified.matchedSignals,
      needsClarification: true,
    };
  }

  const explicitlyMixed =
    Boolean(second) &&
    first.score >= 3 &&
    (second?.score ?? 0) >= 3 &&
    Math.abs(first.score - (second?.score ?? 0)) <= 0.35;
  const primary: SearchIntentKind = explicitlyMixed ? 'mixed' : first.intent;
  const secondary = ranked
    .filter(
      (item) => item.intent !== first.intent && item.score > 0 && item.score >= first.score * 0.45,
    )
    .map((item) => item.intent);
  if (explicitlyMixed && second) secondary.unshift(first.intent, second.intent);

  const margin = first.score - (second?.score ?? 0);
  const confidence = Math.min(0.99, 0.5 + first.score * 0.065 + Math.max(0, margin) * 0.03);
  const broadMedication =
    primary === 'medication' &&
    /(?:^|\s)(?:препарат[а-я]*|лекарств[а-я]*|средств[оа])(?:\s|$)/u.test(normalized);
  const needsClarification =
    broadMedication ||
    (primary === 'treatment' && !hasNamedClinicalTarget(normalized)) ||
    (primary === 'administrative-reference' &&
      !/(?:тяжест|осложнен|ремисс|обострен)/u.test(normalized)) ||
    (primary === 'diagnosis' && normalized.length < 12) ||
    /(?:менингит.*энцефалит|энцефалит.*менингит|менингоэнцефалит)/u.test(normalized);

  return {
    primary,
    secondary: [...new Set(secondary)].filter((intent) => intent !== primary),
    confidence,
    matchedSignals: classified.matchedSignals,
    needsClarification,
  };
}
