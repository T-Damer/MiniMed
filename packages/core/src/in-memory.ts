import type { ContentPackSeed, CoreCapabilities, MedicalCore } from '@localmed/contracts';
import { PortableHashEmbedder, type QueryEmbedder } from '@localmed/search-semantic';
import { InMemoryMedicalStore } from '@localmed/storage';

import { createMedicalCore } from './create-medical-core';

export function createInMemoryMedicalCore(
  seed: ContentPackSeed,
  platform: CoreCapabilities['platform'] = 'test',
  embedder: QueryEmbedder = new PortableHashEmbedder(),
): MedicalCore {
  return createMedicalCore({ store: new InMemoryMedicalStore(), seed, platform, embedder });
}
