import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CORE_MEDICATION_REGISTRY_CARD_COUNT,
  catalogModuleHidesInstallAction,
  catalogModuleHidesRemoveAction,
  isCompanionMedicationsMounted,
  isModuleReleased,
  isPreinstalledCatalogModule,
  localPackagedModulesToInstall,
  MEDICATIONS_COMPANION_MODULE_ID,
  mergePreinstalledModules,
  PACKAGED_MEDICATIONS_SIZE_BYTES,
  preinstalledCatalogModule,
} from '@/features/modules/local-packaged-modules';
import { setExperimentalModulesEnabled } from '@/state/app-preferences';

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
      version: 'allmed-c8e85a688094',
      sourceSetDigest: 'sha256:7b8a22cef1a7bb7338765106b57dfdf52f60f21f7b8570a4bf74443d34b55200',
      sizes: {
        downloadBytes: null,
        installedBytes: 514_322_432,
        sourceAssetsDownloadBytes: null,
        precision: 'exact',
      },
    }),
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local packaged modules', () => {
  const moduleById = (id: string): ContentModuleCatalogEntry => {
    const found = catalog.modules.find((entry) => entry.id === id);
    if (!found) throw new Error(`Missing fixture module ${id}.`);
    return found;
  };

  it('treats only bundled and required catalog entries as already installed', () => {
    expect(isPreinstalledCatalogModule(moduleById('minimed.core.ru'))).toBe(true);
    expect(isPreinstalledCatalogModule(moduleById('minimed.regulatory.pediatrics.ru'))).toBe(false);
    expect(isPreinstalledCatalogModule(moduleById('minimed.clinical.recommendation.1'))).toBe(
      false,
    );
    const merged = mergePreinstalledModules(catalog, []);
    expect(merged.map((entry) => entry.moduleId)).toEqual(['minimed.core.ru']);
  });

  it('keeps regulatory modules downloadable and hides removal only for tool packs', () => {
    expect(catalogModuleHidesInstallAction(moduleById('minimed.regulatory.pediatrics.ru'))).toBe(
      false,
    );
    expect(catalogModuleHidesRemoveAction(moduleById('minimed.regulatory.pediatrics.ru'))).toBe(
      false,
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

  it('selects published tool packs that are not already installed', () => {
    const psychology = moduleById('minimed.tools.psychology.ru');
    expect(localPackagedModulesToInstall(catalog, new Map()).map((entry) => entry.id)).toEqual([
      'minimed.tools.psychology.ru',
    ]);
    expect(
      localPackagedModulesToInstall(
        catalog,
        new Map([['minimed.tools.psychology.ru', preinstalledCatalogModule(psychology)]]),
      ),
    ).toEqual([]);
  });

  it('selects a newer published version of an installed tool pack', () => {
    const installed = {
      ...preinstalledCatalogModule(moduleById('minimed.tools.psychology.ru')),
      version: '0.9.0',
    };

    expect(
      localPackagedModulesToInstall(
        catalog,
        new Map([['minimed.tools.psychology.ru', installed]]),
      ).map((entry) => entry.id),
    ).toEqual(['minimed.tools.psychology.ru']);
  });

  it('selects a rebuilt pack when its source digest changed without a version change', () => {
    const installed = {
      ...preinstalledCatalogModule(moduleById('minimed.tools.psychology.ru')),
      activeSourceSetDigest:
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    };

    expect(
      localPackagedModulesToInstall(
        catalog,
        new Map([['minimed.tools.psychology.ru', installed]]),
      ).map((entry) => entry.id),
    ).toEqual(['minimed.tools.psychology.ru']);
  });

  it('updates an installed preview tool pack while Experimental modules are enabled', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      dispatchEvent: () => undefined,
    });
    setExperimentalModulesEnabled(true);
    const previewTool = module({
      id: 'minimed.tools.preview.ru',
      kind: 'tool',
      required: false,
      releaseState: 'preview',
      version: '1.1.0',
      artifacts: [
        {
          id: 'preview-index',
          kind: 'index',
          required: true,
          url: 'https://example.test/preview.db',
          sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sizeBytes: 12,
          compression: 'none',
          sourceSetDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    });
    const installed = { ...preinstalledCatalogModule(previewTool), version: '1.0.0' };

    expect(
      localPackagedModulesToInstall(
        { ...catalog, modules: [...catalog.modules, previewTool] },
        new Map([[previewTool.id, installed]]),
      ).map((entry) => entry.id),
    ).toContain(previewTool.id);
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
    expect(
      merged.find((entry) => entry.moduleId === MEDICATIONS_COMPANION_MODULE_ID)
        ?.installedSizeBytes,
    ).toBe(PACKAGED_MEDICATIONS_SIZE_BYTES);
  });

  it('keeps the packaged medication size synchronized with the local Allmed artifact', () => {
    expect(PACKAGED_MEDICATIONS_SIZE_BYTES).toBe(514_322_432);
  });
});

describe('isModuleReleased', () => {
  const artifacts: ContentModuleCatalogEntry['artifacts'] = [
    {
      id: 'index',
      kind: 'index',
      required: true,
      compression: 'none',
      sizeBytes: 12,
      url: 'https://example.test/index.db',
      sha256: `sha256:${'b'.repeat(64)}`,
      sourceSetDigest: `sha256:${'a'.repeat(64)}`,
    },
  ];
  const previewModule = module({
    id: 'minimed.clinical.preview',
    artifacts,
    kind: 'clinical',
    releaseState: 'preview',
    required: false,
  });
  const publishedModule = module({
    id: 'minimed.clinical.published',
    artifacts,
    kind: 'clinical',
    releaseState: 'published',
    required: false,
  });

  function installLocalStorageMock(): void {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: () => undefined,
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never offers an unbuilt local preview even when experiments are enabled', () => {
    installLocalStorageMock();
    setExperimentalModulesEnabled(true);
    expect(isModuleReleased({ ...previewModule, artifacts: [] })).toBe(false);
    expect(isModuleReleased({ ...publishedModule, artifacts: [] })).toBe(false);
    expect(
      isModuleReleased({
        ...previewModule,
        artifacts: artifacts.map((artifact) => ({ ...artifact, required: false })),
      }),
    ).toBe(false);
  });

  it('keeps published modules installable regardless of the experimental toggle', () => {
    installLocalStorageMock();
    setExperimentalModulesEnabled(false);
    expect(isModuleReleased(publishedModule)).toBe(true);
    setExperimentalModulesEnabled(true);
    expect(isModuleReleased(publishedModule)).toBe(true);
  });

  it('unlocks preview modules only while the experimental toggle is on', () => {
    installLocalStorageMock();
    setExperimentalModulesEnabled(false);
    expect(isModuleReleased(previewModule)).toBe(false);
    setExperimentalModulesEnabled(true);
    expect(isModuleReleased(previewModule)).toBe(true);
    expect(
      isModuleReleased(
        module({
          id: 'minimed.clinical.planned',
          kind: 'clinical',
          releaseState: 'planned',
          required: false,
        }),
      ),
    ).toBe(false);
  });
});
