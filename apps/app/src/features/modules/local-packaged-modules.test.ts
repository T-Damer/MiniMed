import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  CORE_MEDICATION_REGISTRY_CARD_COUNT,
  catalogModuleHidesInstallAction,
  catalogModuleHidesRemoveAction,
  isCompanionMedicationsMounted,
  isPreinstalledCatalogModule,
  localPackagedModulesToInstall,
  MEDICATIONS_COMPANION_MODULE_ID,
  mergePreinstalledModules,
} from '@/features/modules/local-packaged-modules';

function module(
  overrides: Partial<ContentModuleCatalogEntry> &
    Pick<ContentModuleCatalogEntry, 'id' | 'kind' | 'releaseState' | 'required'>,
): ContentModuleCatalogEntry {
  return {
    version: '1.0.0',
    collection: overrides.kind,
    title: overrides.id,
    description: overrides.id,
    specialties: [],
    populations: [],
    tags: [],
    compatibility: {
      minAppVersion: '0.6.0',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dependencies: [],
    sizes: {
      downloadBytes: 12,
      installedBytes: 12,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    capabilities: {
      search: false,
      fullText: false,
      structuredTables: true,
      images: false,
      originalPdf: false,
      structuredKnowledge: true,
      calculations: true,
    },
    artifacts: [],
    documents: [],
    previewDocumentCount: 0,
    ...overrides,
  };
}

const catalog: ContentModuleCatalog = {
  catalogVersion: '1',
  channel: 'preview',
  publishedAt: '2026-08-18T00:00:00Z',
  categories: [],
  modules: [
    module({
      id: 'minimed.core.ru',
      kind: 'core',
      required: true,
      releaseState: 'bundled',
    }),
    module({
      id: 'minimed.regulatory.pediatrics.ru',
      kind: 'regulatory',
      required: false,
      releaseState: 'published',
    }),
    module({
      id: 'minimed.tools.psychology.ru',
      kind: 'tool',
      required: false,
      releaseState: 'published',
      artifacts: [
        {
          id: 'index',
          kind: 'index',
          required: true,
          url: 'https://example.test/psychology.db',
          sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sizeBytes: 12,
          compression: 'none',
          sourceSetDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    }),
    module({
      id: 'minimed.clinical.recommendation.1',
      kind: 'clinical',
      required: false,
      releaseState: 'published',
    }),
    module({
      id: MEDICATIONS_COMPANION_MODULE_ID,
      kind: 'medication',
      required: false,
      releaseState: 'preview',
      previewDocumentCount: 4708,
    }),
  ],
};

describe('local packaged modules', () => {
  const moduleById = (id: string): ContentModuleCatalogEntry => {
    const found = catalog.modules.find((entry) => entry.id === id);
    if (!found) throw new Error(`Missing fixture module ${id}.`);
    return found;
  };

  it('treats bundled, required, and packaged companions as already installed', () => {
    expect(isPreinstalledCatalogModule(moduleById('minimed.core.ru'))).toBe(true);
    expect(isPreinstalledCatalogModule(moduleById('minimed.regulatory.pediatrics.ru'))).toBe(true);
    expect(isPreinstalledCatalogModule(moduleById('minimed.clinical.recommendation.1'))).toBe(
      false,
    );
    const merged = mergePreinstalledModules(catalog, []);
    expect(merged.map((entry) => entry.moduleId).toSorted()).toEqual([
      'minimed.core.ru',
      'minimed.regulatory.pediatrics.ru',
    ]);
  });

  it('hides download and remove for packaged companions, and remove for tool packs', () => {
    expect(catalogModuleHidesInstallAction(moduleById('minimed.regulatory.pediatrics.ru'))).toBe(
      true,
    );
    expect(catalogModuleHidesRemoveAction(moduleById('minimed.regulatory.pediatrics.ru'))).toBe(
      true,
    );
    expect(catalogModuleHidesInstallAction(moduleById('minimed.tools.psychology.ru'))).toBe(false);
    expect(catalogModuleHidesRemoveAction(moduleById('minimed.tools.psychology.ru'))).toBe(true);
    expect(catalogModuleHidesInstallAction(moduleById('minimed.clinical.recommendation.1'))).toBe(
      false,
    );
    expect(catalogModuleHidesRemoveAction(moduleById('minimed.clinical.recommendation.1'))).toBe(
      false,
    );
  });

  it('selects local published tool packs only when local artifacts are enabled', () => {
    expect(localPackagedModulesToInstall(catalog, new Set(), false)).toEqual([]);
    expect(
      localPackagedModulesToInstall(catalog, new Set(), true).map((entry) => entry.id),
    ).toEqual(['minimed.tools.psychology.ru']);
    expect(
      localPackagedModulesToInstall(catalog, new Set(['minimed.tools.psychology.ru']), true),
    ).toEqual([]);
  });

  it('treats the medications companion as installed when mounted document counts exceed core cards', () => {
    const medicationsModule = moduleById(MEDICATIONS_COMPANION_MODULE_ID);
    expect(
      isCompanionMedicationsMounted({
        medications: CORE_MEDICATION_REGISTRY_CARD_COUNT + 1,
        reference: 0,
        regulatory: 0,
        clinical: 0,
        core: 0,
      }),
    ).toBe(true);
    expect(
      isPreinstalledCatalogModule(medicationsModule, { companionMedicationsMounted: true }),
    ).toBe(true);
    const merged = mergePreinstalledModules(catalog, [], { companionMedicationsMounted: true });
    expect(merged.map((entry) => entry.moduleId)).toContain(MEDICATIONS_COMPANION_MODULE_ID);
  });
});
