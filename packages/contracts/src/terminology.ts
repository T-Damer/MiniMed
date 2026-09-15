import { z } from 'zod';

/** Search-only projection. Source definitions, name status and evidence stay in the full record. */
export const TerminologySearchProjectionSchema = z.object({
  version: z.literal(1),
  edition: z.string().min(1),
  conceptId: z.string().regex(/^mesh\.M\d+$/u),
  names: z.array(z.string().min(1)).min(1),
  relatedConceptIds: z.array(z.string().regex(/^mesh\.M\d+$/u)),
  definitionLanguages: z.array(z.string().min(2)),
  discovery: z.boolean(),
  targetDocumentId: z.string().min(1),
});

export type TerminologySearchProjection = z.infer<typeof TerminologySearchProjectionSchema>;
export type TerminologyMatchKind = 'term' | 'term-mention' | 'related-term';
