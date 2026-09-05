import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import rawCatalog from '@/features/modules/catalog.preview.json';

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
      version: 'allmed-c8e85a688094',
      title: 'Лекарственные препараты — дополнительный справочник Allmed',
      description:
        'Локальный дополнительный справочник Allmed с названиями, формами и справочными сведениями; не является официальным реестром ГРЛС, полной инструкцией или источником доверенных дозировок.',
      required: false,
      releaseState: 'preview',
      tags: ['drugs', 'allmed', 'supplemental-reference'],
      sourceSetDigest: 'sha256:7b8a22cef1a7bb7338765106b57dfdf52f60f21f7b8570a4bf74443d34b55200',
      sizes: {
        downloadBytes: null,
        installedBytes: 514_322_432,
        sourceAssetsDownloadBytes: null,
        precision: 'exact',
      },
      capabilities: {
        images: false,
        originalPdf: false,
        structuredKnowledge: false,
      },
      artifacts: [],
      documents: [],
      previewDocumentCount: 4708,
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
      expect(module.artifacts[0]).toMatchObject({
        kind: 'index',
        url: `https://github.com/T-Damer/MiniMed/releases/download/esklp-2026-08-28/${module.id}.db`,
      });
    }
  });
});
