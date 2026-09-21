/** Source-local reference records are not approved canonical clinical concepts. */
export interface DefinitionReferenceHit {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly coverage: string;
  readonly textKind: 'editorial-paraphrase' | 'source-gloss' | 'source-excerpt';
  readonly reviewStatus: 'requires-review';
  readonly identityStatus: 'source-local-proposed';
  readonly blockCount: number;
  readonly match: 'name' | 'text';
}

export interface DefinitionReferenceBlock {
  readonly linkId: string;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly role: 'definition' | 'item' | 'context' | 'annotation';
  readonly characters: number;
}

export interface DefinitionReferenceReader {
  /** Compact hits only: no definition bodies, source metadata or whole-corpus arrays. */
  search(query: string, limit?: number): Promise<readonly DefinitionReferenceHit[]>;
  getCard(id: string): Promise<DefinitionReferenceHit | null>;
  /** At most 8 descriptors. Ordering is the source's block ordering, never relevance order. */
  listBlocks(id: string, after?: string): Promise<{
    readonly blocks: readonly DefinitionReferenceBlock[];
    readonly next: string | null;
  }>;
  /** Offset and returned character counts are Unicode code points (SQLite substr), not UTF-16. */
  readBlock(id: string, chunkId: string, offset?: number): Promise<{
    readonly text: string;
    readonly nextOffset: number | null;
    readonly totalCharacters: number;
    readonly sourceId: string;
    readonly provenance: Readonly<Record<string, unknown>>;
  } | null>;
  getSource(id: string): Promise<Readonly<Record<string, unknown>> | null>;
}
