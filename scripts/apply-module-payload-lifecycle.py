"""Temporary exact integration edits, removed after verified changes are committed."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def edit(path, pairs):
    p = ROOT / path
    value = p.read_text()
    for before, after in pairs:
        if value.count(before) != 1:
            raise ValueError(f'Changed anchor in {path}: {before[:90]!r}')
        value = value.replace(before, after)
    p.write_text(value)


def append(path, value):
    p = ROOT / path
    p.write_text(p.read_text() + '\n' + value)


if '--harness' in sys.argv:
    edit('scripts/verify-reference-app.mjs', [
        ("const page = await context.newPage();", """const page = await context.newPage();
await page.addInitScript(() => {
  const original = Blob.prototype.arrayBuffer;
  globalThis.__largeModuleBlobReads = 0;
  Blob.prototype.arrayBuffer = function () {
    if (this.size >= 64 * 1024 * 1024) globalThis.__largeModuleBlobReads += 1;
    return original.call(this);
  };
});"""),
        ("  await measure('reference-card-open');", """  await measure('reference-card-open');
  report.storedIndex = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('minimed-content-modules-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const request = database.transaction('versions', 'readonly').objectStore('versions').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stored = rows.find((row) => row.moduleId === 'minimed.definition.reference.ru');
      return { kind: stored?.bytes instanceof Blob ? 'Blob' : 'ArrayBuffer',
        bytes: stored?.bytes instanceof Blob ? stored.bytes.size : stored?.bytes.byteLength,
        checksum: stored?.indexSha256 ?? null };
    } finally { database.close(); }
  });
  if (process.argv.includes('--expect-blob')) {
    assert.equal(report.storedIndex.kind, 'Blob');
    assert.equal(report.storedIndex.bytes, descriptor.module.sizes.installedBytes);
    assert.equal(report.storedIndex.checksum, descriptor.module.artifacts.find((a) => a.kind === 'index').decodedSha256);
    record('Real IndexedDB stores the complete immutable index as Blob with its decoded checksum.');
  }"""),
        ("  report.blockedCatalogRefreshes = blockedCatalogRefreshes;", """  await measure('reference-reopened');
  report.largeBlobReadsOnReopen = await page.evaluate(() => globalThis.__largeModuleBlobReads);
  if (process.argv.includes('--expect-blob')) {
    assert.equal(report.largeBlobReadsOnReopen, 0, 'Reopen must not materialize the large Blob on the main thread.');
    record('Installed Blob reopens and searches without a main-thread Blob.arrayBuffer read.');
  }
  report.blockedCatalogRefreshes = blockedCatalogRefreshes;"""),
    ])
    sys.exit(0)

if '--tests' in sys.argv:
    edit('apps/app/src/features/modules/browser-module-runtime.test.ts', [
        ('  bytes: ArrayBuffer,', '  bytes: ArrayBuffer | Blob,'),
    ])
    append('apps/app/src/features/modules/browser-module-runtime.test.ts', r'''
describe('module Blob payload compatibility', () => {
  it('mounts a large stored Blob without materializing it on the main thread', async () => {
    installObjectUrlDouble();
    installWorkerDouble();
    const bytes = new Blob([new ArrayBuffer(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1)]);
    installModuleDatabase([{ moduleId: 'minimed.blob', version: '1.0.0' }], bytes);
    const materialize = vi.spyOn(bytes, 'arrayBuffer').mockRejectedValue(new Error('unbounded read'));
    const mounts = await loadInstalledModuleMounts();
    try {
      expect(mounts).toHaveLength(1);
      expect(materialize).not.toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalledWith(bytes);
    } finally { await Promise.all(mounts.map((mount) => mount.store.close())); }
  });

  it('keeps exact subarray bytes immutable and restores the old active version', async () => {
    installWritableModuleDatabase();
    const backend = new BrowserModuleBackend();
    const first = moduleEntry('minimed.blob.small');
    const artifact = { id: 'index', kind: 'index' as const, required: true,
      url: 'https://example.test/index.db', sha256: CHECKSUM, sizeBytes: 3,
      compression: 'none' as const, sourceSetDigest: CHECKSUM };
    const backing = new Uint8Array([99, 1, 2, 3, 88]);
    const token = await backend.stage(first, artifact, backing.subarray(1, 4));
    await backend.activate(first, [token]);
    backing.fill(0);
    expect(await backend.readIndexBytes(first.id, first.version)).toEqual(new Uint8Array([1, 2, 3]));
    const next = { ...first, version: '1.1.0' };
    const second = await backend.stage(next, artifact, new Uint8Array([4, 5, 6]));
    const receipt = await backend.activate(next, [second]);
    await backend.restore(receipt);
    const memoryStore = { close: vi.fn(async () => undefined) } as unknown as SqliteMedicalStore;
    const open = vi.spyOn(SqliteMedicalStore, 'createFromBytes').mockResolvedValue(memoryStore);
    const mounts = await loadInstalledModuleMounts();
    expect(mounts).toHaveLength(1);
    expect(open).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    await Promise.all(mounts.map((mount) => mount.store.close()));
    await backend.remove(first.id);
    expect(await backend.readIndexBytes(first.id, first.version)).toBeNull();
    expect(await backend.readIndexBytes(next.id, next.version)).toBeNull();
  });

  it('isolates equal-size OPFS validation caches by decoded artifact checksum', async () => {
    installObjectUrlDouble();
    const workers = installWorkerDouble();
    const validator = new BrowserModuleValidator();
    const bytes = new Uint8Array(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1);
    const module = moduleEntry('minimed.blob.receipt');
    for (const hash of ['a', 'b']) {
      const result = await validator.validate({ ...module, artifacts: [{
        id: 'index', kind: 'index', required: true, url: 'https://example.test/test.db',
        sha256: `sha256:${hash.repeat(64)}`, sizeBytes: bytes.byteLength,
        compression: 'none', sourceSetDigest: CHECKSUM,
      }] }, bytes);
      expect(result.valid).toBe(true);
    }
    const opens = workers.map((worker) => worker.postMessage.mock.calls[0]?.[0] as OpenWorkerRequest);
    expect(opens).toHaveLength(2);
    expect(opens[0]?.poolName).not.toBe(opens[1]?.poolName);
    expect(opens[0]?.databaseName).not.toBe(opens[1]?.databaseName);
  });
});
''')
    append('packages/core/tests/content-module-installer.test.ts', r'''
function lifecycleGate() {
  let release: () => void = () => { throw new Error('gate not initialized'); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function lifecycleFixture() {
  const bytes = new Uint8Array([11, 12, 13]);
  const original = await moduleFixture({ indexBytes: bytes });
  const module = { ...original.module, version: '1.1.0' };
  const catalog = { ...original.catalog, modules: [original.catalog.modules[0]!, module] };
  const registry = new InMemoryInstalledModuleRegistry();
  registry.activate(validatedInstallation());
  registry.activate(validatedInstallation(module.id));
  const before = registry.snapshot();
  const backend = new TestBackend();
  const indexValidator = validator();
  const installer = new ForegroundContentModuleInstaller(
    catalog, runtime, new TestDownloader({ index: bytes }), backend, indexValidator, registry, 1,
  );
  const start = () => installer.install({ moduleId: module.id, version: module.version, includeSourceAssets: false });
  return { bytes, module, catalog, registry, before, backend, indexValidator, installer, start };
}

describe('module payload lifecycle regressions', () => {
  it('late cancellation after SQLite validation cannot activate or replace the working edition', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate(); const resume = lifecycleGate();
    const validate = f.indexValidator.validate.bind(f.indexValidator);
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(async (...args) => {
      entered.release(); await resume.promise; return validate(...args);
    });
    const task = f.start(); await entered.promise;
    f.installer.cancel(task.id); resume.release();
    expect((await f.installer.wait(task.id)).state).toBe('cancelled');
    expect(f.backend.activated).toBe(false);
    expect(f.backend.discarded).toBe(true);
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('late cancellation during activation restores the previous pointer before completing', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate(); const resume = lifecycleGate();
    const activate = f.backend.activate.bind(f.backend);
    vi.spyOn(f.backend, 'activate').mockImplementation(async (...args) => {
      const receipt = await activate(...args); entered.release(); await resume.promise; return receipt;
    });
    const task = f.start(); await entered.promise;
    f.installer.cancel(task.id); resume.release();
    expect((await f.installer.wait(task.id)).state).toBe('cancelled');
    expect(f.backend.restored).toBe(true);
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('a cancelled staging operation must finish draining before the same module retries', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate(); const resume = lifecycleGate();
    const stage = f.backend.stage.bind(f.backend);
    vi.spyOn(f.backend, 'stage').mockImplementationOnce(async (...args) => {
      entered.release(); await resume.promise; return stage(...args);
    });
    const task = f.start(); await entered.promise;
    f.installer.cancel(task.id);
    expect(() => f.start()).toThrow(/settling/u);
    resume.release();
    expect((await f.installer.wait(task.id)).state).toBe('cancelled');
    expect(f.backend.activated).toBe(false);
    const retry = f.start();
    expect((await f.installer.wait(retry.id)).state).toBe('completed');
    expect(f.registry.get(f.module.id)?.version).toBe('1.1.0');
  });

  it('different editions of one module cannot race their activation receipts', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate(); const resume = lifecycleGate();
    const validate = f.indexValidator.validate.bind(f.indexValidator);
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(async (...args) => {
      entered.release(); await resume.promise; return validate(...args);
    });
    const task = f.start(); await entered.promise;
    const newer = { ...f.module, version: '1.2.0' };
    f.installer.updateCatalog({ ...f.catalog, modules: [f.catalog.modules[0]!, newer] });
    expect(() => f.installer.install({ moduleId: newer.id, version: newer.version, includeSourceAssets: false })).toThrow(/in progress/u);
    resume.release(); await f.installer.wait(task.id);
  });

  it('cancellation recovery errors are failures, not successful cancellation', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate(); const resume = lifecycleGate();
    const activate = f.backend.activate.bind(f.backend);
    vi.spyOn(f.backend, 'activate').mockImplementation(async (...args) => {
      const receipt = await activate(...args); entered.release(); await resume.promise; return receipt;
    });
    vi.spyOn(f.backend, 'restore').mockRejectedValue(new Error('storage unavailable'));
    const task = f.start(); await entered.promise;
    f.installer.cancel(task.id); resume.release();
    const result = await f.installer.wait(task.id);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('restore');
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('staging cleanup failure remains observable even when cancellation was requested', async () => {
    const f = await lifecycleFixture();
    vi.spyOn(f.backend, 'discardStaging').mockRejectedValue(new Error('cleanup unavailable'));
    const entered = lifecycleGate(); const resume = lifecycleGate();
    const validate = f.indexValidator.validate.bind(f.indexValidator);
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(async (...args) => {
      entered.release(); await resume.promise; return validate(...args);
    });
    const task = f.start(); await entered.promise;
    f.installer.cancel(task.id); resume.release();
    const result = await f.installer.wait(task.id);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('cleanup');
    expect(f.backend.activated).toBe(false);
  });

  it('a corrupted archive leaves the previous installed edition unchanged', async () => {
    const f = await lifecycleFixture();
    const corrupted = new ForegroundContentModuleInstaller(
      f.catalog, runtime, new TestDownloader({ index: new Uint8Array([0, 0, 0]) }),
      f.backend, f.indexValidator, f.registry, 1,
    );
    const task = corrupted.install({ moduleId: f.module.id, version: f.module.version, includeSourceAssets: false });
    expect((await corrupted.wait(task.id)).state).toBe('failed');
    expect(f.backend.staged).toHaveLength(0);
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('an invalid SQLite edition leaves the previous installed edition unchanged', async () => {
    const f = await lifecycleFixture();
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(validator(false).validate);
    expect((await f.installer.wait(f.start().id)).state).toBe('failed');
    expect(f.backend.activated).toBe(false);
    expect(f.registry.snapshot()).toEqual(f.before);
  });
});
''')
    sys.exit(0)

if '--code' not in sys.argv:
    raise ValueError('Use --harness, --tests or --code')

edit('apps/app/src/features/modules/browser-module-runtime.ts', [
    ("import { decodeModuleIndex } from '@/features/modules/module-index-compression';", "import { decodeModuleIndex } from '@/features/modules/module-index-compression';\nimport { moduleIndexBlob, moduleIndexBytes, moduleIndexSize, type ModuleIndexPayload } from '@/features/modules/module-index-payload';"),
    ('  readonly bytes: ArrayBuffer;\n  readonly sourceAssets?', '  readonly bytes: ArrayBuffer | Blob;\n  readonly indexSha256?: string;\n  readonly sourceAssets?'),
    ('  bytes: Uint8Array,\n): Promise<SqliteMedicalStore | WorkerOpfsMedicalStore> {\n  if (bytes.byteLength <= SQLITE_WASM_DESERIALIZE_MAX_BYTES) {\n    return SqliteMedicalStore.createFromBytes(bytes);\n  }', '''  payload: ModuleIndexPayload,
  indexSha256?: string,
): Promise<SqliteMedicalStore | WorkerOpfsMedicalStore> {
  if (moduleIndexSize(payload) <= SQLITE_WASM_DESERIALIZE_MAX_BYTES) {
    return SqliteMedicalStore.createFromBytes(await moduleIndexBytes(payload));
  }'''),
    ('  const key = moduleOpfsKey(moduleId, version);', '''  if (indexSha256 !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(indexSha256)) {
    throw new Error('Invalid module index checksum.');
  }
  const key = moduleOpfsKey(moduleId, indexSha256 ? `${version}:${indexSha256}` : version);'''),
    ("  const url = URL.createObjectURL(\n    new Blob([new Uint8Array(bytes)], { type: 'application/vnd.sqlite3' }),\n  );", '  const url = URL.createObjectURL(moduleIndexBlob(payload));'),
    ('      const storedBytes = staged.bytes.slice().buffer;', '      const storedBytes = moduleIndexBlob(staged.bytes);'),
    ('        bytes: storedBytes,', '''        bytes: storedBytes,
        ...(staged.artifact.decodedSha256 || staged.artifact.sha256
          ? { indexSha256: staged.artifact.decodedSha256 ?? staged.artifact.sha256 ?? undefined }
          : {}),'''),
    ('      return stored ? new Uint8Array(stored.bytes.slice(0)) : null;', '      return stored ? await moduleIndexBytes(stored.bytes) : null;'),
    ('      store = await openModuleStore(module.id, module.version, indexBytes);', '''      const artifact = module.artifacts.find((entry) => entry.kind === 'index');
      store = await openModuleStore(module.id, module.version, indexBytes,
        artifact?.decodedSha256 ?? artifact?.sha256 ?? undefined);'''),
    ('          new Uint8Array(stored.bytes.slice(0)),', '          stored.bytes,\n          stored.indexSha256,'),
])

edit('packages/core/src/content-module-installer.ts', [
    ('  const buffer = Uint8Array.from(bytes).buffer;\n  const digest = await crypto.subtle.digest(\'SHA-256\', buffer);', '''  // Web Crypto snapshots the selected BufferSource; avoid a second full ordinary-buffer copy.
  const view = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);'''),
    ('''        task.version === module.version &&
        !['completed', 'failed', 'cancelled'].includes(task.state),''', '''        this.controllers.has(task.id),'''),
    ('    if (existingTask) return existingTask;', '''    if (existingTask) {
      if (existingTask.state === 'cancelled') {
        throw new Error(`Module ${module.id} cancellation is still settling.`);
      }
      if (existingTask.version !== module.version) {
        throw new Error(`Another edition of module ${module.id} is already in progress.`);
      }
      return existingTask;
    }'''),
    ('    const bytesByArtifact = new Map<string, Uint8Array>();', '    let indexBytes: Uint8Array | undefined;\n    let recoveryFailed = false;'),
    ("      this.setTask(task.id, { state: 'downloading' });\n      for (const artifact of artifacts) {", "      this.setTask(task.id, { state: 'downloading' });\n      signal.throwIfAborted();\n      for (const artifact of artifacts) {\n        signal.throwIfAborted();"),
    ('          (progress) => {\n            const previousArtifacts', '          (progress) => {\n            if (signal.aborted) return;\n            const previousArtifacts'),
    ('        const checksum = await sha256(bytes);', '        const checksum = await sha256(bytes);\n        signal.throwIfAborted();'),
    ("          this.setTask(task.id, { state: 'verifying' });\n          installedBytes =", "          this.setTask(task.id, { state: 'verifying' });\n          signal.throwIfAborted();\n          installedBytes ="),
    ('''        bytesByArtifact.set(artifact.id, installedBytes);
        staged.push(await this.backend.stage(module, artifact, installedBytes));''', '''        signal.throwIfAborted();
        if (artifact.id === indexArtifact.id) indexBytes = installedBytes;
        staged.push(await this.backend.stage(module, artifact, installedBytes));
        signal.throwIfAborted();'''),
    ('''      const indexBytes = bytesByArtifact.get(indexArtifact.id);
      if (!indexBytes)''', '''      signal.throwIfAborted();
      if (!indexBytes)'''),
    ('      const validation = await this.validator.validate(module, indexBytes);', '''      const validation = await this.validator.validate(module, indexBytes);
      indexBytes = undefined;
      signal.throwIfAborted();'''),
    ("      this.setTask(task.id, { state: 'installing' });\n      const receipt", "      this.setTask(task.id, { state: 'installing' });\n      signal.throwIfAborted();\n      const receipt"),
    ('      try {\n        const installation: ModuleVersionInstallation', '      try {\n        signal.throwIfAborted();\n        const installation: ModuleVersionInstallation'),
    ('''      } catch (cause) {
        await this.backend.restore(receipt);
        throw cause;
      }''', '''      } catch (cause) {
        try {
          await this.backend.restore(receipt);
        } catch (restoreError) {
          recoveryFailed = true;
          throw new Error('Unable to restore the previous module activation.', { cause: restoreError });
        }
        throw cause;
      }'''),
    ('''    } catch (cause) {
      await this.backend.discardStaging(module.id, module.version);
      if (signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {''', '''    } catch (cause) {
      try {
        await this.backend.discardStaging(module.id, module.version);
      } catch {
        return this.setTask(task.id, { state: 'failed',
          errorMessage: recoveryFailed
            ? 'Module restore and staging cleanup failed.'
            : 'Module staging cleanup failed.' });
      }
      if (!recoveryFailed && (signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError'))) {'''),
    ('    } finally {\n      releaseInstallSlot?.();', '    } finally {\n      indexBytes = undefined;\n      staged.length = 0;\n      releaseInstallSlot?.();'),
])
print('Applied bounded-payload and cancellation integration edits')
