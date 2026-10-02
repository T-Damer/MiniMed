/**
 * Adds the modules of an incremental clinical-recommendation snapshot to the committed module catalog
 * WITHOUT touching the modules that are already listed, and marks the editions that the registry
 * replaced as `superseded`. Unlike `merge-clinical-snapshot-catalog.ts` (which swaps the whole
 * individual-recommendation set) this never removes or rewrites an installed module's artifact or
 * source-set digest: a superseded edition stays downloadable and installed copies stay valid.
 *
 *   bun scripts/add-clinical-delta-modules.ts CATALOG FRAGMENT OUTPUT \
 *     --min-app-version 0.6.46 --superseded 507_3 --superseded 25_2 ...
 *
 * FRAGMENT is the `catalog-fragment.json` of `medbase-clinical-catalog package-snapshot` (after
 * `repack-module-indexes-zstd.ts --catalog-out` swapped its artifacts to the published `.db.zst`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';

const MODULE_ID_PREFIX = 'minimed.clinical.recommendation.';
const RECOMMENDATION_TAG = 'individual-recommendation';

type Raw = Record<string, unknown>;

export interface ClinicalDeltaOptions {
  readonly minAppVersion: string;
  /** Official ids (`CodeVersion`) of listed editions that the registry replaced. */
  readonly supersededOfficialIds: readonly string[];
  /**
   * A remote catalog only replaces the bundled one when its `publishedAt` is later
   * (content-module-catalog-client.ts), so a catalog that adds modules must move it forward.
   */
  readonly publishedAt?: string | undefined;
  readonly catalogVersion?: string | undefined;
}

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string): number[] =>
    value.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = [parse(version), parse(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

function moduleList(catalog: Raw): Raw[] {
  const modules = catalog['modules'];
  if (!Array.isArray(modules) || !modules.every(isRecord)) {
    throw new Error('Catalog must contain a modules array.');
  }
  return modules;
}

/** Marks every document row of one module `superseded` through the table's status override. */
function supersedeModule(module: Raw): Raw {
  const table = module['documentTable'];
  if (!isRecord(table) || !Array.isArray(table['rows'])) {
    throw new Error(`${String(module['id'])} has no document table to mark.`);
  }
  const rows = table['rows'].map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 4) throw new Error('Malformed document table row.');
    const overrides = isRecord(row[4]) ? row[4] : {};
    return [...row.slice(0, 4), { ...overrides, status: 'superseded' }];
  });
  return { ...module, documentTable: { ...table, rows } };
}

function isSuperseded(module: Raw): boolean {
  const table = module['documentTable'];
  if (!isRecord(table) || !Array.isArray(table['rows']) || table['rows'].length === 0) return false;
  return table['rows'].every(
    (row: unknown) => Array.isArray(row) && isRecord(row[4]) && row[4]['status'] === 'superseded',
  );
}

/** Recommendations a category lists that are still the current edition (the rule of the 0.6.46 catalog). */
function categoryCount(modules: readonly Raw[], categoryId: string): number {
  return modules.filter((module) => {
    const tags = Array.isArray(module['tags']) ? module['tags'] : [];
    return (
      tags.includes(RECOMMENDATION_TAG) &&
      !isSuperseded(module) &&
      (module['collection'] === categoryId || tags.includes(categoryId))
    );
  }).length;
}

export function addClinicalDeltaModules(
  catalog: Raw,
  fragmentModules: readonly Raw[],
  options: ClinicalDeltaOptions,
): Raw {
  const existing = moduleList(catalog);
  const ids = new Set(existing.map((module) => String(module['id'])));
  const added = fragmentModules.map((module): Raw => {
    const id = String(module['id']);
    if (!id.startsWith(MODULE_ID_PREFIX)) throw new Error(`Not a clinical recommendation: ${id}`);
    if (ids.has(id)) throw new Error(`Module ${id} is already listed; editions are new modules.`);
    ids.add(id);
    const compatibility = isRecord(module['compatibility']) ? module['compatibility'] : {};
    const current = String(compatibility['minAppVersion'] ?? '0.0.0');
    return {
      ...module,
      compatibility: {
        ...compatibility,
        minAppVersion: versionAtLeast(current, options.minAppVersion)
          ? current
          : options.minAppVersion,
      },
    };
  });

  const toSupersede = new Set(
    options.supersededOfficialIds.map((id) => `${MODULE_ID_PREFIX}${id}`),
  );
  const missing = [...toSupersede].filter((id) => !existing.some((module) => module['id'] === id));
  if (missing.length > 0)
    throw new Error(`Superseded modules are not listed: ${missing.join(', ')}`);
  const modules = [
    ...existing.map((module) =>
      toSupersede.has(String(module['id'])) ? supersedeModule(module) : module,
    ),
    ...added,
  ];

  const categories = Array.isArray(catalog['categories']) ? catalog['categories'] : [];
  const knownCategories = new Set(
    categories.filter(isRecord).map((category) => String(category['id'])),
  );
  for (const module of added) {
    if (!knownCategories.has(String(module['collection']))) {
      throw new Error(
        `Unknown category ${String(module['collection'])} for ${String(module['id'])}`,
      );
    }
  }
  return {
    ...catalog,
    ...(options.catalogVersion ? { catalogVersion: options.catalogVersion } : {}),
    ...(options.publishedAt ? { publishedAt: options.publishedAt } : {}),
    categories: categories.map((category) =>
      isRecord(category)
        ? { ...category, recommendationCount: categoryCount(modules, String(category['id'])) }
        : category,
    ),
    modules,
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'min-app-version': { type: 'string' },
      superseded: { type: 'string', multiple: true },
      'published-at': { type: 'string' },
      'catalog-version': { type: 'string' },
    },
  });
  const [catalogPath, fragmentPath, outputPath] = positionals;
  const minAppVersion = values['min-app-version'];
  if (!catalogPath || !fragmentPath || !outputPath || !minAppVersion) {
    throw new Error(
      'Usage: bun scripts/add-clinical-delta-modules.ts CATALOG FRAGMENT OUTPUT --min-app-version X [--superseded ID ...]',
    );
  }
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Raw;
  const fragment = JSON.parse(readFileSync(fragmentPath, 'utf8')) as { modules: Raw[] };
  const next = addClinicalDeltaModules(catalog, fragment.modules, {
    minAppVersion,
    supersededOfficialIds: values.superseded ?? [],
    publishedAt: values['published-at'],
    catalogVersion: values['catalog-version'],
  });
  ContentModuleCatalogSchema.parse(next);
  writeFileSync(outputPath, serializeContentModuleCatalog(next));
  console.log(
    `${outputPath}: ${moduleList(next).length} modules (+${fragment.modules.length}, ${(values.superseded ?? []).length} superseded).`,
  );
}
