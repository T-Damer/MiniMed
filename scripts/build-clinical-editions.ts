/**
 * Writes `catalog.clinical-editions.json`: the edition chain of every clinical recommendation code
 * (old edition ↔ new edition, ids, versions, publication dates, which edition is a catalog module,
 * and the checksum of the stored raw JSON). The module catalog schema has no field that links two
 * modules, so the link lives in this sidecar; the superseded edition itself is marked
 * `superseded` in the catalog's document table.
 *
 *   bun scripts/build-clinical-editions.ts \
 *     --registry data/raw/official-clinical-registry/2026-10-02/catalog-all-statuses.json \
 *     --raw-dir data/raw/official-clinical-documents \
 *     [--catalog apps/app/src/features/modules/catalog.preview.json] \
 *     [--output apps/app/src/features/modules/catalog.clinical-editions.json]
 *
 * Input records come from `medbase-clinical-catalog official-sync --status all`. Registry status 0 is
 * the current edition, status 4 an edition replaced by a newer one (its JSON is still downloadable);
 * statuses 1–3 are archived or cancelled records and are not editions of a live recommendation.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const MODULE_ID_PREFIX = 'minimed.clinical.recommendation.';

export interface RegistryRecord {
  readonly id: string;
  readonly name: string;
  readonly officialMetadata: {
    readonly Id: number;
    readonly Code: number;
    readonly Version: number;
    readonly CodeVersion: string;
    readonly Status: number;
    readonly PublishDateStr: string | null;
  };
}

export interface ClinicalEdition {
  readonly id: string;
  readonly version: number;
  readonly status: 'active' | 'superseded';
  readonly publishedAt: string | null;
  readonly registryId: number;
  /** Next edition by version number for a replaced edition (inferred: the registry's `PrevCrId` is empty). */
  readonly replacedBy: string | null;
  /** Catalog module that ships this edition, or null when only the raw JSON is kept. */
  readonly moduleId: string | null;
  /** SHA-256 of the stored raw `GetClinrec2` JSON (hex), null when it was not downloaded. */
  readonly rawJsonSha256: string | null;
}

export interface ClinicalEditionCode {
  readonly code: number;
  readonly title: string;
  readonly editions: readonly ClinicalEdition[];
}

export interface ClinicalEditionsSidecar {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly registry: {
    readonly api: string;
    readonly retrievedAt: string;
    readonly sha256: string;
    readonly records: number;
    readonly statusCounts: Record<string, number>;
  };
  readonly note: string;
  readonly codes: readonly ClinicalEditionCode[];
}

function sha256File(path: string): string | null {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

export function buildClinicalEditions(input: {
  readonly records: readonly RegistryRecord[];
  readonly catalogModuleIds: ReadonlySet<string>;
  readonly rawJsonSha256: (officialId: string) => string | null;
}): ClinicalEditionCode[] {
  const byCode = new Map<number, RegistryRecord[]>();
  for (const record of input.records) {
    const { Status: status, Code: code } = record.officialMetadata;
    if (status !== 0 && status !== 4) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), record]);
  }
  const codes: ClinicalEditionCode[] = [];
  for (const [code, records] of [...byCode.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...records].sort(
      (a, b) => a.officialMetadata.Version - b.officialMetadata.Version,
    );
    const ids = new Set(sorted.map((record) => record.id));
    if (ids.size !== sorted.length) throw new Error(`Code ${code} lists an edition twice.`);
    if (sorted.length < 2) continue;
    const editions = sorted.map((record, index): ClinicalEdition => {
      const moduleId = `${MODULE_ID_PREFIX}${record.id}`;
      return {
        id: record.id,
        version: record.officialMetadata.Version,
        status: record.officialMetadata.Status === 0 ? 'active' : 'superseded',
        publishedAt: record.officialMetadata.PublishDateStr,
        registryId: record.officialMetadata.Id,
        replacedBy: record.officialMetadata.Status === 4 ? (sorted[index + 1]?.id ?? null) : null,
        moduleId: input.catalogModuleIds.has(moduleId) ? moduleId : null,
        rawJsonSha256: input.rawJsonSha256(record.id),
      };
    });
    const latest = sorted[sorted.length - 1];
    if (!latest) continue;
    codes.push({ code, title: latest.name, editions });
  }
  return codes;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      registry: { type: 'string' },
      'raw-dir': { type: 'string' },
      catalog: {
        type: 'string',
        default: 'apps/app/src/features/modules/catalog.preview.json',
      },
      output: {
        type: 'string',
        default: 'apps/app/src/features/modules/catalog.clinical-editions.json',
      },
    },
  });
  const registryPath = values.registry;
  const rawDir = values['raw-dir'];
  if (!registryPath || !rawDir) {
    throw new Error('Usage: bun scripts/build-clinical-editions.ts --registry FILE --raw-dir DIR');
  }
  const registryBytes = readFileSync(registryPath);
  const registry = JSON.parse(registryBytes.toString('utf8')) as {
    generatedAt: string;
    apiUrl: string;
    totalRecords: number;
    records: RegistryRecord[];
  };
  const catalog = JSON.parse(readFileSync(values.catalog, 'utf8')) as {
    modules: { id: string }[];
  };
  const statusCounts: Record<string, number> = {};
  for (const record of registry.records) {
    const key = String(record.officialMetadata.Status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  const sidecar: ClinicalEditionsSidecar = {
    schemaVersion: 1,
    generatedAt: registry.generatedAt,
    registry: {
      api: registry.apiUrl,
      retrievedAt: registry.generatedAt,
      sha256: createHash('sha256').update(registryBytes).digest('hex'),
      records: registry.totalRecords,
      statusCounts,
    },
    note:
      'Edition chains of clinical recommendations with at least two editions (registry status 0 = current, 4 = replaced). ' +
      '`moduleId` is the catalog module that ships the edition; null means only the raw JSON is kept locally under ' +
      'data/raw/official-clinical-documents/<id>.json. The catalog marks replaced editions as superseded in their document table.',
    codes: buildClinicalEditions({
      records: registry.records,
      catalogModuleIds: new Set(catalog.modules.map((module) => module.id)),
      rawJsonSha256: (officialId) => sha256File(join(rawDir, `${officialId}.json`)),
    }),
  };
  writeFileSync(values.output, `${JSON.stringify(sidecar)}\n`);
  const editions = sidecar.codes.reduce((sum, code) => sum + code.editions.length, 0);
  console.log(`${values.output}: ${sidecar.codes.length} codes, ${editions} editions.`);
}
