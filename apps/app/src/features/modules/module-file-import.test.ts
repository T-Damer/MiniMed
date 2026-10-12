import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type ContentModuleCatalog,
  type ContentModuleCatalogEntry,
  ContentModuleCatalogSchema,
  hasLocalModuleArtifacts,
} from '@localmed/contracts';
import { ForegroundContentModuleInstaller } from '@localmed/core';
import { InMemoryInstalledModuleRegistry } from '@localmed/storage';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  downloadLocalBundleArtifact,
  registerLocalBundle,
  releaseLocalBundle,
} from '@/features/modules/local-bundle-sources';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import {
  assertBundleCanInstall,
  bundleArtifactPath,
  describeModuleImportFailure,
  ModuleFileImportError,
  openModuleBundle,
} from '@/features/modules/module-file-import';

/** Written by `medbase bundle-local-module` (tools/ingest), so this reads the Python end's bytes. */
const FIXTURE = fileURLToPath(
  new URL('./test-fixtures/fixture-local.minimed-module.zip', import.meta.url),
);

function fixtureBlob(): Blob {
  return new Blob([new Uint8Array(readFileSync(FIXTURE))]);
}

async function fixtureEntries(): Promise<Record<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(readFileSync(FIXTURE));
  const files: Record<string, Uint8Array> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    files[name] = await file.async('uint8array');
  }
  return files;
}

async function zipBlob(
  files: Readonly<Record<string, Uint8Array | string>>,
  compression: 'STORE' | 'DEFLATE' = 'STORE',
): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { compression });
  return new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression }))]);
}

async function mutatedBundle(
  mutate: (entry: Record<string, unknown>, files: Record<string, Uint8Array | string>) => void,
): Promise<Blob> {
  const files: Record<string, Uint8Array | string> = { ...(await fixtureEntries()) };
  const entry = JSON.parse(new TextDecoder().decode(files['module.json'] as Uint8Array)) as Record<
    string,
    unknown
  >;
  mutate(entry, files);
  files['module.json'] = JSON.stringify(entry);
  return zipBlob(files);
}

function firstArtifact(entry: Record<string, unknown>): Record<string, unknown> {
  return (entry['artifacts'] as Record<string, unknown>[])[0] as Record<string, unknown>;
}

const FIXTURE_ARTIFACT = 'artifacts/demo-reference.2026.10.12.db.gz';

describe('openModuleBundle', () => {
  it('opens the bundle the Python writer produced and reads its artifact lazily', async () => {
    const bundle = await openModuleBundle(fixtureBlob(), 'x.minimed-module.zip');
    const [artifact] = bundle.entry.artifacts;

    expect(bundle.entry.id).toBe('minimed.reference.fixture-local');
    expect(hasLocalModuleArtifacts(bundle.entry)).toBe(true);
    expect(artifact?.url).toBe(`minimed-local:${FIXTURE_ARTIFACT}`);
    const bytes = await bundle.readArtifact(artifact as NonNullable<typeof artifact>);
    expect(bytes.byteLength).toBe(artifact?.sizeBytes);
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    expect(`sha256:${Buffer.from(digest).toString('hex')}`).toBe(artifact?.sha256);
  });

  it('never offers a module from a file as a download', async () => {
    const { entry } = await openModuleBundle(fixtureBlob());
    expect(isModuleReleased(entry)).toBe(false);
  });

  it('rejects what is not a module bundle, with a short Russian message', async () => {
    const reject = async (blob: Blob): Promise<string> => {
      try {
        await openModuleBundle(blob);
      } catch (cause) {
        expect(cause).toBeInstanceOf(ModuleFileImportError);
        return (cause as Error).message;
      }
      throw new Error('the bundle was accepted');
    };

    expect(await reject(new Blob(['plain text, no archive here at all']))).toBe(
      'Это не файл модуля MiniMed.',
    );
    expect(await reject(await zipBlob({ 'readme.txt': 'hi' }))).toBe(
      'В файле нет описания модуля.',
    );
    expect(await reject(await zipBlob({ 'module.json': '{broken' }))).toBe(
      'Описание модуля повреждено.',
    );
    expect(await reject(await zipBlob({ 'module.json': '{"id":"x"}' }))).toBe(
      'Описание модуля не прошло проверку.',
    );
    expect(await reject(await zipBlob(await fixtureEntries(), 'DEFLATE'))).toBe(
      'Архив модуля сжат: пересоберите его без сжатия.',
    );
  });

  it('rejects a bundle that points outside itself or lacks its data', async () => {
    const external = await mutatedBundle((entry) => {
      firstArtifact(entry)['url'] = 'https://example.invalid/x.db.gz';
    });
    await expect(openModuleBundle(external)).rejects.toThrow(
      'Файл модуля ссылается на внешний адрес.',
    );

    const traversal = await mutatedBundle((entry) => {
      firstArtifact(entry)['url'] = 'minimed-local:../artifacts/x.db.gz';
    });
    await expect(openModuleBundle(traversal)).rejects.toThrow('внешний адрес');

    const missing = await mutatedBundle((_entry, files) => {
      delete files[FIXTURE_ARTIFACT];
    });
    await expect(openModuleBundle(missing)).rejects.toThrow('В файле модуля не хватает данных.');

    const wrongSize = await mutatedBundle((_entry, files) => {
      files[FIXTURE_ARTIFACT] = new Uint8Array(3);
    });
    await expect(openModuleBundle(wrongSize)).rejects.toThrow('Размер данных не совпадает');
  });

  it('rejects an unsupported artifact format and a core replacement', async () => {
    const unsupported = await mutatedBundle((entry) => {
      const artifact = firstArtifact(entry);
      artifact['compression'] = 'zip';
    });
    await expect(openModuleBundle(unsupported)).rejects.toThrow(
      'Формат файла модуля не поддерживается.',
    );

    const planned = await mutatedBundle((entry) => {
      entry['releaseState'] = 'planned';
    });
    await expect(openModuleBundle(planned)).rejects.toThrow('Модуль не готов к установке.');

    const core = await mutatedBundle((entry) => {
      entry['kind'] = 'core';
      entry['required'] = true;
    });
    await expect(openModuleBundle(core)).rejects.toThrow('Ядро нельзя заменить файлом.');
  });
});

describe('bundleArtifactPath', () => {
  it('accepts only relative paths inside the archive', () => {
    expect(bundleArtifactPath('minimed-local:artifacts/a.db.zst')).toBe('artifacts/a.db.zst');
    for (const bad of [
      null,
      'https://example.test/a',
      'minimed-local:',
      'minimed-local:/abs',
      'minimed-local:a/../b',
      'minimed-local:a//b',
      'minimed-local:a\\b',
    ]) {
      expect(bundleArtifactPath(bad)).toBeNull();
    }
  });
});

describe('assertBundleCanInstall', () => {
  it('refuses an id that a public module owns and a build that is already installed', async () => {
    const { entry } = await openModuleBundle(fixtureBlob());

    expect(() =>
      assertBundleCanInstall(entry, { modules: [{ id: 'other' }] }, undefined),
    ).not.toThrow();
    expect(() => assertBundleCanInstall(entry, { modules: [{ id: entry.id }] }, undefined)).toThrow(
      'Такой модуль уже есть в каталоге MiniMed.',
    );
    expect(() =>
      assertBundleCanInstall(
        entry,
        { modules: [] },
        {
          version: entry.version,
          activeSourceSetDigest: entry.sourceSetDigest,
        },
      ),
    ).toThrow('Этот модуль уже установлен.');
    expect(() =>
      assertBundleCanInstall(
        entry,
        { modules: [] },
        {
          version: '2026.1.1',
          activeSourceSetDigest: entry.sourceSetDigest,
        },
      ),
    ).not.toThrow();
  });
});

describe('describeModuleImportFailure', () => {
  it('turns installer errors into short Russian messages', () => {
    expect(describeModuleImportFailure('Artifact index checksum mismatch.')).toBe(
      'Контрольная сумма не совпала: файл повреждён.',
    );
    expect(describeModuleImportFailure('Module x requires MiniMed 9.0.0 or newer.')).toBe(
      'Модуль требует другой версии приложения.',
    );
    expect(describeModuleImportFailure('Module index validation failed: ok')).toBe(
      'База модуля не прошла проверку целостности.',
    );
    expect(describeModuleImportFailure('Файл модуля недоступен: выберите его снова.')).toBe(
      'Файл модуля недоступен: выберите его снова.',
    );
    expect(describeModuleImportFailure('boom')).toBe('Не удалось установить модуль из файла.');
    expect(describeModuleImportFailure(null)).toBe('Не удалось установить модуль из файла.');
  });
});

function coreModule(): ContentModuleCatalogEntry {
  return {
    id: 'minimed.core.ru',
    version: '1.0.0',
    kind: 'core',
    collection: 'core',
    title: 'Ядро',
    description: 'Ядро.',
    required: true,
    releaseState: 'bundled',
    specialties: [],
    populations: [],
    tags: [],
    compatibility: {
      minAppVersion: '0.3.1',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: null,
    dependencies: [],
    sizes: {
      downloadBytes: 0,
      installedBytes: 1,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    capabilities: {
      search: true,
      fullText: false,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: true,
      calculations: false,
    },
    artifacts: [],
    documents: [],
    previewDocumentCount: 0,
  };
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The real installer over the real bundle reader; only storage and SQLite validation are stubs. */
function installerFor(entry: ContentModuleCatalogEntry) {
  const catalog: ContentModuleCatalog = ContentModuleCatalogSchema.parse({
    catalogVersion: 'test',
    channel: 'preview',
    publishedAt: '2026-10-12T00:00:00Z',
    modules: [coreModule(), entry],
  });
  const registry = new InMemoryInstalledModuleRegistry();
  const installer = new ForegroundContentModuleInstaller(
    catalog,
    { appVersion: '0.6.58', schemaVersion: 2, coreCatalogVersion: '1' },
    { download: downloadLocalBundleArtifact },
    {
      stage: async (_module, artifact, bytes) => ({
        artifactId: artifact.id,
        kind: artifact.kind,
        sizeBytes: bytes.byteLength,
        token: artifact.id,
      }),
      activate: async (module) => ({
        moduleId: module.id,
        version: module.version,
        installedSizeBytes: 74,
        token: 'null',
      }),
      restore: async () => undefined,
      discardStaging: async () => undefined,
    },
    {
      validate: async () => ({
        checkedAt: '2026-10-12T00:00:00Z',
        valid: true,
        checksumValid: true,
        schemaCompatible: true,
        sqliteIntegrity: 'ok',
        message: 'ok',
      }),
    },
    registry,
    1,
    async (_artifact, bytes) => gunzip(bytes),
  );
  return { installer, registry };
}

describe('installing from a bundle', () => {
  it('runs the existing installer on bytes read from the file', async () => {
    const bundle = await openModuleBundle(fixtureBlob());
    const { installer, registry } = installerFor(bundle.entry);
    registerLocalBundle(bundle);
    try {
      const task = installer.install({
        moduleId: bundle.entry.id,
        version: bundle.entry.version,
        includeSourceAssets: false,
      });
      const finished = await installer.wait(task.id);

      expect(finished.state).toBe('completed');
      expect(registry.get(bundle.entry.id)).toMatchObject({
        version: bundle.entry.version,
        activeSourceSetDigest: bundle.entry.sourceSetDigest,
      });
    } finally {
      releaseLocalBundle(bundle.entry.id, bundle.entry.version);
    }
  });

  it('fails on a damaged artifact and installs nothing', async () => {
    const damaged = await mutatedBundle((_entry, files) => {
      const bytes = new Uint8Array(files[FIXTURE_ARTIFACT] as Uint8Array);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      files[FIXTURE_ARTIFACT] = bytes;
    });
    const bundle = await openModuleBundle(damaged);
    const { installer, registry } = installerFor(bundle.entry);
    registerLocalBundle(bundle);
    try {
      const task = installer.install({
        moduleId: bundle.entry.id,
        version: bundle.entry.version,
        includeSourceAssets: false,
      });
      const finished = await installer.wait(task.id);

      expect(finished.state).toBe('failed');
      expect(describeModuleImportFailure(finished.errorMessage)).toBe(
        'Контрольная сумма не совпала: файл повреждён.',
      );
      expect(registry.get(bundle.entry.id)).toBeFalsy();
    } finally {
      releaseLocalBundle(bundle.entry.id, bundle.entry.version);
    }
  });

  it('refuses a local artifact whose bundle is not registered', async () => {
    const { entry } = await openModuleBundle(fixtureBlob());
    const artifact = entry.artifacts[0] as NonNullable<(typeof entry.artifacts)[number]>;
    await expect(
      downloadLocalBundleArtifact(artifact, new AbortController().signal, () => undefined, entry),
    ).rejects.toThrow('Файл модуля недоступен');
  });
});
