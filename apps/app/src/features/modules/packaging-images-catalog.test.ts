import { describe, expect, it } from 'vitest';

import { MEDICATION_PACKAGING_IMAGES_MODULE_ID } from '@/features/medications/medication-packaging-images';
import { resolveContentModuleArtifactUrl } from '@/features/modules/artifact-url';
import catalogJson from '@/features/modules/catalog.preview.json';

interface CatalogArtifact {
  readonly id: string;
  readonly kind: string;
  readonly url: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly compression: string;
}

interface CatalogModule {
  readonly id: string;
  readonly kind: string;
  readonly releaseState: string;
  readonly compatibility: { readonly minAppVersion: string };
  readonly dependencies: readonly { readonly moduleId: string }[];
  readonly sizes: {
    readonly downloadBytes: number | null;
    readonly sourceAssetsDownloadBytes: number | null;
  };
  readonly artifacts: readonly CatalogArtifact[];
}

const entry = (catalogJson.modules as readonly CatalogModule[]).find(
  (module) => module.id === MEDICATION_PACKAGING_IMAGES_MODULE_ID,
);

describe('the packaging photo pack in the catalog', () => {
  it('is listed as a reference module, so the drug bundles do not pull it in', () => {
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('reference');
    expect(entry?.releaseState).toBe('preview');
    expect(entry?.dependencies.map((dependency) => dependency.moduleId)).toEqual([
      'minimed.core.ru',
    ]);
  });

  it('has an index and 16 ZIP shards, each with a checksum and a mirror URL', () => {
    const artifacts = entry?.artifacts ?? [];
    const index = artifacts.filter((artifact) => artifact.kind === 'index');
    const shards = artifacts.filter((artifact) => artifact.kind === 'source-assets');
    expect(index).toHaveLength(1);
    expect(shards).toHaveLength(16);
    expect(shards.map((shard) => shard.id.at(-1)).sort()).toEqual('0123456789abcdef'.split(''));
    for (const artifact of artifacts) {
      expect(artifact.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      // Every file stays far below GitHub's 100 MB blob limit, so the mirror holds plain blobs.
      expect(artifact.sizeBytes).toBeLessThan(50 * 1024 * 1024);
      const resolved = resolveContentModuleArtifactUrl(artifact.url ?? '');
      expect(resolved).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/T-Damer\/MiniMed\/datasets\/allmed-images-[\w.-]+\/modules\/minimed\.medications\.packaging-images\.ru\./u,
      );
    }
    for (const shard of shards) expect(shard.compression).toBe('zip');
    expect(entry?.sizes.sourceAssetsDownloadBytes).toBe(
      shards.reduce((total, shard) => total + (shard.sizeBytes ?? 0), 0),
    );
  });

  it('needs the app that reads sharded packs', () => {
    expect(entry?.compatibility.minAppVersion).toBe('0.6.60');
  });
});
