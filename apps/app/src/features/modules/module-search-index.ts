/**
 * Whether the search index of an installed module pack is what its catalog entry promises.
 *
 * An ordinary module indexes every chunk. A module that declares `capabilities.search: false`
 * (the DDInter severity labels, INT2: data read by id, never searched) keeps all its documents out
 * of the index through the `definitionReference` document flag, so its index is empty; a partly
 * filled index would be a damaged one and still fails.
 */
export function searchIndexIsConsistent(input: {
  readonly searchable: boolean;
  readonly chunkCount: number;
  readonly ftsRowCount: number;
}): boolean {
  if (input.chunkCount === input.ftsRowCount) return true;
  return !input.searchable && input.ftsRowCount === 0;
}
