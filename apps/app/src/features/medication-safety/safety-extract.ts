/**
 * Which sentences of an instruction are about pregnancy, lactation and age limits, and what is
 * recorded for them (SAFE1). Pure: the build script feeds it documents read from the released
 * modules; the unit tests feed it small texts.
 */
import {
  canonicalSectionText,
  sectionChecksum,
  splitSentenceSpans,
} from '@/features/drug-interactions/interaction-text';
import {
  AGE_CATEGORIES,
  type AmountLimit,
  type CategoryLimit,
  extractAmountLimits,
  extractCategoryLimits,
  isListItem,
  normalizeForLimits,
} from './age-limits';
import { detectDosageForms } from './dosage-forms';
import {
  isPregnancyHeading,
  opensOtherSection,
  TOPIC_LACTATION,
  TOPIC_PREGNANCY,
  topicMatches,
  topicsOf,
} from './pregnancy-words';
import {
  LIMIT_AGE_BELOW,
  LIMIT_AGE_FROM,
  LIMIT_AGE_RANGE,
  LIMIT_CATEGORY,
  LIMIT_WEIGHT_BELOW,
  LIMIT_WEIGHT_FROM,
  LIMIT_WEIGHT_RANGE,
  ORIGIN_CAUTION,
  ORIGIN_CONTRAINDICATIONS,
  ORIGIN_DOSAGE,
  ORIGIN_INDICATIONS,
  ORIGIN_OTHER,
  ORIGIN_PREGNANCY_SECTION,
  ORIGIN_SPECIAL,
  packFlags,
} from './safety-index';

export interface SafetySectionInput {
  readonly id: string;
  readonly type: string | null;
  readonly title: string;
  /** The section's chunks in reading order (`original_text`). */
  readonly chunks: readonly string[];
}

export interface ExtractedSafety {
  readonly sections: readonly { readonly id: string; readonly checksum: string }[];
  readonly pl: readonly (readonly number[])[];
  readonly ag: readonly (readonly number[])[];
  /** The instruction has a section about pregnancy and lactation. */
  readonly hasPregnancySection: boolean;
}

/** Sentences kept from one pregnancy section: a section longer than this is cut, never summarised. */
const MAX_SENTENCES_PER_PREGNANCY_SECTION = 60;
const MAX_LIMITS_PER_SENTENCE = 6;
const MAX_ENTRIES_PER_KIND = 400;

const ORIGIN_BY_TYPE: Readonly<Record<string, number>> = {
  contraindications: ORIGIN_CONTRAINDICATIONS,
  caution: ORIGIN_CAUTION,
  'special-instructions': ORIGIN_SPECIAL,
  dosage: ORIGIN_DOSAGE,
};
const CHILD_HEADING = /(?<![\p{L}])(?:дет|возраст|подрост|педиатр|новорожд)/u;

function limitCode(item: AmountLimit): number {
  if (item.dimension === 'age') {
    return item.operator === 'below'
      ? LIMIT_AGE_BELOW
      : item.operator === 'from'
        ? LIMIT_AGE_FROM
        : LIMIT_AGE_RANGE;
  }
  return item.operator === 'below'
    ? LIMIT_WEIGHT_BELOW
    : item.operator === 'from'
      ? LIMIT_WEIGHT_FROM
      : LIMIT_WEIGHT_RANGE;
}

/** The flat numbers of a sentence's limits: `(matchStart, matchEnd, code, lower, upper)` each. */
function limitNumbers(
  base: number,
  amounts: readonly AmountLimit[],
  categories: readonly CategoryLimit[],
): readonly number[] {
  const numbers: number[] = [];
  for (const item of amounts) {
    numbers.push(
      base + item.start,
      base + item.end,
      limitCode(item),
      item.lower ?? 0,
      item.upper ?? 0,
    );
  }
  for (const item of categories) {
    numbers.push(
      base + item.start,
      base + item.end,
      LIMIT_CATEGORY,
      AGE_CATEGORIES.indexOf(item.category),
      0,
    );
  }
  return numbers;
}

/** Neutral sentences kept before the first sentence that names pregnancy or lactation. */
const LEADING_NEUTRAL_SENTENCES = 3;
/** Neutral sentences kept after a sentence that names it; more is a section the text ran on into. */
const TRAILING_NEUTRAL_SENTENCES = 2;

interface SentenceSlice {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
}

/** Words that may stand in a sub-heading next to the topic words («Период грудного вскармливания»). */
const HEADING_FILLER = new Set([
  'и',
  'в',
  'во',
  'период',
  'при',
  'применение',
  'время',
  'а',
  'также',
]);

/** A sentence that only names the topic is a sub-heading, not a statement. */
function isSubHeading(raw: string, matches: readonly { start: number; end: number }[]): boolean {
  let rest = '';
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    rest += ` ${raw.slice(cursor, match.start)}`;
    // The matches are word starts: the ending of the last word belongs to the match.
    let end = match.end;
    while (end < raw.length && /[\p{L}\p{N}]/u.test(raw.charAt(end))) end += 1;
    cursor = end;
  }
  rest += ` ${raw.slice(cursor)}`;
  const words = normalizeForLimits(rest).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length <= 3 && words.every((word) => HEADING_FILLER.has(word));
}

/**
 * How many characters of `raw` are the section's own title, repeated at the start of its text (the
 * PDF text of many instructions begins with the heading it sits under); 0 when it does not.
 */
export function titlePrefixLength(raw: string, title: string): number {
  const wanted = normalizeForLimits(title).replace(/[\s.:]+/gu, '');
  if (wanted.length < 6) return 0;
  const normalized = normalizeForLimits(raw);
  let matched = 0;
  for (let at = 0; at < normalized.length; at += 1) {
    const character = normalized.charAt(at);
    if (/[\s.:]/u.test(character)) continue;
    if (character !== wanted.charAt(matched)) return 0;
    matched += 1;
    if (matched === wanted.length) return at + 1;
  }
  return 0;
}

/**
 * The sentences of a section about pregnancy and lactation. A sentence that names neither takes the
 * topic of the sentence before it (or of the heading), so «Препарат противопоказан.» after
 * «Грудное вскармливание» belongs to lactation; the section ends where another section's heading
 * begins or where neutral sentences run on. The section's own title, repeated at the start of its
 * text, is not part of a sentence, and a sentence that is only a sub-heading («Беременность.»)
 * gives the topic to the sentences after it without being quoted itself.
 */
function pregnancySectionEntries(
  sentences: readonly SentenceSlice[],
  title: string,
): readonly number[][] {
  const entries: number[][] = [];
  const titleTopic = topicsOf(title);
  let current = titleTopic === 0 ? TOPIC_PREGNANCY | TOPIC_LACTATION : titleTopic;
  let neutralRun = 0;
  let topical = false;
  let first = true;
  for (const full of sentences) {
    if (entries.length >= MAX_SENTENCES_PER_PREGNANCY_SECTION) break;
    const skip = first ? titlePrefixLength(full.raw, title) : 0;
    first = false;
    const sentence: SentenceSlice =
      skip > 0 ? { start: full.start + skip, end: full.end, raw: full.raw.slice(skip) } : full;
    const trimmed = sentence.raw.replace(/^[\s.:;,-]+/u, '');
    const lead = sentence.raw.length - trimmed.length;
    const body: SentenceSlice = { start: sentence.start + lead, end: sentence.end, raw: trimmed };
    if (body.raw.replace(/[^\p{L}\p{N}]+/gu, '').length === 0) continue;
    const matches = topicMatches(body.raw);
    const forms = detectDosageForms(body.raw);
    if (matches.length > 0) {
      const topic = matches.reduce((mask, match) => mask | match.topic, 0);
      current = topic;
      neutralRun = 0;
      topical = true;
      if (isSubHeading(body.raw, matches)) continue;
      const firstMatch = matches[0];
      const lastMatch = matches[matches.length - 1];
      entries.push([
        -1,
        body.start,
        body.end,
        packFlags(topic, ORIGIN_PREGNANCY_SECTION, forms),
        body.start + (firstMatch?.start ?? 0),
        body.start + (lastMatch?.end ?? body.raw.length),
      ]);
      continue;
    }
    if (
      opensOtherSection(body.raw) ||
      /фертильност|зачати|бесплоди/u.test(normalizeForLimits(body.raw))
    )
      break;
    neutralRun += 1;
    if (neutralRun > (topical ? TRAILING_NEUTRAL_SENTENCES : LEADING_NEUTRAL_SENTENCES)) break;
    entries.push([
      -1,
      body.start,
      body.end,
      packFlags(current, ORIGIN_PREGNANCY_SECTION, forms),
      body.start,
      body.end,
    ]);
  }
  return entries;
}

export function extractSafety(sections: readonly SafetySectionInput[]): ExtractedSafety {
  const kept: { id: string; checksum: string }[] = [];
  const pl: number[][] = [];
  const ag: number[][] = [];
  let hasPregnancySection = false;
  for (const section of sections) {
    if (section.chunks.length === 0) continue;
    const pregnancySection = section.type === 'pregnancy' || isPregnancyHeading(section.title);
    const normalizedTitle = normalizeForLimits(section.title);
    const isLeafletBody = section.type === 'other' || section.type === 'treatment';
    const mentionOrigin = pregnancySection
      ? ORIGIN_PREGNANCY_SECTION
      : (ORIGIN_BY_TYPE[section.type ?? ''] ?? (section.type === 'other' ? ORIGIN_OTHER : null));
    const ageOrigin = pregnancySection
      ? null
      : (ORIGIN_BY_TYPE[section.type ?? ''] ??
        (section.type === 'indications'
          ? ORIGIN_INDICATIONS
          : isLeafletBody && CHILD_HEADING.test(normalizedTitle)
            ? ORIGIN_OTHER
            : null));
    if (mentionOrigin === null && ageOrigin === null) continue;
    const canonical = canonicalSectionText(section.chunks);
    const slices: SentenceSlice[] = splitSentenceSpans(canonical.text).map((span) => ({
      start: span.start,
      end: span.end,
      raw: canonical.text.slice(span.start, span.end),
    }));
    const sectionPl: number[][] = pregnancySection
      ? [...pregnancySectionEntries(slices, section.title)]
      : [];
    const sectionAg: number[][] = [];
    for (const slice of slices) {
      if (mentionOrigin !== null && !pregnancySection) {
        const matches = topicMatches(slice.raw);
        const first = matches[0];
        const last = matches[matches.length - 1];
        if (first && last) {
          const topic = matches.reduce((mask, match) => mask | match.topic, 0);
          sectionPl.push([
            -1,
            slice.start,
            slice.end,
            packFlags(topic, mentionOrigin, detectDosageForms(slice.raw)),
            slice.start + first.start,
            slice.start + last.end,
          ]);
        }
      }
      if (ageOrigin !== null) {
        const amounts = extractAmountLimits(slice.raw);
        const hasAge = amounts.some((item) => item.dimension === 'age');
        // An age group named without a number is read only where the section restricts or warns:
        // an indication («показан взрослым и детям») is no limit, and a child named next to
        // pregnancy or lactation («риск для новорожденных») is the child of the mother.
        const hasTopic = topicMatches(slice.raw).length > 0;
        const categories =
          hasAge || ageOrigin === ORIGIN_INDICATIONS
            ? []
            : extractCategoryLimits(slice.raw).filter(
                (item) => !hasTopic || isListItem(slice.raw, item.start, item.end),
              );
        const numbers = limitNumbers(slice.start, amounts, categories).slice(
          0,
          MAX_LIMITS_PER_SENTENCE * 5,
        );
        if (numbers.length > 0) {
          sectionAg.push([
            -1,
            slice.start,
            slice.end,
            packFlags(0, ageOrigin, detectDosageForms(slice.raw)),
            ...numbers,
          ]);
        }
      }
    }
    if (pregnancySection && sectionPl.length > 0) hasPregnancySection = true;
    if (sectionPl.length === 0 && sectionAg.length === 0) continue;
    const index = kept.length;
    kept.push({ id: section.id, checksum: sectionChecksum(canonical.text) });
    for (const entry of sectionPl) pl.push([index, ...entry.slice(1)]);
    for (const entry of sectionAg) ag.push([index, ...entry.slice(1)]);
  }
  return {
    sections: kept,
    pl: pl.slice(0, MAX_ENTRIES_PER_KIND),
    ag: ag.slice(0, MAX_ENTRIES_PER_KIND),
    hasPregnancySection,
  };
}
