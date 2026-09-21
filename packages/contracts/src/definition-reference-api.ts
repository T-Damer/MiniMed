import { z } from 'zod';

/** Source-local proposals, never automatically approved clinical concepts. */
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
export interface DefinitionReferenceAnnotation {
  readonly id: string;
  readonly kind: 'etymology' | 'historical-mention';
  readonly label: string;
  readonly statement: string;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly start: number;
  readonly end: number;
  readonly reviewStatus: 'requires-review';
  readonly identityStatus: 'unresolved';
}
export interface DefinitionReferenceAnnotationPage {
  readonly items: readonly DefinitionReferenceAnnotation[];
  readonly next: string | null;
}
const identity = z.string().min(1).max(256).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
const version = z.string().min(1).max(128).refine((s) => !s.includes('\0'));
const receipt = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const DefinitionReferenceModuleSchema = z.object({
  contract: z.literal(1),
  editionId: identity,
  entries: z.number().int().positive().max(100000),
  receipt,
}).strict();
export type DefinitionReferenceModule = z.infer<typeof DefinitionReferenceModuleSchema>;
export const DefinitionReferenceEditionSchema = DefinitionReferenceModuleSchema.extend({
  moduleId: identity,
  version,
  annotations: z.boolean(),
});
export type DefinitionReferenceEdition = z.infer<typeof DefinitionReferenceEditionSchema>;
const scope = { moduleId: identity, editionId: identity, version, receipt };
/** Serializable bounded domain operations. No SQL, URLs or file paths enter this API. */
export const DefinitionReferenceRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('catalog') }).strict(),
  z.object({ ...scope, op: z.literal('status') }).strict(),
  z.object({ ...scope, op: z.literal('search'), query: z.string().max(2048).refine((s) => !s.includes('\0')), limit: z.number().int().min(1).max(20).optional() }).strict(),
  z.object({ ...scope, op: z.literal('card'), id: identity }).strict(),
  z.object({ ...scope, op: z.literal('blocks'), id: identity, after: z.string().max(300).optional() }).strict(),
  z.object({ ...scope, op: z.literal('text'), id: identity, chunkId: identity, offset: z.number().int().min(0).max(262144).optional() }).strict(),
  z.object({ ...scope, op: z.literal('source'), id: identity }).strict(),
  z.object({ ...scope, op: z.literal('annotations'), id: identity, after: identity.optional() }).strict(),
]);
export type DefinitionReferenceRequest = z.infer<typeof DefinitionReferenceRequestSchema>;
export type DefinitionReferenceReply =
  | { readonly op: 'unavailable' }
  | { readonly op: 'catalog'; readonly editions: readonly DefinitionReferenceEdition[] }
  | { readonly op: 'status'; readonly edition: DefinitionReferenceEdition }
  | { readonly op: 'search'; readonly hits: readonly DefinitionReferenceHit[] }
  | { readonly op: 'card'; readonly card: DefinitionReferenceHit | null }
  | { readonly op: 'blocks'; readonly page: DefinitionReferencePage }
  | { readonly op: 'text'; readonly block: DefinitionReferenceText | null }
  | { readonly op: 'source'; readonly source: Readonly<Record<string, unknown>> | null }
  | { readonly op: 'annotations'; readonly page: DefinitionReferenceAnnotationPage };
