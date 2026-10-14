/**
 * The ЕСКЛП МНН-card modules as published, for the index builders (INT1, SAFE1).
 *
 * The builders read the cards from the modules the catalog names, not from a hand-kept directory
 * of decoded databases: each group module is found among the local release copies
 * (`output/module-zstd-*`) by the SHA-256 the catalog states, decoded into a scratch directory and
 * deleted after the build. `--esklp-dir` replaces this with a directory of decoded databases
 * (the review harness uses it to rebuild an index from an earlier ЕСКЛП release).
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CatalogEsklpModule {
  readonly id: string;
  readonly artifacts: readonly { readonly sha256: string }[];
}

/** ЕСКЛП group modules: `minimed.medications.<group>.ru`, not the instructions, Allmed or images. */
export function isEsklpGroupModule(id: string): boolean {
  return (
    /^minimed\.medications\.[a-z-]+\.ru$/u.test(id) &&
    !id.includes('.instructions.') &&
    id !== 'minimed.medications.ru' &&
    id !== 'minimed.medications.packaging-images.ru'
  );
}

function sha256File(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function releaseCopies(dataRoot: string, fileName: string): readonly string[] {
  const output = join(dataRoot, 'output');
  if (!existsSync(output)) return [];
  const found: string[] = [];
  const visit = (directory: string, depth: number): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && depth < 3) visit(path, depth + 1);
      else if (entry.name === fileName) found.push(path);
    }
  };
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('module-zstd-')) {
      visit(join(output, entry.name), 1);
    }
  }
  return found.toSorted();
}

/** Decodes the published group modules of the catalog into `target`; returns the databases. */
export function decodePublishedEsklp(
  modules: readonly CatalogEsklpModule[],
  dataRoot: string,
  target: string,
): readonly string[] {
  mkdirSync(target, { recursive: true });
  const decoded: string[] = [];
  for (const module of modules.filter((item) => isEsklpGroupModule(item.id))) {
    const wanted = module.artifacts[0]?.sha256;
    const source = releaseCopies(dataRoot, `${module.id}.db.zst`).find(
      (path) => sha256File(path) === wanted,
    );
    if (!wanted || !source) {
      throw new Error(
        `The published file of ${module.id} (${wanted}) is not among the local copies`,
      );
    }
    const output = join(target, `${module.id}.db`);
    const result = Bun.spawnSync(['zstd', '-d', '-q', '-f', source, '-o', output]);
    if (result.exitCode !== 0) throw new Error(`zstd failed on ${module.id}`);
    decoded.push(output);
  }
  return decoded;
}

/**
 * Runs `use` with a directory of decoded ЕСКЛП databases: `directory` when given, otherwise the
 * published modules decoded into a scratch directory that is removed afterwards.
 */
export function withEsklpDirectory<T>(
  options: {
    readonly directory: string | undefined;
    readonly modules: readonly CatalogEsklpModule[];
    readonly dataRoot: string;
  },
  use: (directory: string) => T,
): T {
  if (options.directory) return use(options.directory);
  const scratch = join(tmpdir(), `esklp-published-${process.pid}`);
  try {
    decodePublishedEsklp(options.modules, options.dataRoot, scratch);
    return use(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The `esklp.mnn.*` cards of a directory of decoded databases, with their raw metadata. */
export function readEsklpCardMetadata(directory: string): readonly {
  readonly id: string;
  readonly title: string;
  readonly metadata: Record<string, unknown>;
}[] {
  const rows: { id: string; title: string; metadata: Record<string, unknown> }[] = [];
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .toSorted()) {
    const database = new Database(join(directory, file), { readonly: true });
    const query = database.query<{ id: string; title: string; metadata_json: string }, []>(
      "select id, title, metadata_json from documents where id like 'esklp.mnn.%'",
    );
    for (const row of query.all()) {
      rows.push({
        id: row.id,
        title: row.title,
        metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      });
    }
    database.close();
  }
  return rows;
}
