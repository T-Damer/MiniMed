import { z } from 'zod';

import { ChunkEmbeddingSeedSchema, EmbeddingProfileSchema } from './semantic';

const NullablePositiveIntegerSchema = z.number().int().positive().nullable();

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

export const ContentPackSeedSchema = z.object({
  manifest: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    title: z.string().min(1),
    checksum: z.string().min(1),
    builtAt: z.string().min(1),
  }),
  documents: z.array(ContentPackDocumentSchema).min(1),
  aliases: z.array(AliasRecordSchema).default([]),
  embeddingProfiles: z.array(EmbeddingProfileSchema).default([]),
  embeddings: z.array(ChunkEmbeddingSeedSchema).default([]),
});

export type ContentPackChunk = z.infer<typeof ContentPackChunkSchema>;
export type ContentPackSection = z.infer<typeof ContentPackSectionSchema>;
export type ContentPackDocument = z.infer<typeof ContentPackDocumentSchema>;
export type AliasRecord = z.infer<typeof AliasRecordSchema>;
export type ContentPackSeed = z.infer<typeof ContentPackSeedSchema>;
