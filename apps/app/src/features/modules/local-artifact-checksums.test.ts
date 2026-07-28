import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import catalog from '@/features/modules/catalog.preview.json';

const RAW_MAIN_PREFIX = 'https://raw.githubusercontent.com/T-Damer/MiniMed/main/';

describe('local module artifacts', () => {
  it('keeps catalog checksums and sizes aligned with the published files', () => {
    for (const module of catalog.modules) {
      for (const artifact of module.artifacts) {
        if (!artifact.url?.startsWith(RAW_MAIN_PREFIX)) continue;
        const path = artifact.url.slice(RAW_MAIN_PREFIX.length);
        const bytes = readFileSync(path);
        expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, artifact.id).toBe(
          artifact.sha256,
        );
        expect(statSync(path).size, artifact.id).toBe(artifact.sizeBytes);
      }
    }
  });
});
