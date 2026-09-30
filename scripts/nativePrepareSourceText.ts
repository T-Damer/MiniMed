import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const sourceDirectory = resolve(root, 'tools/benchmarks/src');
const outputDirectory = resolve(root, 'playwright/native-source-text-runtime');

// The pinned Bun resolves the Web's declaration-only mdast alias at runtime. Bundle with the
// already-installed implementation instead; the oracle still calls the actual Web functions.
try {
  const result = await Bun.build({
    entrypoints: [resolve(sourceDirectory, 'export-native-source-text.ts')],
    outdir: outputDirectory,
    target: 'bun',
    define: { 'import.meta.dirname': JSON.stringify(sourceDirectory) },
    plugins: [
      {
        name: 'installed-mark-runtime',
        setup(build) {
          build.onResolve({ filter: /^mdast-util-mark$/ }, () => ({
            path: resolve(root, 'node_modules/mdast-util-mark/index.js'),
          }));
        },
      },
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, 'Source-text oracle bundle failed');
  await import(pathToFileURL(result.outputs[0].path).href);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
