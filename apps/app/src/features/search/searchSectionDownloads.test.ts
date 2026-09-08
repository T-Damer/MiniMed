import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { searchCatalogTools } from '@/features/search/searchCatalog';
import { searchSectionDownloadBlocks } from './searchSectionDownloads';

const document = (metadata?: MedicalDocumentSummary['metadata']): MedicalDocumentSummary => ({
  id: 'test-pointer',
  title: 'Источник',
  shortTitle: null,
  sourceType: 'core_catalog_pointer',
  specialties: ['pediatrics'],
  status: 'active',
  versionId: 'v1',
  versionLabel: '1',
  effectiveFrom: null,
  ...(metadata ? { metadata } : {}),
});

describe('search section downloads', () => {
  it('uses exact tool membership and deduplicates a shared package at the parent', () => {
    const tools = searchCatalogTools();
    const blocks = searchSectionDownloadBlocks([], tools, MODULE_CATALOG);
    const neonatal = blocks.get('assessments/neonatology');
    expect(neonatal?.modules.map((module) => module.id)).toEqual(['minimed.tools.neonatology.ru']);
    const all = blocks.get('all/');
    expect(
      all?.modules.filter((module) => module.id === 'minimed.tools.neonatology.ru'),
    ).toHaveLength(1);
    expect(blocks.get('calculators/unit-conversion')).toMatchObject({
      local: true,
      unavailable: false,
      modules: [],
    });
    expect(blocks.has('diagnosis/')).toBe(false);
  });

  it('requires a verified index target for pointer downloads, not just matching specialty', () => {
    const module = MODULE_CATALOG.modules.find(
      (entry) => entry.releaseState === 'published' && entry.documents.length > 0,
    );
    if (!module?.documents[0]) throw new Error('Missing published document fixture');
    const metadata = {
      contentMode: 'module-pointer',
      targetDocumentId: module.documents[0].documentId,
      primaryModuleId: module.id,
      moduleIds: [module.id],
      catalogFamily: 'clinical',
    };
    const blocks = searchSectionDownloadBlocks([document(metadata)], [], MODULE_CATALOG);
    expect(blocks.get('guidelines/pediatrics')?.modules.map((entry) => entry.id)).toEqual([
      module.id,
    ]);
    const missing = searchSectionDownloadBlocks(
      [document({ ...metadata, targetDocumentId: 'absent-target' })],
      [],
      MODULE_CATALOG,
    );
    expect(missing.get('guidelines/pediatrics')).toEqual({
      modules: [],
      local: false,
      unavailable: true,
    });
    const invalid = searchSectionDownloadBlocks([document(metadata)], [], {
      ...MODULE_CATALOG,
      modules: [
        {
          ...module,
          artifacts: module.artifacts.map((artifact) => ({ ...artifact, sha256: null })),
        },
      ],
    });
    expect(invalid.get('guidelines/pediatrics')?.modules).toEqual([]);
  });

  it('tracks bundled source content and condition subtypes independently', () => {
    const blocks = searchSectionDownloadBlocks(
      [{ ...document(), id: 'icd-a00', sourceType: 'rls_mkb_reference', title: 'A00 Холера' }],
      [],
      MODULE_CATALOG,
    );
    expect(blocks.get('conditions/kind:icd')).toEqual({
      modules: [],
      local: true,
      unavailable: false,
    });
    expect(blocks.has('conditions/kind:symptom')).toBe(false);
  });
});
