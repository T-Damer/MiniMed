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

  it("treats the doctor's own calculators as local, never as a missing download", () => {
    const own = {
      id: 'user-calculator:uc-abcdef123456',
      scope: 'calculators' as const,
      icon: 'calculator' as const,
      title: 'ИМТ',
      description: 'Индекс массы тела',
      aliases: [],
      group: 'custom',
      href: '#/calculators/uc-abcdef123456',
      ageScope: { groups: ['adults' as const], basis: 'Указано автором инструмента.' },
    };
    const blocks = searchSectionDownloadBlocks([], [own], MODULE_CATALOG);
    expect(blocks.get('calculators/custom')).toMatchObject({
      local: true,
      unavailable: false,
      modules: [],
    });
    expect(blocks.get('calculators/')).toMatchObject({ unavailable: false });
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

it('offers medication packs on a fresh core without document pointers', () => {
  const blocks = searchSectionDownloadBlocks([], [], MODULE_CATALOG);
  const medications = blocks.get('medications/')?.modules ?? [];
  expect(medications.length).toBeGreaterThan(0);
  expect(medications.every((module) => module.kind === 'medication')).toBe(true);
  expect(medications.some((module) => module.artifacts.length === 0)).toBe(false);
  for (const module of medications) {
    expect(blocks.get(`medications/module:${module.id}`)?.modules).toContain(module);
  }
});

describe('МКБ-11 section downloads', () => {
  const icd11 = MODULE_CATALOG.modules.find((module) => module.collection === 'icd11');

  it('offers the pack from the module entry, in its section and in «Все источники»', () => {
    if (!icd11) throw new Error('The catalog has no МКБ-11 module.');
    const blocks = searchSectionDownloadBlocks([], [], MODULE_CATALOG);
    expect(blocks.get('icd11/')?.modules.map((module) => module.id)).toEqual([icd11.id]);
    expect(blocks.get('all/')?.modules).toContain(icd11);
    // The pack lists no documents, so it is no part of a clinical section.
    expect(blocks.get('conditions/')?.modules ?? []).not.toContain(icd11);
  });

  it('counts an installed card as local content of the section only', () => {
    const card = {
      ...document(),
      id: 'who.icd11.mms.257068234',
      sourceType: 'who_icd11_reference',
      specialties: [],
    };
    const blocks = searchSectionDownloadBlocks([card], [], MODULE_CATALOG);
    expect(blocks.get('icd11/')).toMatchObject({ local: true, unavailable: false });
    expect(blocks.has('conditions/')).toBe(false);
  });

  it('offers nothing when no pack is in the catalog', () => {
    const blocks = searchSectionDownloadBlocks([], [], {
      ...MODULE_CATALOG,
      modules: MODULE_CATALOG.modules.filter((module) => module.collection !== 'icd11'),
    });
    expect(blocks.has('icd11/')).toBe(false);
  });
});
