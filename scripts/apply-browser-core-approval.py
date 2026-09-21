"""Temporary bounded browser-core consent integration; no parallel storage owner."""
from pathlib import Path
import json

changed = json.loads(Path('data/build/reference-r2-changed.json').read_text())
def edit(name, pairs):
    p = Path(name)
    s = p.read_text()
    for old, new, count in pairs:
        if s.count(old) != count:
            raise ValueError('Browser integration anchor changed: ' + name + ': ' + old[:90])
        s = s.replace(old, new)
    p.write_text(s)
    if name not in changed:
        changed.append(name)

edit('apps/app/src/composition/opfs-pack-protocol.ts', [
    ('readonly poolName: string;', 'readonly poolName: string;\n      readonly waitForDownloadApproval?: boolean;', 2),
    ("export type OpfsPackWorkerRequest =", "export type OpfsPackWorkerRequest =\n  | { readonly id: number; readonly type: 'approve-download' }", 1),
    ('export type OpfsPackWorkerResponse =', "export type OpfsPackWorkerResponse =\n  | { readonly id: number; readonly event: 'download-required' }\n  | { readonly id: number; readonly event: 'download-progress'; readonly loaded: number; readonly total: number }", 1),
])
edit('apps/app/src/composition/worker-opfs-medical-store.ts', [
    ('export class WorkerOpfsMedicalStore implements MedicalStore {', '''export interface OpfsDownloadUi {
  requestDownload(): Promise<void>;
  onProgress(progress: { loaded: number; total: number }): void;
}

export class WorkerOpfsMedicalStore implements MedicalStore {
  private onDownloadWait: (waiting: boolean) => void = () => {};''', 1),
    ('    owner?: WorkerOpfsMedicalStore,', '    owner?: WorkerOpfsMedicalStore,\n    private readonly downloadUi?: OpfsDownloadUi,', 1),
    ('      const pending = this.pending.get(event.data.id);', '''      if ('event' in event.data) {
        const message = event.data;
        if (this.connectionClosed) return;
        if (message.event === 'download-progress') {
          this.downloadUi?.onProgress({ loaded: message.loaded, total: message.total });
        } else {
          this.onDownloadWait(true);
          if (!this.downloadUi) {
            this.shutdown(new Error('Unexpected core download request.'));
            return;
          }
          void this.downloadUi.requestDownload().then(() => {
            if (this.connectionClosed) return;
            this.onDownloadWait(false);
            this.worker.postMessage({ type: 'approve-download', id: message.id });
          }, (cause: unknown) => this.shutdown(cause instanceof Error ? cause : new Error('Core download was not approved.')));
        }
        return;
      }
      const pending = this.pending.get(event.data.id);''', 1),
    ('public static async open(options: OpfsPackWorkerOpenOptions): Promise<WorkerOpfsMedicalStore>', 'public static async open(options: OpfsPackWorkerOpenOptions, downloadUi?: OpfsDownloadUi): Promise<WorkerOpfsMedicalStore>', 1),
    ('return WorkerOpfsMedicalStore.open(options);', 'return WorkerOpfsMedicalStore.open(options, downloadUi);', 2),
    ('WorkerOpfsMedicalStore.openOwner(options, shared);', 'WorkerOpfsMedicalStore.openOwner(options, shared, downloadUi);', 1),
    ('    shared: SharedWorkerStore,\n  ): Promise<WorkerOpfsMedicalStore>', '    shared: SharedWorkerStore,\n    downloadUi?: OpfsDownloadUi,\n  ): Promise<WorkerOpfsMedicalStore>', 1),
    ("    const store = new WorkerOpfsMedicalStore(worker, shared);\n    const opened = store.request('open', options);", "    const store = new WorkerOpfsMedicalStore(worker, shared, undefined, downloadUi);\n    const opened = store.request('open', { ...options, waitForDownloadApproval: Boolean(downloadUi) });", 1),
    ('''          timer = setTimeout(
            () => reject(new Error(`Opening ${options.databaseName} timed out.`)),
            options.fetchTimeoutMs,
          );''', '''          const arm = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => reject(new Error(`Opening ${options.databaseName} timed out.`)), options.fetchTimeoutMs);
          };
          store.onDownloadWait = (waiting) => {
            if (timer) clearTimeout(timer);
            if (!waiting) arm();
          };
          arm();''', 1),
    ('    } finally {\n      if (timer) clearTimeout(timer);', '    } finally {\n      store.onDownloadWait = () => {};\n      if (timer) clearTimeout(timer);', 1),
])
edit('apps/app/src/composition/opfs-pack.worker.ts', [
    ('let store: SqliteMedicalStore | undefined;', 'let store: SqliteMedicalStore | undefined;\nlet downloadApproval: { id: number; resolve: () => void } | undefined;', 1),
    ("  try {\n    if (message.type === 'open')", "  try {\n    if (message.type === 'approve-download') {\n      if (downloadApproval?.id !== message.id) throw new Error('Unexpected download approval.');\n      downloadApproval.resolve();\n      downloadApproval = undefined;\n      return;\n    }\n    if (message.type === 'open')", 1),
    ('        poolName: message.poolName,', '''        poolName: message.poolName,
        ...(message.waitForDownloadApproval ? {
          beforeImport: () => new Promise<void>((resolve) => {
            downloadApproval = { id: message.id, resolve };
            self.postMessage({ id: message.id, event: 'download-required' } satisfies OpfsPackWorkerResponse);
          }),
          onImportProgress: (loaded: number, total: number) => self.postMessage({ id: message.id, event: 'download-progress', loaded, total } satisfies OpfsPackWorkerResponse),
        } : {}),''', 1),
])
edit('packages/storage-sqlite/src/sqlite-medical-store.ts', [
    ('  fetchTimeoutMs: number,\n): Promise<void> {', '  fetchTimeoutMs: number,\n  onProgress?: (loaded: number) => void,\n): Promise<void> {', 1),
    ('  await pool.importDb(vfsName, createStreamChunkImporter(response.body));', '''  const read = createStreamChunkImporter(response.body);
  let loaded = 0;
  await pool.importDb(vfsName, async () => {
    const bytes = await read();
    if (bytes) { loaded += bytes.byteLength; onProgress?.(loaded); }
    return bytes;
  });''', 1),
    ('options: { readonly fetchTimeoutMs?: number; readonly poolName?: string } = {},', 'options: { readonly fetchTimeoutMs?: number; readonly poolName?: string; readonly beforeImport?: () => Promise<void>; readonly onImportProgress?: (loaded: number, total: number) => void } = {},', 1),
    ('    await importOpfsPack(pool, url, databaseName, vfsName, fetchTimeoutMs);', '''    await options.beforeImport?.();
    await importOpfsPack(pool, url, databaseName, vfsName, fetchTimeoutMs,
      options.onImportProgress ? (loaded) => options.onImportProgress?.(loaded, byteLength ?? 0) : undefined);''', 1),
])
edit('apps/app/src/composition/create-browser-core.ts', [
    ('''function openRequiredCoreFromOpfs(
  url: string,
  databaseName = PACK_DATABASE_NAME,
): Promise<WorkerOpfsMedicalStore> {
  return WorkerOpfsMedicalStore.open({
    url,
    databaseName,
    fetchTimeoutMs: OPFS_PACK_FETCH_TIMEOUT_MS,
    poolName: 'minimed-sah-core',
  });
}''', '''async function openRequiredCoreFromOpfs(
  url: string,
  databaseName = PACK_DATABASE_NAME,
  downloadUi?: CoreDownloadUi,
): Promise<WorkerOpfsMedicalStore> {
  const descriptor = { id: `core:web:${databaseName}`, kind: 'core' as const, title: 'Ядро знаний MiniMed' };
  let downloading = false;
  try {
    const store = await WorkerOpfsMedicalStore.open({ url, databaseName, fetchTimeoutMs: OPFS_PACK_FETCH_TIMEOUT_MS, poolName: 'minimed-sah-core' }, downloadUi ? {
      requestDownload: async () => {
        await downloadUi.requestDownload();
        downloading = true;
        getDownloadQueue().observe(descriptor, { state: 'downloading', downloadedBytes: 0, totalBytes: null, errorMessage: null }, {});
      },
      onProgress: ({ loaded, total }) => {
        downloadUi.onProgress({ loaded, total, phase: 'downloading' });
        getDownloadQueue().observe(descriptor, { state: 'downloading', downloadedBytes: loaded, totalBytes: total > 0 ? total : null, errorMessage: null }, {});
      },
    } : undefined);
    if (downloading) getDownloadQueue().observe(descriptor, { state: 'completed', errorMessage: null }, {});
    return store;
  } catch (cause) {
    if (downloading) getDownloadQueue().observe(descriptor, { state: 'failed', errorMessage: 'Не удалось установить ядро.' }, {});
    throw cause;
  }
}''', 1),
    ('  cacheName = PACK_DATABASE_NAME,\n): Promise<MedicalStore> {', '  cacheName = PACK_DATABASE_NAME,\n  downloadUi?: CoreDownloadUi,\n): Promise<MedicalStore> {', 1),
    ('  const contentLength = await packagedContentLength(url);', '  if (downloadUi) return openRequiredCoreFromOpfs(url.href, cacheName, downloadUi);\n  const contentLength = await packagedContentLength(url);', 1),
    ('      `core.${(fallbackCoreUrl ? ANDROID_CORE_DOWNLOAD.checksum : report.outputChecksum).slice(7)}.db`,', '      `core.${(fallbackCoreUrl ? ANDROID_CORE_DOWNLOAD.checksum : report.outputChecksum).slice(7)}.db`,\n      fallbackCoreUrl || isFloatingWindowRuntime() ? undefined : downloadUi,', 1),
    ("includeMedications: platform !== 'android' && !isFloatingWindowRuntime(),", 'includeMedications: false,', 2),
])
# Only restore packages the user has already installed. New optional tools need explicit selection.
edit('apps/app/src/features/modules/local-packaged-modules.ts', [
    ("module.releaseState === 'published' || (installed !== undefined && isModuleReleased(module))", "installed !== undefined && isModuleReleased(module)", 1),
])
Path('data/build/reference-r2-changed.json').write_text(json.dumps(changed))
print('Browser consent and progress integrated.')
