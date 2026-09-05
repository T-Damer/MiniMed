import { readFileSync } from 'node:fs';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { hydrateCatalogMembership } from '../../../scripts/hydrate-catalog-membership';

const catalog = ContentModuleCatalogSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../apps/app/src/features/modules/catalog.preview.json', import.meta.url),
      'utf8',
    ),
  ),
);

describe('verified artifact membership', () => {
  it('uses exact bytes identity and replaces membership from database rows', () => {
    const module = catalog.modules.find((entry) =>
      entry.artifacts.some(
        (artifact) => artifact.kind === 'index' && artifact.compression === 'none',
      ),
    );
    const artifact = module?.artifacts.find((item) => item.kind === 'index');
    if (!module || !artifact?.sha256) throw new Error('Fixture needs an index artifact');
    const checksum = artifact.sha256;
    const rows = [
      {
        documentId: 'verified.target',
        documentVersionId: 'verified.target@1',
        title: 'Source title',
        sourceChecksum: `sha256:${'a'.repeat(64)}`,
        status: 'active',
      },
    ];
    expect(hydrateCatalogMembership(catalog, `sha256:${'0'.repeat(64)}`, rows)).toEqual(catalog);
    const result = hydrateCatalogMembership(catalog, checksum, rows).modules.find(
      (entry) => entry.id === module.id,
    );
    expect(result?.documents).toContainEqual({
      ...rows[0],
      indexArtifactId: artifact.id,
      sourceAssetArtifactId: null,
    });
    expect(result?.previewDocumentCount).toBe(1);
    expect(() =>
      hydrateCatalogMembership(catalog, checksum, [{ ...rows[0], sourceChecksum: 'invalid' }]),
    ).toThrow();
  });
});
