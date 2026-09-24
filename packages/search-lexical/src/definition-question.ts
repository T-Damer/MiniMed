/** Language-only framing; the caller must still prove the whole subject is an exact indexed name. */
const QUESTION =
  /^(?:что\s+(?:такое|означает|значит)|(?:дай(?:те)?|покажи(?:те)?)\s+определение(?:\s+термина)?|определение(?:\s+(?:слова|термина))?|найди\s+(?:термин|определение)|как\s+(?:это\s+)?называется|не\s+помню\s+(?:название|термин))[\s:—-]+/iu;

/**
 * Do not make the user choose a search mode for "Что такое X?".
 * This is not clinical intent inference, synonym expansion or a phrase-to-diagnosis table.
 * Unknown/compound subjects continue through the ordinary description handler unchanged.
 */
export function definitionQuestionSubject(query: string): string | null {
  if (!query || query.length > 2048 || query.includes('\0')) return null;
  const original = query.trim();
  const prefix = QUESTION.exec(original);
  if (!prefix) return null;
  let subject = original
    .slice(prefix[0].length)
    .trim()
    .replace(/[?？]+$/u, '')
    .trim();
  for (const [open, close] of [
    ['«', '»'],
    ['“', '”'],
    ['"', '"'],
  ] as const) {
    if (subject.startsWith(open) && subject.endsWith(close) && subject.length > 2) {
      subject = subject.slice(1, -1).trim();
      break;
    }
  }
  return subject && subject.length <= 512 ? subject : null;
}
