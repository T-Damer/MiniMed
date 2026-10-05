import type { EmbeddingProfile, QuantizedEmbeddingVector } from '@localmed/contracts';

import {
  LEGACY_SEMANTIC_FUSION,
  type QueryEmbedder,
  type SemanticFusion,
  vectorNorm,
} from './portable-hash';

const MAX_QUANTIZED_VALUE = 127;

/** ADR 0008 int8 quantisation of a float embedding: L2-normalise, ×127, round half away from zero. */
export function quantizeEmbedding(values: ArrayLike<number>): number[] {
  let squaredNorm = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    squaredNorm += value * value;
  }
  if (squaredNorm === 0) return Array.from({ length: values.length }, () => 0);
  const norm = Math.sqrt(squaredNorm);
  return Array.from({ length: values.length }, (_, index) => {
    const scaled = ((values[index] ?? 0) / norm) * MAX_QUANTIZED_VALUE;
    const rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5);
    return Math.max(-MAX_QUANTIZED_VALUE, Math.min(MAX_QUANTIZED_VALUE, rounded));
  });
}

/** Encodes one prefixed text with a neural model and returns its float embedding. */
export type EmbeddingEncoder = (text: string) => Promise<ArrayLike<number>>;

/**
 * A neural query embedder: the model sees the user's own wording with the profile's query prefix,
 * not the normalised facts the feature-hash profile was built for.
 */
export class NeuralQueryEmbedder implements QueryEmbedder {
  public readonly input = 'original-query' as const;

  public constructor(
    public readonly profile: EmbeddingProfile,
    private readonly encode: EmbeddingEncoder,
    public readonly fusion: SemanticFusion = LEGACY_SEMANTIC_FUSION,
  ) {}

  public async embedQuery(text: string): Promise<QuantizedEmbeddingVector> {
    const prefix = this.profile.metadata['queryPrefix'];
    const encoded = await this.encode(`${typeof prefix === 'string' ? prefix : ''}${text}`);
    if (encoded.length !== this.profile.dimensions) {
      throw new RangeError(
        `Embedding dimension mismatch: ${encoded.length} !== ${this.profile.dimensions}`,
      );
    }
    const values = quantizeEmbedding(encoded);
    return { profileId: this.profile.id, values, norm: vectorNorm(values) };
  }
}
