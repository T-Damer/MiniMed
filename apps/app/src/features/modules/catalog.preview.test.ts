import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import rawCatalog from '@/features/modules/catalog.preview.json';
import { drugModules } from '@/features/onboarding/onboarding-downloads';

const ESKLP_MODULE_IDS = [
  'minimed.medications.alimentary-metabolism.ru',
  'minimed.medications.antiinfectives.ru',
  'minimed.medications.antineoplastic-immunomodulating.ru',
  'minimed.medications.antiparasitic.ru',
  'minimed.medications.blood.ru',
  'minimed.medications.cardiovascular.ru',
  'minimed.medications.dermatological.ru',
  'minimed.medications.genitourinary-hormones.ru',
  'minimed.medications.musculoskeletal.ru',
  'minimed.medications.nervous-system.ru',
  'minimed.medications.respiratory.ru',
  'minimed.medications.sensory-organs.ru',
  'minimed.medications.systemic-hormones.ru',
  'minimed.medications.unclassified.ru',
  'minimed.medications.various.ru',
] as const;

describe('catalog.preview.json', () => {
  it('parses with ContentModuleCatalogSchema', () => {
    const result = ContentModuleCatalogSchema.safeParse(rawCatalog);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw result.error;
    }
    expect(result.data.modules.some((module) => module.kind === 'tool')).toBe(true);

    expect(
      result.data.modules.find((module) => module.id === 'minimed.tools.pediatrics-growth.ru'),
    ).toMatchObject({
      version: '0.3.0',
      releaseState: 'preview',
      toolKinds: ['calculator'],
      toolCount: 2,
    });

    const medicationsModule = result.data.modules.find(
      (module) => module.id === 'minimed.medications.ru',
    );
    expect(medicationsModule).toBeDefined();
    if (!medicationsModule) {
      throw new Error('Missing Allmed medications companion module.');
    }
    expect(medicationsModule).toMatchObject({
      version: 'allmed-c8e85a688094.e5',
      title: 'Лекарственные препараты — дополнительный справочник Allmed',
      description:
        'Локальный дополнительный справочник Allmed с названиями, формами и справочными сведениями; не является официальным реестром ГРЛС, полной инструкцией или источником доверенных дозировок.',
      required: false,
      releaseState: 'preview',
      tags: ['drugs', 'allmed', 'supplemental-reference'],
      sourceSetDigest: 'sha256:7b8a22cef1a7bb7338765106b57dfdf52f60f21f7b8570a4bf74443d34b55200',
      sizes: {
        // The search-compacted build of the same source set with e5 vectors for its indication
        // sections, as framed zstd.
        downloadBytes: 50_354_612,
        installedBytes: 279_375_872,
        sourceAssetsDownloadBytes: null,
        precision: 'exact',
      },
      capabilities: {
        images: false,
        originalPdf: false,
        structuredKnowledge: false,
      },
      documents: [],
      previewDocumentCount: 4708,
    });
    expect(medicationsModule.compatibility.minAppVersion).toBe('0.6.48');
    expect(medicationsModule.artifacts).toHaveLength(1);
    expect(medicationsModule.artifacts[0]).toMatchObject({
      kind: 'index',
      compression: 'zstd',
      url: 'https://github.com/T-Damer/MiniMed/releases/download/allmed-2026.10.05-2d39a7fc2b43-e5/minimed.medications.ru.db.zst',
      decodedSizeBytes: 279_375_872,
      // The source set is the one of the unchanged Allmed snapshot, so installed copies stay valid.
      sourceSetDigest: medicationsModule.sourceSetDigest,
    });
    expect(medicationsModule.tags).not.toContain('registry');
    expect(medicationsModule.tags).not.toContain('instructions');
    expect(result.data.modules.find((module) => module.id === 'minimed.core.ru')).toMatchObject({
      version: '1.0.0-preview.8',
      sourceSetDigest: 'sha256:8e68982002d4fe01efe765ba06969cd13d72a94ce6ff6fce46c51cf2479e1993',
      sizes: {
        downloadBytes: 0,
        installedBytes: 513_986_560,
        precision: 'exact',
      },
    });
    const esklpModules = result.data.modules.filter((module) => module.collection === 'esklp');
    expect(esklpModules.map((module) => module.id).sort()).toEqual([...ESKLP_MODULE_IDS].sort());
    for (const module of esklpModules) {
      expect(module.releaseState).toBe('preview');
      expect(module.documents.length).toBeGreaterThan(0);
      expect(new Set(module.documents.map((document) => document.documentId)).size).toBe(
        module.previewDocumentCount,
      );
      for (const document of module.documents) {
        expect(document.indexArtifactId).toBe(module.artifacts[0]?.id);
      }
      expect(module.previewDocumentCount).toBeGreaterThan(0);
      expect(module.artifacts).toHaveLength(1);
      // ESKLP indexes ship as framed zstd since 0.6.46 (C1); the app decodes them into OPFS.
      expect(module.artifacts[0]).toMatchObject({
        kind: 'index',
        compression: 'zstd',
        url: `https://github.com/T-Damer/MiniMed/releases/download/esklp-2026-08-28/${module.id}.db.zst`,
      });
      expect(module.compatibility.minAppVersion).toBe('0.6.46');
    }
  });

  it('lists one official-instruction module per ЕСКЛП group, served as zstd from the dataset mirror', () => {
    const catalog = ContentModuleCatalogSchema.parse(rawCatalog);
    const instructionModules = catalog.modules.filter(
      (module) => module.collection === 'grls-instructions',
    );
    expect(instructionModules.map((module) => module.id).sort()).toEqual(
      ESKLP_MODULE_IDS.map((id) =>
        id.replace('minimed.medications.', 'minimed.medications.instructions.'),
      ).sort(),
    );
    for (const module of instructionModules) {
      expect(module).toMatchObject({
        kind: 'medication',
        releaseState: 'preview',
        required: false,
        dependencies: [{ moduleId: 'minimed.core.ru', required: true }],
        compatibility: { minAppVersion: '0.6.48', schemaVersion: 2 },
      });
      expect(module.previewDocumentCount).toBeGreaterThan(0);
      expect(module.artifacts).toHaveLength(1);
      expect(module.artifacts[0]).toMatchObject({
        kind: 'index',
        compression: 'zstd',
        url: expect.stringMatching(
          new RegExp(
            `^https://github.com/T-Damer/MiniMed/releases/download/grls-instructions-2026\\.10\\.05-[0-9a-f]{12}-e5/${module.id.replaceAll('.', '\\.')}\\.db\\.zst$`,
            'u',
          ),
        ),
      });
      expect(module.sizes.downloadBytes).toBe(module.artifacts[0]?.sizeBytes);
      expect(module.sizes.installedBytes).toBe(module.artifacts[0]?.decodedSizeBytes);
    }
    // 8 944 prepared instructions of 8 947 (three fail lint; see docs/CURRENT_STATE.md «GI1»).
    expect(instructionModules.reduce((sum, module) => sum + module.previewDocumentCount, 0)).toBe(
      8944,
    );
  });

  it('lists the manufacturer-site instructions as one separately labelled module, not a ГРЛС group', () => {
    const catalog = ContentModuleCatalogSchema.parse(rawCatalog);
    const module = catalog.modules.find(
      (entry) => entry.id === 'minimed.medications.instructions.manufacturer-site.ru',
    );
    expect(module).toMatchObject({
      version: 'manufacturer-2026.10.05',
      kind: 'medication',
      // Not `grls-instructions`: the sections feature maps that collection to the per-ATC groups.
      collection: 'manufacturer-instructions',
      title: 'Инструкции с сайтов производителей',
      releaseState: 'preview',
      required: false,
      tags: ['manufacturer-site', 'official-instruction', 'instructions'],
      dependencies: [{ moduleId: 'minimed.core.ru', required: true }],
      compatibility: { minAppVersion: '0.6.48', schemaVersion: 2 },
      // 272 documents of the 277 manufacturer files (five match only ambiguously and are left out);
      // see docs/CURRENT_STATE.md «Manufacturer-site instruction module».
      previewDocumentCount: 272,
    });
    expect(module?.description).toContain('не файлы ГРЛС');
    expect(module?.artifacts).toHaveLength(1);
    expect(module?.artifacts[0]).toMatchObject({
      kind: 'index',
      compression: 'zstd',
      url: expect.stringMatching(
        /^https:\/\/github\.com\/T-Damer\/MiniMed\/releases\/download\/manufacturer-instructions-2026\.10\.05-[0-9a-f]{12}\/minimed\.medications\.instructions\.manufacturer-site\.ru\.db\.zst$/u,
      ),
    });
    expect(module?.sizes.downloadBytes).toBe(module?.artifacts[0]?.sizeBytes);
    expect(module?.sizes.installedBytes).toBe(module?.artifacts[0]?.decodedSizeBytes);
    // It does not widen the per-group set the instruction-module tests count.
    expect(
      catalog.modules.filter((entry) => entry.collection === 'grls-instructions'),
    ).toHaveLength(ESKLP_MODULE_IDS.length);
  });

  it('puts the official-instruction and Allmed packages into the «Скачать препараты» set', () => {
    const catalog = ContentModuleCatalogSchema.parse(rawCatalog);
    const ids = new Set(drugModules(catalog, () => true).map((module) => module.id));
    expect(ids.has('minimed.medications.ru')).toBe(true);
    for (const id of ESKLP_MODULE_IDS) {
      expect(ids.has(id)).toBe(true);
      expect(ids.has(id.replace('minimed.medications.', 'minimed.medications.instructions.'))).toBe(
        true,
      );
    }
  });
});
