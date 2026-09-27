/**
 * One document of the current section, chosen uniformly. The section's catalog is already loaded
 * for the search page, so no extra read of the corpus is needed.
 */
export function pickRandomDocument<T extends { readonly id: string }>(
  documents: readonly T[],
  random: () => number = Math.random,
): T | undefined {
  if (documents.length === 0) return undefined;
  const index = Math.min(documents.length - 1, Math.floor(random() * documents.length));
  return documents[index];
}
