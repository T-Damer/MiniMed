/**
 * Marks the words in a quoted sentence that name the drug asked about (INT1): the substance under
 * its names, or the words of the class the drug belongs to. The same matcher that found the
 * sentence at build time, restricted to what the tool is looking for.
 */
import type { ClassPhrase } from './class-phrases';
import type { InteractionIndex } from './interaction-index';
import {
  MentionMatcher,
  type NamePattern,
  nameStems,
  tokenizeForMatching,
} from './mention-matcher';
import { SUBSTANCE_ALIASES, stemsOfKey } from './substance-names';

export interface TextSegment {
  readonly text: string;
  readonly hit: boolean;
}

export function highlightPatterns(
  index: InteractionIndex,
  targets: ReadonlySet<number>,
  phrases: readonly ClassPhrase[],
): readonly NamePattern[] {
  const patterns: NamePattern[] = [];
  const classCodes = new Set<string>();
  for (const targetIndex of targets) {
    const target = index.asset.targets[targetIndex];
    if (!target) continue;
    if (target.startsWith('s:')) {
      const key = target.slice(2);
      patterns.push({ target, stems: stemsOfKey(key) });
      for (const alias of SUBSTANCE_ALIASES) {
        if (alias.key === key) patterns.push({ target, stems: nameStems(alias.text) });
      }
    } else {
      classCodes.add(target.slice(2));
    }
  }
  for (const phrase of phrases) {
    for (const code of phrase.codes) {
      if (classCodes.has(code)) patterns.push({ target: `c:${code}`, stems: phrase.stems });
    }
  }
  return patterns;
}

/** Splits `text` into plain and marked runs; no pattern gives one plain run. */
export function highlightSegments(
  text: string,
  patterns: readonly NamePattern[],
): readonly TextSegment[] {
  if (patterns.length === 0) return [{ text, hit: false }];
  const matcher = new MentionMatcher(patterns, { minSingleStem: 3 });
  const mentions = matcher.find(tokenizeForMatching(text));
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start < cursor) continue;
    if (mention.start > cursor)
      segments.push({ text: text.slice(cursor, mention.start), hit: false });
    segments.push({ text: text.slice(mention.start, mention.end), hit: true });
    cursor = mention.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}
