/**
 * Which of pregnancy and lactation a piece of an instruction is about (SAFE1): word starts of the
 * two topics. A sentence can be about both, or about neither («Применение препарата не
 * рекомендуется» inside a section that is about both).
 */
import { normalizeForLimits } from './age-limits';

export const TOPIC_PREGNANCY = 1;
export const TOPIC_LACTATION = 2;

const START = '(?<![\\p{L}\\d])';
const PREGNANCY = new RegExp(
  `${START}(?:беременн|беременеть|забеременеть|гестацион|триместр|на\\s+(?:ранних|поздних)\\s+сроках|плод(?:а|у|ом|е)?(?![\\p{L}])|эмбриотоксич|тератоген|фетотоксич)`,
  'u',
);
const LACTATION = new RegExp(
  `${START}(?:лактаци|грудн\\p{L}*\\s+(?:вскармлив|молок)|вскармлив|кормящ|кормлен\\p{L}*\\s+(?:ребенка\\s+)?грудью|корм(?:ить|ят|ите|ила|ит|ишь|ление)\\s+(?:\\p{L}+\\s+)?грудью|(?:женск|материнск)\\p{L}*\\s+молок|в\\s+молоко)`,
  'u',
);

/**
 * «См. раздел «Применение при беременности»»: a pointer to another section names the topic without
 * saying anything about it.
 */
const CROSS_REFERENCE = /(?:см\.?|раздел\p{L}*|разделе)\s*[«"][^»"]*$/u;

function inCrossReference(text: string, start: number): boolean {
  return CROSS_REFERENCE.test(text.slice(Math.max(0, start - 80), start));
}

export interface TopicMatch {
  readonly topic: number;
  readonly start: number;
  readonly end: number;
}

/** Every pregnancy and lactation word of `text`, in reading order. */
export function topicMatches(text: string): readonly TopicMatch[] {
  const normalized = normalizeForLimits(text);
  const found: TopicMatch[] = [];
  for (const [topic, pattern] of [
    [TOPIC_PREGNANCY, PREGNANCY],
    [TOPIC_LACTATION, LACTATION],
  ] as const) {
    for (const match of normalized.matchAll(new RegExp(pattern.source, 'gu'))) {
      if (inCrossReference(normalized, match.index)) continue;
      found.push({ topic, start: match.index, end: match.index + match[0].length });
    }
  }
  return found.toSorted((left, right) => left.start - right.start);
}

/** The topics of `text` as a mask. */
export function topicsOf(text: string): number {
  let mask = 0;
  for (const match of topicMatches(text)) mask |= match.topic;
  return mask;
}

/**
 * A heading that opens the section of an instruction about pregnancy and lactation, in the
 * leaflet's wording too («Беременность и грудное вскармливание», «Применение при беременности и в
 * период грудного вскармливания», «3. Беременность, грудное вскармливание и фертильность»).
 */
export function isPregnancyHeading(title: string): boolean {
  const normalized = normalizeForLimits(title)
    .replace(/^[\d\s.)-]+/u, '')
    .trim();
  if (normalized.length === 0 || normalized.length > 140) return false;
  return /^(?:применение\s+(?:препарата\s+)?(?:при|во\s+время)\s+беременност|беременност|грудное\s+вскармливание|лактаци|период\s+(?:беременност|лактаци|грудного)|фертильност\p{L}*,?\s+беременност|беременность\s+и)/u.test(
    normalized,
  );
}

/**
 * The standard heading names of the other sections of an instruction. A sentence that opens with
 * one of them ends the pregnancy part of a section that the text extraction ran on («Фертильность»,
 * «Влияние на способность управлять транспортными средствами», «Передозировка»).
 */
const OTHER_HEADING =
  /^(?:фертильност|управлени|влияние\s+на\s+способн|передозировк|побочн|форма\s+выпуска|взаимодействи|особые\s+указани|способ\s+применени|противопоказани|показани|условия\s+хранени|срок\s+годност|условия\s+отпуск|производител|меры\s+предосторожн|фармакологическ|фармакодинамик|фармакокинетик)/u;

/** Latin letters the OCR puts for Cyrillic ones in headings («Cпособ применения»). */
const LATIN_LOOKALIKES: Readonly<Record<string, string>> = {
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  k: 'к',
  t: 'т',
  m: 'м',
  h: 'н',
  b: 'в',
};

export function opensOtherSection(sentence: string): boolean {
  const folded = [...normalizeForLimits(sentence).trim()]
    .map((character) => LATIN_LOOKALIKES[character] ?? character)
    .join('');
  return OTHER_HEADING.test(folded);
}
