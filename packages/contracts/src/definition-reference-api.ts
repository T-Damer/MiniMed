import { z } from 'zod';

/**
 * Facts the edition build measured to order the senses of one headword (never text): the medical
 * field the source states, how many independent documents give its meaning, how authoritative the
 * source is (3 КР glossary … 0 general dictionary) and how many recommendations use the sense
 * (`usage`) or the headword at all (`termUsage`). Absent in editions built before senses.
 */
export interface DefinitionReferenceSense {
  readonly field?: string;
  readonly fieldLabel?: string;
  readonly documents?: number;
  /** Senses of one headword with the same `meaning` word one definition alike. */
  readonly meaning?: number;
  readonly authority?: number;
  readonly usage?: number;
  readonly termUsage?: number;
}

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
  readonly sense?: DefinitionReferenceSense;
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
/** A literal span in a linked source/context block, not an inferred term/person relationship. */
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
const identity = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
const scope = { moduleId: identity, editionId: identity };
/** Serializable domain operations, never arbitrary SQL or a second database connection. */
export const DefinitionReferenceRequestSchema = z.discriminatedUnion('op', [
  z.object({ ...scope, op: z.literal('status') }).strict(),
  z
    .object({
      ...scope,
      op: z.literal('search'),
      query: z
        .string()
        .max(2048)
        .refine((s) => !s.includes('\0')),
      limit: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
  z.object({ ...scope, op: z.literal('card'), id: identity }).strict(),
  z
    .object({
      ...scope,
      op: z.literal('blocks'),
      id: identity,
      after: z.string().max(300).optional(),
    })
    .strict(),
  z
    .object({
      ...scope,
      op: z.literal('text'),
      id: identity,
      chunkId: identity,
      offset: z.number().int().min(0).max(262144).optional(),
    })
    .strict(),
  z.object({ ...scope, op: z.literal('source'), id: identity }).strict(),
  z
    .object({ ...scope, op: z.literal('annotations'), id: identity, after: identity.optional() })
    .strict(),
]);
export type DefinitionReferenceRequest = z.infer<typeof DefinitionReferenceRequestSchema>;
export type DefinitionReferenceReply =
  | { readonly op: 'unavailable' }
  | { readonly op: 'status'; readonly editionId: string; readonly entries: number }
  | { readonly op: 'search'; readonly hits: readonly DefinitionReferenceHit[] }
  | { readonly op: 'card'; readonly card: DefinitionReferenceHit | null }
  | { readonly op: 'blocks'; readonly page: DefinitionReferencePage }
  | { readonly op: 'text'; readonly block: DefinitionReferenceText | null }
  | { readonly op: 'source'; readonly source: Readonly<Record<string, unknown>> | null }
  | { readonly op: 'annotations'; readonly page: DefinitionReferenceAnnotationPage };

/**
 * Where an edition may come from. Neither state is clinically reviewed:
 * - `local-dev`: a developer's own build, loaded only by DEV builds from `public/content`;
 * - `experimental-preview`: a published draft edition in the ordinary module catalog, offered
 *   only while experimental modules are enabled and always shown as requiring review.
 */
export const DEFINITION_REFERENCE_PUBLICATION_STATES = [
  'local-dev',
  'experimental-preview',
] as const;
export type DefinitionReferencePublicationState =
  (typeof DEFINITION_REFERENCE_PUBLICATION_STATES)[number];

export function isDefinitionReferencePublicationState(
  value: unknown,
): value is DefinitionReferencePublicationState {
  return DEFINITION_REFERENCE_PUBLICATION_STATES.some((state) => state === value);
}

/** Catalog capability of an explicitly selected, unreviewed reference edition. */
export const DefinitionReferenceModuleSchema = z
  .object({
    contract: z.literal(1),
    editionId: identity,
    entries: z.number().int().positive().max(100000),
  })
  .strict();
