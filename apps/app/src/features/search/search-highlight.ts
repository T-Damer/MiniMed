/**
 * Which words of a result snippet are marked (SRCH1, QA 10-14: «J05» marked «Острые респираторные
 * инфекции», marks stopped in the middle of a word). The core marks every term the search matched,
 * alias expansions and word stems included; the reader of a result expects the words they typed.
 * Each mark is stretched to its whole word and kept only if the word is a form of a typed word (or
 * of the query the search was rewritten or corrected to); a code («J05») keeps exactly the typed
 * characters, because the rest of «J05AX13» is no word the reader typed.
 */
import type { SearchResponse, SearchResult, TextRange } from '@localmed/contracts';
import { normalizeSurfaceText } from '@localmed/search-lexical';

import { isFormOfTypedWord, type TypedWord, typedWord } from './typed-word';

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const WORDS = /[\p{L}\p{N}]+/gu;

function wordsOfQuery(texts: readonly string[]): readonly TypedWord[] {
  const words = new Map<string, TypedWord>();
  for (const text of texts) {
    for (const match of normalizeSurfaceText(text).matchAll(WORDS)) {
      const word = match[0];
      if (!words.has(word)) words.set(word, typedWord(word));
    }
  }
  return [...words.values()];
}

function wordBounds(text: string, range: TextRange): TextRange {
  let start = range.start;
  let end = range.end;
  while (start > 0 && WORD_CHARACTER.test(text.charAt(start - 1))) start -= 1;
  while (end < text.length && WORD_CHARACTER.test(text.charAt(end))) end += 1;
  return { start, end };
}

/** The ranges of a snippet that mark a typed word, each stretched to the whole word. */
export function refineHighlightRanges(
  snippet: string,
  ranges: readonly TextRange[],
  queryTexts: readonly string[],
): readonly TextRange[] {
  const typedWords = wordsOfQuery(queryTexts);
  if (typedWords.length === 0 || ranges.length === 0) return [];
  const kept: TextRange[] = [];
  for (const range of ranges) {
    if (range.start < 0 || range.end > snippet.length || range.end <= range.start) continue;
    const bounds = wordBounds(snippet, range);
    const word = normalizeSurfaceText(snippet.slice(bounds.start, bounds.end));
    const typed = typedWords.find((candidate) => isFormOfTypedWord(word, candidate));
    if (!typed) continue;
    const marked = typed.hasDigit
      ? { start: bounds.start, end: Math.min(bounds.end, bounds.start + typed.text.length) }
      : bounds;
    const previous = kept.at(-1);
    if (previous && marked.start <= previous.end) {
      kept[kept.length - 1] = { start: previous.start, end: Math.max(previous.end, marked.end) };
    } else {
      kept.push(marked);
    }
  }
  return kept;
}

function refineResult(result: SearchResult, queryTexts: readonly string[]): SearchResult {
  return {
    ...result,
    highlightedRanges: refineHighlightRanges(result.snippet, result.highlightedRanges, queryTexts),
  };
}

/** The response with every snippet marked by the typed words only. */
export function refineResponseHighlights(response: SearchResponse): SearchResponse {
  const queryTexts = [
    response.analysis.originalQuery,
    ...(response.queryRewrite ? [response.queryRewrite.query] : []),
    ...(response.queryCorrection ? [response.queryCorrection.correctedQuery] : []),
  ];
  return {
    ...response,
    groups: response.groups.map((group) => ({
      ...group,
      results: group.results.map((result) => refineResult(result, queryTexts)),
    })),
  };
}
