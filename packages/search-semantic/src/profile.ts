import type { EmbeddingProfile } from '@localmed/contracts';

import type { SemanticFusion } from './portable-hash';

export const PORTABLE_HASH_PROFILE = {
  id: 'localmed.feature-hash.384.v1',
  dimensions: 384,
  vectorFormat: 'int8',
  normalization: 'l2',
  generator: 'feature-hash',
  generatorVersion: '1',
  fingerprint: 'feature-hash-v1:384:int8:l2',
  metadata: {
    intendedUse: 'development-retrieval-scaffold',
    neuralModel: false,
  },
} as const satisfies EmbeddingProfile;

export function profilesCompatible(left: EmbeddingProfile, right: EmbeddingProfile): boolean {
  return (
    left.id === right.id &&
    left.dimensions === right.dimensions &&
    left.vectorFormat === right.vectorFormat &&
    left.normalization === right.normalization &&
    left.generator === right.generator &&
    left.generatorVersion === right.generatorVersion &&
    left.fingerprint === right.fingerprint
  );
}

/**
 * KD1 vectors (STATE KD1, docs/research/embedding-distillation-2026-10-09.md): passages encoded on
 * the build machine by Giga-Embeddings-instruct 480M and projected to 384 dimensions
 * (`tools/ingest/scripts/embed_modules.py`, which holds the same literal); queries embedded on
 * device by the distilled e5-small-sized student (`apps/app/src/features/semantic`).
 */
export const KD1_PROFILE = {
  id: 'localmed.kd1-giga480m.384.int8.v1',
  dimensions: 384,
  vectorFormat: 'int8',
  normalization: 'l2',
  generator: 'ai-sage/Giga-Embeddings-instruct-480M-0826',
  generatorVersion: '1763d603adac8057bd6482a708001b0ed2e0a903',
  fingerprint:
    'giga480m:1763d603:passage-title-section-1200c-256t:mean:l2:pca384-097ec035:l2:int8x127',
  metadata: {
    intendedUse: 'clinical-recommendation-semantic-search',
    neuralModel: true,
    queryEncoder:
      'minimed/kd1-query-encoder (multilingual-e5-small distilled from the passage model; revision pinned by the app)',
    queryPrefix: 'query: ',
    passagePrefix: '',
    passageText: 'title. section path. chunk text, first 1200 characters, 256 tokens',
  },
} as const satisfies EmbeddingProfile;

/**
 * Hybrid calibration of `KD1_PROFILE`, chosen on the Q1 dev split (167 queries with КР relevance,
 * `run-semantic-kr.ts --grid`): clinical hybrid R@5 0.461 with the e5 constants → 0.551, MRR 0.367 →
 * 0.414. Student cosines spread wider than e5's, so the band is wider and lexical evidence weighs
 * less; band 0.3–0.5 and lexical weight 0.1–0.3 score the same on dev, this is the middle.
 */
export const KD1_FUSION = {
  band: 0.5,
  lexicalWeight: 0.3,
  vectorOnlyWeight: 0.8,
  corroborationWeight: 0.3,
} as const satisfies SemanticFusion;
