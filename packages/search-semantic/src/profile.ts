import type { EmbeddingProfile } from '@localmed/contracts';

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
