import { z } from 'zod';

import { ChunkEmbeddingSeedSchema, EmbeddingProfileSchema } from './semantic';

const NullablePositiveIntegerSchema = z.number().int().positive().nullable();
const EvidenceLocatorSchema = z.object({
  documentId: z.string().min(1),
  sectionId: z.string().min(1).nullable().default(null),
  chunkId: z.string().min(1),
  quote: z.string().min(1),
  anchor: z.string().min(1),
});

export const ContentPackChunkSchema = z.object({
  id: z.string().min(1),
  orderIndex: z.number().int().nonnegative(),
  originalText: z.string().min(1),
  normalizedText: z.string().min(1),
  pageStart: NullablePositiveIntegerSchema.default(null),
  pageEnd: NullablePositiveIntegerSchema.default(null),
  charStart: z.number().int().nonnegative().nullable().default(null),
  charEnd: z.number().int().nonnegative().nullable().default(null),
  anchor: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ContentPackSectionSchema = z.object({
  id: z.string().min(1),
  parentSectionId: z.string().min(1).nullable().default(null),
  title: z.string().min(1),
  normalizedTitle: z.string().min(1),
  sectionType: z.string().min(1).nullable().default(null),
  depth: z.number().int().positive(),
  orderIndex: z.number().int().nonnegative(),
  pageStart: NullablePositiveIntegerSchema.default(null),
  pageEnd: NullablePositiveIntegerSchema.default(null),
  anchor: z.string().min(1),
  sectionPath: z.array(z.string().min(1)).min(1),
  chunks: z.array(ContentPackChunkSchema),
});

export const ContentPackDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  shortTitle: z.string().min(1).nullable().default(null),
  sourceType: z.string().min(1),
  status: z.string().min(1),
  specialties: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  version: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    effectiveFrom: z.string().min(1).nullable().default(null),
    effectiveTo: z.string().min(1).nullable().default(null),
    sourceChecksum: z.string().min(1),
    extractedAt: z.string().min(1),
  }),
  sections: z.array(ContentPackSectionSchema).min(1),
});

export const AliasRecordSchema = z.object({
  id: z.string().min(1),
  canonicalTerm: z.string().min(1),
  alias: z.string().min(1),
  category: z.string().min(1).nullable().default(null),
  weight: z.number().positive().default(1),
});

export const KnowledgeEntitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  canonicalName: z.string().min(1),
  description: z.string().min(1).nullable().default(null),
  aliases: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const KnowledgeClaimSchema = z.object({
  id: z.string().min(1),
  subjectEntityId: z.string().min(1),
  predicate: z.string().min(1),
  objectEntityId: z.string().min(1).nullable().default(null),
  value: z.unknown().nullable().default(null),
  qualifiers: z.record(z.string(), z.unknown()).default({}),
  sourceKind: z.enum(['reference', 'personal', 'computed', 'imported']),
  authority: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(1),
  validFrom: z.string().min(1).nullable().default(null),
  validTo: z.string().min(1).nullable().default(null),
  evidence: z.array(EvidenceLocatorSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const KnowledgeRelationSchema = z.object({
  id: z.string().min(1),
  sourceEntityId: z.string().min(1),
  predicate: z.string().min(1),
  targetEntityId: z.string().min(1),
  weight: z.number().min(0).max(1).default(1),
  evidence: z.array(EvidenceLocatorSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const KnowledgeClaimLinkSchema = z.object({
  fromClaimId: z.string().min(1),
  relation: z.enum(['supports', 'contradicts', 'refines', 'supersedes', 'duplicates']),
  toClaimId: z.string().min(1),
  reason: z.string().min(1).nullable().default(null),
});

export const ContentPackSeedSchema = z.object({
  manifest: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1).nullable().default(null),
    language: z.string().min(2).default('und'),
    license: z.string().min(1).nullable().default(null),
    checksum: z.string().min(1),
    builtAt: z.string().min(1),
  }),
  documents: z.array(ContentPackDocumentSchema).min(1),
  aliases: z.array(AliasRecordSchema).default([]),
  entities: z.array(KnowledgeEntitySchema).default([]),
  claims: z.array(KnowledgeClaimSchema).default([]),
  relations: z.array(KnowledgeRelationSchema).default([]),
  claimLinks: z.array(KnowledgeClaimLinkSchema).default([]),
  embeddingProfiles: z.array(EmbeddingProfileSchema).default([]),
  embeddings: z.array(ChunkEmbeddingSeedSchema).default([]),
});

export type ContentPackChunk = z.infer<typeof ContentPackChunkSchema>;
export type ContentPackSection = z.infer<typeof ContentPackSectionSchema>;
export type ContentPackDocument = z.infer<typeof ContentPackDocumentSchema>;
export type AliasRecord = z.infer<typeof AliasRecordSchema>;
export type KnowledgeEntity = z.infer<typeof KnowledgeEntitySchema>;
export type KnowledgeClaim = z.infer<typeof KnowledgeClaimSchema>;
export type KnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>;
export type KnowledgeClaimLink = z.infer<typeof KnowledgeClaimLinkSchema>;
export type ContentPackSeed = z.infer<typeof ContentPackSeedSchema>;
