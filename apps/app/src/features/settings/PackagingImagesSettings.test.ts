import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { medicationPackagingImagesDownloadBytes } from '../medications/medication-packaging-images';

describe('PackagingImagesSettings', () => {
  it('uses the total module download size instead of adding the source-assets subset twice', () => {
    const module = {
      sizes: {
        downloadBytes: 281206219,
        installedBytes: 281206219,
        sourceAssetsDownloadBytes: 280899019,
      },
    } as ContentModuleCatalogEntry;

    expect(medicationPackagingImagesDownloadBytes(module)).toBe(281206219);
  });
});
