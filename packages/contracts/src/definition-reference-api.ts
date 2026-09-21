import { z } from 'zod';

/** A source-local draft record is not an approved canonical clinical concept. */
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

export interface DefinitionReferenceText {
  readonly text: string;
  readonly nextOffset: number | null;
  readonly totalCharacters: number;
  readonly sourceId: string;
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface DefinitionReferencePage {
  readonly blocks: readonly DefinitionReferenceBlock[];
  readonly next: string | null;
}

export interface DefinitionReferenceReader {
  search(query: string, limit?: number): Promise<readonly DefinitionReferenceHit[]>;
  getCard(id: string): Promise<DefinitionReferenceHit | null>;
  listBlocks(id: string, after?: string): Promise<DefinitionReferencePage>;
  /** Offsets count Unicode code points, not UTF-16 units. */
  readBlock(id: string, chunkId: string, offset?: number): Promise<DefinitionReferenceText | null>;
  getSource(id: string): Promise<Readonly<Record<string, unknown>> | null>;
}

const identity = z.string().min(1).max(256).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
const scope = { moduleId: identity, editionId: identity };
/** Serializable domain operations, never arbitrary SQL or a second database connection. */
export const DefinitionReferenceRequestSchema = z.discriminatedUnion('op', [
  z.object({ ...scope, op: z.literal('status') }).strict(),
  z.object({ ...scope, op: z.literal('search'), query: z.string().max(2048).refine((s) => !s.includes('\0')), limit: z.number().int().min(1).max(20).optional() }).strict(),
  z.object({ ...scope, op: z.literal('card'), id: identity }).strict(),
  z.object({ ...scope, op: z.literal('blocks'), id: identity, after: z.string().max(300).optional() }).strict(),
  z.object({ ...scope, op: z.literal('text'), id: identity, chunkId: identity, offset: z.number().int().min(0).max(262144).optional() }).strict(),
  z.object({ ...scope, op: z.literal('source'), id: identity }).strict(),
]);
export type DefinitionReferenceRequest = z.infer<typeof DefinitionReferenceRequestSchema>;
export type DefinitionReferenceReply =
  | { readonly op: 'unavailable' }
  | { readonly op: 'status'; readonly editionId: string; readonly entries: number }
  | { readonly op: 'search'; readonly hits: readonly DefinitionReferenceHit[] }
  | { readonly op: 'card'; readonly card: DefinitionReferenceHit | null }
  | { readonly op: 'blocks'; readonly page: DefinitionReferencePage }
  | { readonly op: 'text'; readonly block: DefinitionReferenceText | null }
  | { readonly op: 'source'; readonly source: Readonly<Record<string, unknown>> | null };

/** This contract currently describes explicitly selected, local-dev reference editions only. */
export const DefinitionReferenceModuleSchema = z.object({
  contract: z.literal(1),
  editionId: identity,
  entries: z.number().int().positive().max(100000),
}).strict();
