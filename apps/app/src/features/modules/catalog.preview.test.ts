import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import rawCatalog from '@/features/modules/catalog.preview.json';

describe('catalog.preview.json', () => {
  it('parses with ContentModuleCatalogSchema', () => {
    const result = ContentModuleCatalogSchema.safeParse(rawCatalog);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw result.error;
    }
    expect(result.data.modules.some((module) => module.kind === 'tool')).toBe(true);
  });
});
