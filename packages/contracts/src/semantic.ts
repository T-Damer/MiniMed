import { z } from 'zod';

export const EmbeddingVectorFormatSchema = z.literal('int8');
export const EmbeddingNormalizationSchema = z.literal('l2');

export const EmbeddingProfileSchema = z.object({
  id: z.string().min(1),
  dimensions: z.number().int().positive(),
  vectorFormat: EmbeddingVectorFormatSchema,
  normalization: EmbeddingNormalizationSchema,
  generator: z.string().min(1),
  generatorVersion: z.string().min(1),
  fingerprint: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const QuantizedEmbeddingVectorSchema = z.object({
  profileId: z.string().min(1),
  values: z.array(z.number().int().min(-127).max(127)),
  norm: z.number().nonnegative(),
});

export const ChunkEmbeddingSeedSchema = QuantizedEmbeddingVectorSchema.extend({
  chunkId: z.string().min(1),
});

export type EmbeddingProfile = z.infer<typeof EmbeddingProfileSchema>;
export type QuantizedEmbeddingVector = z.infer<typeof QuantizedEmbeddingVectorSchema>;
export type ChunkEmbeddingSeed = z.infer<typeof ChunkEmbeddingSeedSchema>;
