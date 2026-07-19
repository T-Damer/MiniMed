import type { QueryFactKind, QueryFactPolarity, TextRange } from '@localmed/contracts';

import { normalizeSurfaceText } from './normalize';

export interface ClinicalFactCandidate {
  readonly kind: QueryFactKind;
  readonly label: string;
  readonly value: string;
  readonly normalizedValue?: string;
  readonly unit?: string | null;
  readonly polarity?: QueryFactPolarity;
  readonly start: number;
  readonly end: number;
}

interface SymptomRule {
  readonly pattern: RegExp;
  readonly label: string;
  readonly canonical: string;
}

const WORD_LEFT = '(?<![\\p{L}\\p{N}_])';
const WORD_RIGHT = '(?![\\p{L}\\p{N}_])';

function wordPattern(source: string): RegExp {
  return new RegExp(`${WORD_LEFT}(?:${source})${WORD_RIGHT}`, 'giu');
}

const SYMPTOM_RULES: readonly SymptomRule[] = [
  {
    pattern: wordPattern('кашель|кашля|кашлем|кашляет|кашляют|кашлял(?:а|и)?|кашляю'),
    label: 'Кашель',
    canonical: 'кашель',
  },
  {
    pattern: wordPattern('температурит|лихорадит|лихорадка|жар'),
    label: 'Лихорадка',
    canonical: 'лихорадка',
  },
  {
    pattern: wordPattern('рвота|рвало|вырвало|тошнит|тошнота'),
    label: 'Рвота или тошнота',
    canonical: 'рвота тошнота',
  },
  {
    pattern: wordPattern('диарея|понос|жидкий\\s+стул'),
    label: 'Диарея',
    canonical: 'диарея жидкий стул',
  },
  {
    pattern: wordPattern('сыпь|обсыпало|высыпания?'),
    label: 'Сыпь',
    canonical: 'сыпь экзантема',
  },
  {
    pattern: wordPattern(
      'одышка|задыхается|тяжело\\s+дышит|часто\\s+дышит|учащенно\\s+дышит|учащённо\\s+дышит|не\\s+хватает\\s+воздуха',
    ),
    label: 'Нарушение дыхания',
    canonical: 'одышка тахипноэ дыхательная недостаточность',
  },
  {
    pattern: wordPattern('свистит\\s+при\\s+дыхании|свистящее\\s+дыхание|свистящие\\s+хрипы'),
    label: 'Свистящее дыхание',
    canonical: 'свистящее дыхание хрипы',
  },
  {
    pattern: wordPattern('болит|боль|болезненност[ьи]'),
    label: 'Боль',
    canonical: 'боль',
  },
  {
    pattern: wordPattern('больно\\s+писать|рези\\s+при\\s+мочеиспускании|дизурия'),
    label: 'Дизурия',
    canonical: 'дизурия болезненное мочеиспускание',
  },
  {
    pattern: wordPattern('вялость|вялый|вялая|слабость|слабый|слабая'),
    label: 'Вялость',
    canonical: 'вялость слабость',
  },
  {
    pattern: wordPattern('судороги|судорожный\\s+приступ'),
    label: 'Судороги',
    canonical: 'судороги',
  },
];

function overlaps(left: TextRange, right: TextRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function isNegative(range: TextRange, negativeRanges: readonly TextRange[]): boolean {
  return negativeRanges.some((negativeRange) => overlaps(range, negativeRange));
}

export function extractSupplementalClinicalFacts(
  query: string,
  negativeRanges: readonly TextRange[] = [],
): readonly ClinicalFactCandidate[] {
  const candidates: ClinicalFactCandidate[] = [];

  const ageBeforeSex =
    /(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*(?=[,;]\s*(?:мальчик|девочка|ребенок|ребёнок|пациент|пациентка|мужчина|женщина))/giu;
  for (const match of query.matchAll(ageBeforeSex)) {
    const start = match.index ?? 0;
    candidates.push({
      kind: 'age',
      label: 'Возраст',
      value: match[0].trim(),
      normalizedValue: `${match[1] ?? ''} ${match[2] ?? ''}`.trim(),
      unit: match[2] ?? null,
      start,
      end: start + match[0].trimEnd().length,
    });
  }

  for (const rule of SYMPTOM_RULES) {
    for (const match of query.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const factRange = { start, end: start + match[0].length };
      if (isNegative(factRange, negativeRanges)) continue;
      candidates.push({
        kind: 'symptom',
        label: rule.label,
        value: match[0],
        normalizedValue: normalizeSurfaceText(rule.canonical),
        start: factRange.start,
        end: factRange.end,
      });
    }
  }

  return candidates;
}
