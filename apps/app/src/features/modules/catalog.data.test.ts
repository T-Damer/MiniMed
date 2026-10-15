// Data-type test: catalog.preview.json is the one table of contents of every downloadable data type.
// These are structural invariants over all ~840 module entries, not per-module assertions, so concurrent
// work on a module family (drugs, regulatory acts, diets, feeding norms, images) does not break them.
// See docs/DATA_TESTS.md.
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import catalogJson from '@/features/modules/catalog.preview.json';

const catalog = ContentModuleCatalogSchema.parse(catalogJson);
const release = JSON.parse(readFileSync('release.json', 'utf8')) as {
  version?: string;
  appVersion?: string;
};

function versionParts(version: string): number[] {
  return version
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function atMost(left: string, right: string): boolean {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) < (b[index] ?? 0);
  }
  return true;
}

/** Modules the catalog lists for the next app release (their reader code is in the same unreleased range). */
const PENDING_RELEASE_MODULES: ReadonlyMap<string, string> = new Map<string, string>([]);

describe('module catalog structure', () => {
  const modules = catalog.modules;
  const downloadable = modules.filter((module) => module.artifacts.length > 0);
  // Preview placeholders from the first pediatrics catalog: listed, with documents counted, but nothing to download.
  const ARTIFACT_FREE_PREVIEW_STUBS = [
    'minimed.clinical.pediatrics.infectious',
    'minimed.clinical.pediatrics.nephro-urology',
  ];

  it('has artifacts for every module except the core, planned entries and two named preview stubs', () => {
    const without = modules
      .filter(
        (module) =>
          module.artifacts.length === 0 &&
          module.kind !== 'core' &&
          module.releaseState !== 'planned',
      )
      .map((module) => module.id);
    expect(without.sort()).toEqual(ARTIFACT_FREE_PREVIEW_STUBS);
  });

  it('lists every data kind the app downloads', () => {
    const kinds = new Set(modules.map((module) => module.kind));
    for (const kind of ['core', 'clinical', 'medication', 'reference', 'regulatory', 'tool']) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
    expect(modules.length).toBeGreaterThan(500);
  });

  it('has unique module ids and unique artifact ids', () => {
    const ids = modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    const artifactIds = modules.flatMap((module) =>
      module.artifacts.map((artifact) => artifact.id),
    );
    expect(new Set(artifactIds).size).toBe(artifactIds.length);
  });

  it('resolves every dependency to a module of the catalog', () => {
    const ids = new Set(modules.map((module) => module.id));
    for (const module of modules) {
      for (const dependency of module.dependencies) {
        expect(ids.has(dependency.moduleId), `${module.id} -> ${dependency.moduleId}`).toBe(true);
        expect(dependency.moduleId).not.toBe(module.id);
      }
    }
  });

  it('gives every downloadable module an index artifact with an exact checksum, size and https address', () => {
    expect(downloadable.length).toBeGreaterThan(500);
    for (const module of downloadable) {
      const index = module.artifacts.filter((artifact) => artifact.kind === 'index');
      expect(index.length, `${module.id} index artifacts`).toBeGreaterThanOrEqual(1);
      for (const artifact of module.artifacts) {
        expect(artifact.sha256, artifact.id).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(artifact.sizeBytes, artifact.id).toBeGreaterThan(0);
        expect(artifact.url ?? '', artifact.id).toMatch(/^https:\/\//);
        if (artifact.compression === 'gzip' || artifact.compression === 'zstd') {
          expect(artifact.decodedSha256, `${artifact.id} decodedSha256`).toMatch(
            /^sha256:[0-9a-f]{64}$/,
          );
          expect(artifact.decodedSizeBytes, `${artifact.id} decodedSizeBytes`).toBeGreaterThan(
            (artifact.sizeBytes ?? 0) / 4,
          );
        }
      }
    }
  });

  it('declares a download size equal to its artifacts and an installed size not below the decoded index', () => {
    for (const module of downloadable) {
      // Every artifact is downloaded: the index and, for the photo pack, its source-assets ZIPs.
      const total = module.artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0);
      expect(module.sizes.downloadBytes ?? 0, module.id).toBe(total);
      const decoded = module.artifacts
        .filter((artifact) => artifact.kind === 'index')
        .reduce((sum, artifact) => sum + (artifact.decodedSizeBytes ?? artifact.sizeBytes ?? 0), 0);
      expect(module.sizes.installedBytes ?? 0, module.id).toBeGreaterThanOrEqual(decoded);
    }
  });

  it('keeps document membership consistent with the artifacts and the preview count', () => {
    for (const module of modules) {
      if (module.documents.length === 0) continue;
      const artifactIds = new Set(module.artifacts.map((artifact) => artifact.id));
      const documentIds = new Set<string>();
      for (const document of module.documents) {
        expect(
          artifactIds.has(document.indexArtifactId),
          `${module.id}/${document.documentId}`,
        ).toBe(true);
        documentIds.add(document.documentId);
      }
      expect(documentIds.size, `${module.id} duplicate document ids`).toBe(module.documents.length);
      expect(module.previewDocumentCount, module.id).toBe(module.documents.length);
    }
  });

  it('never requires a newer app than the release the catalog ships with', () => {
    const appVersion = release.version ?? release.appVersion;
    expect(appVersion, 'release.json carries the app version').toMatch(/^\d+\.\d+\.\d+/);
    for (const module of modules) {
      // Listed ahead of the release whose app code reads it; drop the entry here once release.json
      // reaches the version (the release commit bumps both).
      if (module.compatibility.minAppVersion === PENDING_RELEASE_MODULES.get(module.id)) continue;
      expect(
        atMost(module.compatibility.minAppVersion, appVersion as string),
        `${module.id} needs ${module.compatibility.minAppVersion}`,
      ).toBe(true);
    }
  });
});

describe('core pointers resolve in the catalog (core.db restored from content/bundled)', () => {
  const corePath = 'apps/app/public/content/core.db';

  it.skipIf(!existsSync(corePath))(
    'names for every core document an existing module whose membership lists the target',
    () => {
      const byId = new Map(catalog.modules.map((module) => [module.id, module]));
      const members = new Map<string, Set<string>>();
      const unresolved: string[] = [];
      const missingTarget: string[] = [];
      const db = new DatabaseSync(corePath, { readOnly: true });
      try {
        const rows = db.prepare('SELECT id, metadata_json AS metadata FROM documents').all() as {
          id: string;
          metadata: string;
        }[];
        expect(rows.length).toBeGreaterThan(10_000);
        for (const row of rows) {
          const meta = JSON.parse(row.metadata) as {
            primaryModuleId?: string;
            moduleIds?: string[];
            targetDocumentId?: string;
          };
          // The primary id may name a specialty collection; the downloadable module is the first listed id the catalog has.
          const module = [meta.primaryModuleId, ...(meta.moduleIds ?? [])]
            .map((id) => byId.get(id ?? ''))
            .find((candidate) => candidate !== undefined);
          if (!module || !meta.targetDocumentId) {
            unresolved.push(row.id);
            continue;
          }
          if (module.documents.length === 0) continue;
          let set = members.get(module.id);
          if (!set) {
            set = new Set(module.documents.map((document) => document.documentId));
            members.set(module.id, set);
          }
          if (!set.has(meta.targetDocumentId)) missingTarget.push(row.id);
        }
      } finally {
        db.close();
      }
      expect(
        unresolved.slice(0, 5),
        `${unresolved.length} pointers without a catalog module`,
      ).toEqual([]);
      expect(
        missingTarget.slice(0, 5),
        `${missingTarget.length} pointers outside the module membership`,
      ).toEqual([]);
    },
    60_000,
  );
});
