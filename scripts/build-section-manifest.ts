/**
 * Builds the section manifest of the «Скачать по разделам» download: for every clinical section
 * (a clinical collection of the module catalog) the drug groups its recommendations name.
 *
 *   bun scripts/build-section-manifest.ts [--check]
 *
 * Inputs: `apps/app/src/features/modules/catalog.preview.json` and the ЕСКЛП МНН relations of
 * every recommendation in `data/build/clinical-medication-relations/<КР id>.json` (kept out of
 * git; produced by the clinical medication relation build). Output:
 * `apps/app/src/features/sections/section-manifest.json`. `--check` regenerates in memory and
 * fails when the sections or the relations differ from the committed file.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { ContentModuleCatalogSchema } from '@localmed/contracts';

import {
  ClinicalMedicationRelationsSchema,
  type ClinicalRelationsFile,
  deriveSectionManifest,
} from '../apps/app/src/features/sections/section-manifest-source';

const CATALOG_FILE = 'apps/app/src/features/modules/catalog.preview.json';
const RELATIONS_DIRECTORY = 'data/build/clinical-medication-relations';
const OUTPUT_FILE = 'apps/app/src/features/sections/section-manifest.json';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function buildManifestText(): string {
  const catalogBytes = readFileSync(CATALOG_FILE);
  const catalog = ContentModuleCatalogSchema.parse(JSON.parse(catalogBytes.toString('utf8')));
  const relations: ClinicalRelationsFile[] = readdirSync(RELATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const bytes = readFileSync(join(RELATIONS_DIRECTORY, fileName));
      return {
        fileName,
        sha256: sha256(bytes),
        content: ClinicalMedicationRelationsSchema.parse(JSON.parse(bytes.toString('utf8'))),
      };
    });
  const relationsDigest = sha256(
    Buffer.from(relations.map((file) => `${file.fileName}\t${file.sha256}\n`).join('')),
  );
  const manifest = deriveSectionManifest({
    catalog,
    relations,
    catalogFile: CATALOG_FILE,
    catalogSha256: sha256(catalogBytes),
    relationsDirectory: RELATIONS_DIRECTORY,
    relationsDigest,
    generator: 'scripts/build-section-manifest.ts',
  });
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  const text = buildManifestText();
  if (values.check) {
    // The catalog is republished often; only its effect on the sections matters here.
    const comparable = (value: string): string => {
      const manifest = JSON.parse(value) as {
        provenance: { catalogSha256?: unknown; catalogVersion?: unknown };
      };
      manifest.provenance.catalogSha256 = undefined;
      manifest.provenance.catalogVersion = undefined;
      return JSON.stringify(manifest);
    };
    if (comparable(readFileSync(OUTPUT_FILE, 'utf8')) !== comparable(text)) {
      throw new Error(`${OUTPUT_FILE} is stale; run: bun scripts/build-section-manifest.ts`);
    }
    console.log(`${OUTPUT_FILE} is current.`);
  } else {
    writeFileSync(OUTPUT_FILE, text);
    console.log(`Wrote ${OUTPUT_FILE}`);
  }
}
