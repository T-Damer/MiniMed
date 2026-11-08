import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The token in `public/sw.js` that the build replaces with the JSON of {@link ServiceWorkerBuild}. */
export const SERVICE_WORKER_BUILD_PLACEHOLDER = '/*__MINIMED_BUILD__*/ null';
export const BUILD_MANIFEST_FILE = 'build-manifest.json';

/** A wasm module above this size (ONNX runtime) is fetched on first use, not at install. */
export const PRECACHE_MAX_WASM_BYTES = 3 * 1024 * 1024;

export interface BuildFile {
  /** Path inside the build output, `/`-separated. */
  readonly path: string;
  readonly bytes: number;
}

export type BuildFileRole = 'precache' | 'app' | 'optional' | 'skip';

/** What a build for one job keeps (`shellAssets`): its screens' assets, and when to fetch them. */
export interface JobShell {
  /** Every asset the job's screens need. */
  readonly assets: ReadonlySet<string>;
  /**
   * The assets of the screen shown before sign-in (the doctors' diaries, DIARY24): stored at
   * install, the rest of `assets` once the page says the user is in (`CACHE_APP` in sw.js). All of
   * `assets` are stored at install when absent.
   */
  readonly signIn?: ReadonlySet<string>;
  /** The job opens no search core: the core's boot content and the onboarding pictures stay out. */
  readonly noSearch?: boolean;
}

export interface ServiceWorkerBuild {
  readonly id: string;
  readonly version: string;
  /** Files stored at install: the whole UI works offline from them (or the sign-in, with `app`). */
  readonly precache: readonly string[];
  /** Files stored once the user is signed in (`CACHE_APP`); empty for a build without sign-in. */
  readonly app: readonly string[];
  /** Same-origin files kept after their first use only (large or rarely needed). */
  readonly optional: readonly string[];
  /** Directories whose files are kept after first use (pdf.js, DICOM codecs, Excalidraw fonts). */
  readonly optionalPrefixes: readonly string[];
  readonly precacheBytes: number;
  readonly appBytes: number;
}

// Small files the app fetches on every start to open its core (core-report.json names the OPFS
// file of the core; the two companion packs are read into memory each time). Without them an
// offline reload cannot open the search core. The 440 MB core.db itself is never listed.
// regulatory.db is the light pack (323-ФЗ + a card per other act, 3.3 MB); the full texts are the
// downloadable regulatory module (docs/REGULATORY_PACK.md), kept in OPFS/IndexedDB, not here.
export const BOOT_CONTENT_FILES: readonly string[] = [
  'content/core-report.json',
  'content/reference.db',
  'content/regulatory.db',
];

// Not part of the shell: the worker itself, its manifest, the patient diary (own worker), content
// packs and modules (OPFS/IndexedDB), OCR language data (verified on-demand download).
const SKIPPED = /^(?:sw\.js|build-manifest\.json|diary\/|content\/|tessdata\/)/u;
// Code and runtime for features that need a downloaded model or are heavy: kept after first use.
const OPTIONAL_DIRECTORIES = /^(?:pdfjs|cornerstone-codecs|excalidraw|tools)\//u;
const OPTIONAL_ASSETS = /^assets\/(?:ort-|tesseract-core)/u;

/**
 * `shell`: for a build made for one job (the diaries copy), the `assets/` files that job's screens
 * need; every other asset is kept after its first use instead of being downloaded at install.
 */
export function classifyBuildFile(file: BuildFile, shell?: JobShell | undefined): BuildFileRole {
  const { path } = file;
  if (BOOT_CONTENT_FILES.includes(path)) return shell?.noSearch ? 'skip' : 'precache';
  if (SKIPPED.test(path) || path.split('/').some((part) => part.startsWith('.'))) return 'skip';
  if (OPTIONAL_DIRECTORIES.test(path) || OPTIONAL_ASSETS.test(path)) return 'optional';
  if (path.startsWith('assets/')) {
    if (shell && !shell.assets.has(path)) return 'optional';
    if (path.endsWith('.wasm') && file.bytes > PRECACHE_MAX_WASM_BYTES) return 'optional';
    return shell?.signIn && !shell.signIn.has(path) ? 'app' : 'precache';
  }
  if (path.startsWith('onboarding/')) return shell?.noSearch ? 'skip' : 'precache';
  // diaries/: the diaries app's manifest, icons and boot icon (index.html swaps them in).
  if (path.startsWith('fonts/') || path.startsWith('diaries/')) return 'precache';
  // index.html, the manifest and the icons sit at the root of the build.
  return path.includes('/') ? 'skip' : 'precache';
}

/**
 * The build id changes with any byte of the shell: hashed `assets/*` names already carry their
 * content hash, every other file contributes its own digest.
 */
export function createServiceWorkerBuild(
  files: readonly BuildFile[],
  version: string,
  digestOf: (path: string) => string,
  shell?: JobShell | undefined,
): ServiceWorkerBuild {
  const precache: string[] = [];
  const app: string[] = [];
  const optional: string[] = [];
  const optionalPrefixes = new Set<string>();
  let precacheBytes = 0;
  let appBytes = 0;
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const role = classifyBuildFile(file, shell);
    if (role === 'precache') {
      precache.push(file.path);
      precacheBytes += file.bytes;
    } else if (role === 'app') {
      app.push(file.path);
      appBytes += file.bytes;
    } else if (role === 'optional') {
      const directory = OPTIONAL_DIRECTORIES.exec(file.path)?.[0];
      if (directory) optionalPrefixes.add(directory);
      else optional.push(file.path);
    }
  }
  if (!precache.includes('index.html')) {
    throw new Error('The build has no index.html to precache.');
  }
  const hash = createHash('sha256');
  hash.update(version);
  for (const path of precache) {
    hash.update(`\n${path}\0${path.startsWith('assets/') ? '' : digestOf(path)}`);
  }
  for (const path of app) hash.update(`\nApp ${path}\0`);
  for (const path of optional) hash.update(`\n${path}\0`);
  const prefixes = [...optionalPrefixes].sort();
  for (const prefix of prefixes) hash.update(`\n${prefix}\0`);
  return {
    id: hash.digest('hex').slice(0, 12),
    version,
    precache,
    app,
    optional,
    optionalPrefixes: prefixes,
    precacheBytes,
    appBytes,
  };
}

export function injectServiceWorkerBuild(source: string, build: ServiceWorkerBuild): string {
  if (!source.includes(SERVICE_WORKER_BUILD_PLACEHOLDER)) {
    throw new Error('sw.js lost its build placeholder; the precache list cannot be injected.');
  }
  return source.replace(SERVICE_WORKER_BUILD_PLACEHOLDER, () => JSON.stringify(build));
}

function listBuildFiles(root: string): BuildFile[] {
  const files: BuildFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        // Content packs and modules are never part of the shell, only the files directly in
        // `content/` can be (BOOT_CONTENT_FILES); the module trees are not walked.
        if (relative(root, absolute) === 'content') {
          for (const name of BOOT_CONTENT_FILES) {
            const file = join(root, name);
            if (existsSync(file)) files.push({ path: name, bytes: statSync(file).size });
          }
          continue;
        }
        walk(absolute);
      } else if (entry.isFile()) {
        files.push({
          path: relative(root, absolute).split(sep).join('/'),
          bytes: statSync(absolute).size,
        });
      }
    }
  };
  walk(root);
  return files;
}

/** What the shell computation reads of an output chunk (a subset of the bundler's). */
export interface ShellChunk {
  readonly fileName: string;
  /** Chunks this one imports statically. */
  readonly imports: readonly string[];
  readonly moduleIds: readonly string[];
  /** The module the chunk was made for (an entry page, a lazily imported screen). */
  readonly facadeModuleId: string | null | undefined;
  readonly isEntry: boolean;
  /** Styles and other assets (fonts, workers, wasm) the chunk pulls in. */
  readonly files: readonly string[];
}

/**
 * The `assets/` files a build for one job needs to show its screens: the main page's chunk, the
 * chunks of the root modules the job's routes open (`rootModules`, absolute module ids), everything
 * they import statically, and the styles and assets those pull in; with `lazyRoots`, also every
 * lazily imported module it matches (the job's own lazy parts, so nothing loads later). Lazy
 * chunks of other jobs' screens (drug tools, readers, viewers) are not in it.
 */
export function shellAssets(
  chunks: readonly ShellChunk[],
  mainPage: string,
  rootModules: readonly string[],
  lazyRoots?: RegExp,
): ReadonlySet<string> {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const wanted = chunks.filter(
    (chunk) =>
      (chunk.isEntry && chunk.facadeModuleId === mainPage) ||
      chunk.moduleIds.some((id) => rootModules.includes(id)) ||
      Boolean(lazyRoots && chunk.facadeModuleId && lazyRoots.test(chunk.facadeModuleId)),
  );
  const shell = new Set<string>();
  const visit = (chunk: ShellChunk): void => {
    if (shell.has(chunk.fileName)) return;
    shell.add(chunk.fileName);
    for (const file of chunk.files) shell.add(file);
    for (const name of chunk.imports) {
      const imported = byName.get(name);
      if (imported) visit(imported);
    }
  };
  for (const chunk of wanted) visit(chunk);
  return shell;
}

/** Writes `build-manifest.json` and the precache list into `<outDir>/sw.js`. */
export function writeServiceWorkerBuild(
  outDir: string,
  version: string,
  shell?: JobShell | undefined,
): ServiceWorkerBuild {
  const build = createServiceWorkerBuild(
    listBuildFiles(outDir),
    version,
    (path) =>
      createHash('sha256')
        .update(readFileSync(join(outDir, path)))
        .digest('hex'),
    shell,
  );
  const workerPath = join(outDir, 'sw.js');
  writeFileSync(workerPath, injectServiceWorkerBuild(readFileSync(workerPath, 'utf8'), build));
  writeFileSync(join(outDir, BUILD_MANIFEST_FILE), `${JSON.stringify(build)}\n`);
  return build;
}
