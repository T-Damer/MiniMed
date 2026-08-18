import {
  isCloseToken,
  lightStemRussian,
  MIN_FUZZY_TOKEN_LENGTH,
  tokenize,
} from '@localmed/search-lexical';

export function personalQueryStems(query: string): readonly string[] {
  return [...new Set(tokenize(query).map(lightStemRussian))];
}

function personalTextStems(text: string): ReadonlySet<string> {
  return new Set(tokenize(text).map(lightStemRussian));
}

function stemPresent(queryStem: string, textStems: ReadonlySet<string>): boolean {
  if (textStems.has(queryStem)) return true;
  for (const textStem of textStems) {
    if (isCloseToken(queryStem, textStem)) return true;
  }
  return false;
}

function requiredQueryStems(queryStems: readonly string[]): readonly string[] {
  const distinctive = queryStems.filter((stem) => stem.length >= MIN_FUZZY_TOKEN_LENGTH);
  return distinctive.length > 0 ? distinctive : queryStems;
}

/** True when every distinctive query stem (or every stem, if all are short) appears in the text. */
export function personalTextMatchesQuery(
  queryStems: readonly string[],
  textStems: ReadonlySet<string>,
): boolean {
  if (queryStems.length === 0) return false;
  return requiredQueryStems(queryStems).every((stem) => stemPresent(stem, textStems));
}

export function personalMatchScore(queryStems: readonly string[], text: string): number {
  if (queryStems.length === 0) return 0;
  const textStems = personalTextStems(text);
  if (!personalTextMatchesQuery(queryStems, textStems)) return 0;
  return queryStems.filter((stem) => stemPresent(stem, textStems)).length;
}

export function wordMatchesQueryStem(word: string, queryStems: readonly string[]): boolean {
  const token = tokenize(word)[0];
  if (!token) return false;
  const stem = lightStemRussian(token);
  return stem.length > 0 && stemPresent(stem, new Set(queryStems));
}
