/**
 * Finds names of substances and drug classes in instruction text (INT1).
 *
 * Matching is whole-word and inflection-aware: a text word matches a name word when both reduce to
 * the same light stem (`lightStemRussian`: «ибупрофена», «ибупрофеном» → «ибупрофен»). A name that
 * has several words must appear as consecutive words. A short name is never found inside a longer
 * word, so «боли» is not «Болиголов» and «головной» is not «Болиголов» either: words are compared
 * as a whole, never as substrings.
 */
import { lightStemRussian } from '@localmed/search-lexical';

export interface TextToken {
  readonly stem: string;
  readonly start: number;
  readonly end: number;
  /** The word is written with a capital first letter in the text. */
  readonly capitalized: boolean;
  /** The word as written, lower-cased. */
  readonly surface: string;
  /** The word follows a line-wrap hyphen («розува- статином»): its first half is the other token. */
  readonly afterHyphenBreak: boolean;
}

export interface NamePattern {
  /** What a hit means: `s:<substance key>`, `c:<ATC code>` or `a:<alias>`. */
  readonly target: string;
  readonly stems: readonly string[];
  /**
   * An adjective used as a class («слабительные», «гипотензивные средства») names the class only in
   * the plural; «гипотензивного действия» is an effect, not a class.
   */
  readonly pluralOnly?: boolean;
}

/** The plural endings of an adjective in any case. */
const PLURAL_ADJECTIVE_ENDING = /(?:ые|ие|ых|их|ыми|ими)$/u;

export interface Mention {
  readonly target: string;
  readonly start: number;
  readonly end: number;
}

const ROMAN_NUMERAL = /^(?:i{1,3}|iv|vi{1,3}|ix|xi{1,2})$/u;
const WORD = /[a-zа-яёβ]+/giu;

/** One name word reduced to its match stem; null for words that carry no name («II», «S», digits). */
export function nameWordStem(word: string): string | null {
  const lower = word.toLowerCase().replaceAll('ё', 'е').replaceAll('β', 'бета');
  if (lower.length < 2 || ROMAN_NUMERAL.test(lower)) return null;
  // Genitive and prepositional plural of an adjective («нестероидных», «кальциевых») meets the
  // nominative («нестероидные»): the light stemmer has no «ых/их».
  const adjective = lower.length >= 7 && /[ыи]х$/u.test(lower) ? lower.slice(0, -2) : lower;
  // Stemmed until nothing more is removed: «болиголов» (ends in «ов») and «болиголова» (ends in
  // «а») meet only on the second pass, and a stem is then the same for every case of the word.
  let stem = adjective;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = lightStemRussian(stem);
    if (next === stem) break;
    stem = next;
  }
  // «алкоголь» and «алкоголя» must meet: a soft or short-i ending that no suffix removed goes too.
  return stem.length >= 5 && /[ьй]$/u.test(stem) ? stem.slice(0, -1) : stem;
}

/** The words of a name or phrase as match stems, in order. */
export function nameStems(name: string): readonly string[] {
  const stems: string[] = [];
  for (const match of name.matchAll(WORD)) {
    const stem = nameWordStem(match[0]);
    if (stem) stems.push(stem);
  }
  return stems;
}

/** The words of a text with their offsets in the ORIGINAL string (the text is never rewritten). */
export function tokenizeForMatching(text: string): readonly TextToken[] {
  const tokens: TextToken[] = [];
  let previousEnd = -1;
  for (const match of text.matchAll(WORD)) {
    const stem = nameWordStem(match[0]);
    if (!stem) continue;
    const start = match.index ?? 0;
    const first = match[0].charAt(0);
    const gap = previousEnd < 0 ? '' : text.slice(previousEnd, start);
    tokens.push({
      stem,
      start,
      end: start + match[0].length,
      capitalized: first !== first.toLowerCase(),
      surface: match[0].toLowerCase(),
      afterHyphenBreak: /^-\s+$/u.test(gap) && first === first.toLowerCase(),
    });
    previousEnd = start + match[0].length;
  }
  return tokens;
}

/** A single-word name this short is too likely to be an ordinary word or an abbreviation. */
export const MIN_SINGLE_WORD_STEM_LENGTH = 4;

interface IndexedPattern {
  readonly target: string;
  readonly stems: readonly string[];
  readonly pluralOnly: boolean;
}

/** Anything that finds named substances or classes in a list of tokens. */
export interface MentionFinder {
  find(tokens: readonly TextToken[]): readonly Mention[];
}

/**
 * Several matchers read as one. A name inside a longer name found by another matcher is dropped:
 * «серотонина» in «ингибиторы обратного захвата серотонина» is part of the class, not a drug.
 */
export class CombinedMentionFinder implements MentionFinder {
  constructor(private readonly finders: readonly MentionFinder[]) {}

  find(tokens: readonly TextToken[]): readonly Mention[] {
    const all = this.finders
      .flatMap((finder) => finder.find(tokens))
      .toSorted(
        (left, right) =>
          left.start - right.start || right.end - right.start - (left.end - left.start),
      );
    return all.filter(
      (mention) =>
        !all.some(
          (other) =>
            other !== mention &&
            other.start <= mention.start &&
            other.end >= mention.end &&
            other.end - other.start > mention.end - mention.start,
        ),
    );
  }
}

export class MentionMatcher implements MentionFinder {
  private readonly byFirstStem = new Map<string, IndexedPattern[]>();

  constructor(patterns: Iterable<NamePattern>, options: { readonly minSingleStem?: number } = {}) {
    const minimum = options.minSingleStem ?? MIN_SINGLE_WORD_STEM_LENGTH;
    for (const pattern of patterns) {
      const { stems } = pattern;
      if (stems.length === 0) continue;
      if (stems.length === 1 && (stems[0] ?? '').length < minimum) continue;
      this.add(pattern);
      // «хлорид калия» is «калия хлорид»: two-word names are also known in the other order.
      if (stems.length === 2) this.add({ ...pattern, stems: [...stems].reverse() });
    }
    for (const list of this.byFirstStem.values())
      list.sort((a, b) => b.stems.length - a.stems.length);
  }

  private add(pattern: NamePattern): void {
    const first = pattern.stems[0] ?? '';
    const indexed: IndexedPattern = { ...pattern, pluralOnly: pattern.pluralOnly === true };
    const list = this.byFirstStem.get(first);
    if (list) list.push(indexed);
    else this.byFirstStem.set(first, [indexed]);
  }

  /** Every name found, longest first at each position; a hit consumes its words. */
  find(tokens: readonly TextToken[]): readonly Mention[] {
    const mentions: Mention[] = [];
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      const candidates = token ? this.byFirstStem.get(token.stem) : undefined;
      let consumed = 0;
      if (token && candidates && !token.afterHyphenBreak) {
        for (const candidate of candidates) {
          if (consumed > 0 && candidate.stems.length < consumed) break;
          if (!startsWithStems(tokens, index, candidate.stems)) continue;
          const last = tokens[index + candidate.stems.length - 1] ?? token;
          if (candidate.pluralOnly && !PLURAL_ADJECTIVE_ENDING.test(last.surface)) continue;
          consumed = candidate.stems.length;
          mentions.push({ target: candidate.target, start: token.start, end: last.end });
        }
      }
      index += Math.max(1, consumed);
    }
    return mentions;
  }
}

function startsWithStems(
  tokens: readonly TextToken[],
  index: number,
  stems: readonly string[],
): boolean {
  for (let offset = 0; offset < stems.length; offset += 1) {
    if (tokens[index + offset]?.stem !== stems[offset]) return false;
  }
  return true;
}

/** The distinct targets of a list of mentions, in order of first appearance. */
export function mentionTargets(mentions: readonly Mention[]): readonly string[] {
  return [...new Set(mentions.map((mention) => mention.target))];
}
