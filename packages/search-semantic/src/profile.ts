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
 * intfloat/multilingual-e5-small passage vectors of the released clinical-recommendation modules
 * (`tools/ingest/scripts/embed_modules_e5.py`, which holds the same literal). Queries are
 * embedded on device with the ONNX export of the same model (`apps/app/src/features/semantic`).
 */
export const E5_SMALL_PROFILE = {
  id: 'localmed.e5-small.384.int8.v1',
  dimensions: 384,
  vectorFormat: 'int8',
  normalization: 'l2',
  generator: 'intfloat/multilingual-e5-small',
  generatorVersion: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
  fingerprint: 'e5-small:614241f6:passage-title-section-1200c-256t:mean:l2:int8x127',
  metadata: {
    intendedUse: 'clinical-recommendation-semantic-search',
    neuralModel: true,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    passageText: 'title. section path. chunk text, first 1200 characters, 256 tokens',
  },
} as const satisfies EmbeddingProfile;

/**
 * Hybrid calibration of `E5_SMALL_PROFILE`, chosen on the Q1 dev split (167 real-language queries
 * with КР relevance, `tools/benchmarks/src/run-semantic-kr.ts`): R@5 0.096 lexical → 0.467 clinical
 * hybrid; the feature-hash constants gave 0.138. See docs/SEMANTIC_RETRIEVAL.md.
 */
export const E5_SMALL_FUSION = {
  band: 0.1,
  lexicalWeight: 0.5,
  vectorOnlyWeight: 0.8,
  corroborationWeight: 0.3,
} as const satisfies SemanticFusion;
