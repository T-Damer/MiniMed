import {
  ContentModuleCatalogEntrySchema,
  ContentModuleCatalogSchema,
  parseTrustedContentModuleCatalog,
  parseTrustedContentModuleCatalogEntries,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import rawCatalog from '@/features/modules/catalog.preview.json';
import rawTerminology from '@/features/modules/catalog.terminology.json';

/**
 * The app parses its bundled catalogs through the trusted path, which does not run the schema over
 * the document rows. These tests are what makes that safe: the result must be the full parse.
 */
describe('bundled catalogs through the trusted parse', () => {
  it('gives the release catalog exactly as the schema does', () => {
    const trusted = parseTrustedContentModuleCatalog(rawCatalog);
    expect(JSON.stringify(trusted)).toBe(
      JSON.stringify(ContentModuleCatalogSchema.parse(rawCatalog)),
    );
  });

  it('gives the terminology entries exactly as the schema does', () => {
    const trusted = parseTrustedContentModuleCatalogEntries(rawTerminology);
    expect(JSON.stringify(trusted)).toBe(
      JSON.stringify(ContentModuleCatalogEntrySchema.array().parse(rawTerminology)),
    );
  });

  it('still rejects a catalog whose entries break the schema', () => {
    expect(() =>
      parseTrustedContentModuleCatalog({ ...rawCatalog, modules: [{ id: '' }] }),
    ).toThrow();
    expect(() => parseTrustedContentModuleCatalog({ modules: 'none' })).toThrow();
  });
});
