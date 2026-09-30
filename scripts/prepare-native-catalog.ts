import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ContentModuleArtifactSchema,
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '@localmed/contracts';
import { z } from 'zod';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'apps/app/src/features/modules/catalog.preview.json');
const output = resolve(
  root,
  'native/shared/src/commonMain/composeResources/files/native-module-catalog.json',
);
const catalog = ContentModuleCatalogSchema.parse(JSON.parse(await readFile(source, 'utf8')));
const transports = z
  .array(
    z.object({
      moduleId: z.string().min(1),
      moduleVersion: z.string().min(1),
      indexArtifactId: z.string().min(1),
      sourceSetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      transport: z.record(z.string(), z.unknown()),
    }),
  )
  .parse(JSON.parse(await readFile(resolve(root, 'native/catalog-gzip-transports.json'), 'utf8')));

const replaced = new Set<string>();
for (const entry of transports) {
  const module = catalog.modules.find((candidate) => candidate.id === entry.moduleId);
  const indexes = module?.artifacts.filter((artifact) => artifact.kind === 'index') ?? [];
  const index = indexes[0];
  if (
    !module ||
    module.version !== entry.moduleVersion ||
    indexes.length !== 1 ||
    !index ||
    index.id !== entry.indexArtifactId ||
    index.compression !== 'zstd' ||
    index.sourceSetDigest !== entry.sourceSetDigest ||
    replaced.has(module.id)
  )
    throw new Error(`Native transport does not match the sole index edition: ${entry.moduleId}`);
  const gzip = ContentModuleArtifactSchema.parse({
    ...entry.transport,
    id: index.id,
    kind: index.kind,
    required: index.required,
  });
  if (
    gzip.compression !== 'gzip' ||
    gzip.sourceSetDigest !== index.sourceSetDigest ||
    gzip.decodedSha256 !== index.decodedSha256 ||
    gzip.decodedSizeBytes !== index.decodedSizeBytes ||
    !gzip.url?.startsWith('https://github.com/T-Damer/MiniMed/releases/download/')
  )
    throw new Error(`Native gzip changes the source edition: ${entry.moduleId}`);
  const position = module.artifacts.indexOf(index);
  module.artifacts[position] = gzip;
  replaced.add(module.id);
}

if (
  catalog.modules.some((module) =>
    module.artifacts.some(
      (artifact) => artifact.kind === 'index' && artifact.compression === 'zstd',
    ),
  )
)
  throw new Error('Native catalog still contains an unsupported zstd index.');

// Validate again after projection; membership and artifact ownership must still agree.
const validated = ContentModuleCatalogSchema.parse(catalog);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${serializeContentModuleCatalog(validated)}\n`);
console.log(JSON.stringify({ modules: validated.modules.length, gzipTransports: replaced.size }));
