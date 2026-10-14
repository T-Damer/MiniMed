/**
 * Whether a word of a title or a snippet is a form of a word the user typed (SRCH1). The one rule
 * the highlight and the dictionary lookup share: the word-start rule of the search decides, so a
 * short typed word is itself or one of its inflections («боли» is no part of «болиголов»), a longer
 * one is the start of the word («пневмон» → «пневмония»), and a typed word that is the longer form
 * («аспирина») still names «аспирин».
 */
import {
  findWordPrefixMatches,
  lightStemRussian,
  normalizeSurfaceText,
} from '@localmed/search-lexical';

/** A word shorter than this is never the stem of a longer typed word. */
const MIN_FORM_STEM = 4;

export interface TypedWord {
  readonly text: string;
  readonly stem: string;
  readonly hasDigit: boolean;
}

/** A typed word, lower case with «ё» as «е». */
export function typedWord(raw: string): TypedWord {
  const text = normalizeSurfaceText(raw);
  return { text, stem: lightStemRussian(text), hasDigit: /\p{N}/u.test(text) };
}

function startsWord(word: string, term: string): boolean {
  return findWordPrefixMatches(word, term).some((match) => match.start === 0);
}

/** `word` (already lower case) is a form of the typed word. */
export function isFormOfTypedWord(word: string, typed: TypedWord): boolean {
  if (word === typed.text) return true;
  if (typed.hasDigit) return word.startsWith(typed.text);
  if (startsWord(word, typed.text) || startsWord(word, typed.stem)) return true;
  const stem = lightStemRussian(word);
  return stem.length >= MIN_FORM_STEM && typed.text.startsWith(stem);
}
