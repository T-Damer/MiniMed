"""Temporary exact-anchor integration; removed after verified delivery to PR #180."""
from pathlib import Path

changed: list[str] = []

def edit(name: str, pairs: list[tuple[str, str]]) -> None:
    path = Path(name)
    text = path.read_text()
    for before, after in pairs:
        if text.count(before) != 1:
            raise ValueError(f"Integration anchor changed: {name}: {before[:90]}")
        text = text.replace(before, after)
    path.write_text(text)
    changed.append(name)

p = Path('packages/contracts/src/index.ts')
p.write_text(p.read_text() + "export * from './definition-reference-api';\n")
changed.append(str(p))
p = Path('packages/storage/src/definition-reference.ts')
p.write_text("export type { DefinitionReferenceBlock, DefinitionReferenceHit, DefinitionReferenceReader } from '@localmed/contracts';\n")
changed.append(str(p))

edit('packages/contracts/src/core.ts', [
    ("import type { LocalMedError }", "import type { DefinitionReferenceRequest, DefinitionReferenceReply } from './definition-reference-api';\nimport type { LocalMedError }"),
    ('export interface MedicalCore {', 'export interface MedicalCore {\n  /** Bounded, edition-bound source reference. Unsupported backends return unavailable. */\n  reference?(request: DefinitionReferenceRequest): Promise<Result<DefinitionReferenceReply, LocalMedError>>;'),
])
edit('packages/storage/src/ports.ts', [
    ("import type { ContentPackSeed, EmbeddingProfile, SearchFilters }", "import type { DefinitionReferenceReply, DefinitionReferenceRequest, ContentPackSeed, EmbeddingProfile, SearchFilters }"),
    ('export interface MedicalStore {', 'export interface MedicalStore {\n  reference?(request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply>;'),
])
edit('packages/storage-sqlite/src/sqlite-medical-store.ts', [
    ('  type ContentPackSeed,', '  type ContentPackSeed,\n  type DefinitionReferenceReply,\n  type DefinitionReferenceRequest,'),
    ("import { SCHEMA_SQL }", "import { createDefinitionReferenceDispatch } from './definition-reference-dispatch';\nimport { SCHEMA_SQL }"),
    ('export class SqliteMedicalStore implements MedicalStore {\n  private initialized = false;', '''export class SqliteMedicalStore implements MedicalStore {
  private initialized = false;
  private referenceDispatch: ReturnType<typeof createDefinitionReferenceDispatch> | undefined;

  public async reference(request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> {
    if (!this.initialized || !this.database.pointer) throw new Error('Reference database is not open.');
    this.referenceDispatch ??= createDefinitionReferenceDispatch({
      read: async (sql, parameters) => queryRows(this.database, sql, [...parameters]),
    });
    return this.referenceDispatch(request);
  }'''),
])
edit('packages/storage/src/multi-medical-store.ts', [
    ("import type { ContentPackSeed, EmbeddingProfile } from '@localmed/contracts';", "import { DefinitionReferenceRequestSchema, type DefinitionReferenceRequest, type DefinitionReferenceReply, type ContentPackSeed, type EmbeddingProfile } from '@localmed/contracts';"),
    ('  readonly acceptsSeed?: boolean;', '  readonly acceptsSeed?: boolean;\n  /** Isolated source-reference capability; never exposed as a whole source document. */\n  readonly definitionReference?: { readonly editionId: string; readonly entries: number };'),
    ('export interface MedicalStoreMountStatus {', 'export interface MedicalStoreMountStatus {\n  readonly definitionReference?: { readonly editionId: string; readonly entries: number };'),
    ('    acceptsSeed: mount.acceptsSeed ?? false,', '    acceptsSeed: mount.acceptsSeed ?? false,\n    ...(mount.definitionReference ? { definitionReference: mount.definitionReference } : {}),'),
    ('  public listMounts(): readonly MedicalStoreMountStatus[] {', '''  public async reference(untrusted: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> {
    this.assertInitialized();
    const request = DefinitionReferenceRequestSchema.parse(untrusted);
    const mount = this.mounts.get(request.moduleId);
    if (!mount?.enabled || !mount.definitionReference || mount.definitionReference.editionId !== request.editionId) return { op: 'unavailable' };
    if (!mount.store.reference) throw new Error('Installed reference backend is unavailable.');
    return mount.store.reference(request);
  }

  public listMounts(): readonly MedicalStoreMountStatus[] {'''),
    ('      .filter((mount) => mount.enabled)', '      .filter((mount) => mount.enabled && !mount.definitionReference)'),
    ('  private async validateComposition(): Promise<void> {\n    const active = this.activeMounts();', '''  private async validateComposition(): Promise<void> {
    for (const mount of this.mounts.values()) {
      if (!mount.enabled || !mount.definitionReference) continue;
      if (mount.required || mount.acceptsSeed || !mount.store.reference) throw new Error('Invalid reference mount.');
      const reference = await mount.store.reference({ op: 'status', moduleId: mount.moduleId, editionId: mount.definitionReference.editionId });
      if (reference.op !== 'status' || reference.editionId !== mount.definitionReference.editionId || reference.entries !== mount.definitionReference.entries) throw new Error('Reference edition does not match the installed descriptor.');
    }
    const active = this.activeMounts();'''),
])
edit('packages/core/src/create-medical-core.ts', [
    ('  AnalyzeQueryRequestSchema,', '  AnalyzeQueryRequestSchema,\n  DefinitionReferenceRequestSchema,'),
    ('    async getDocument(documentId): Promise<Result<MedicalDocument, LocalMedError>> {', '''    async reference(request) {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const parsed = DefinitionReferenceRequestSchema.safeParse(request);
        if (!parsed.success) return err(localMedError('INVALID_REQUEST', 'Invalid reference request.'));
        return ok(options.store.reference ? await options.store.reference(parsed.data) : { op: 'unavailable' as const });
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    async getDocument(documentId): Promise<Result<MedicalDocument, LocalMedError>> {'''),
])
edit('apps/app/src/composition/opfs-pack-protocol.ts', [
    ("import type { ContentPackSeed }", "import type { DefinitionReferenceRequest, ContentPackSeed }"),
    ("  | 'initialize'", "  | 'reference'\n  | 'initialize'"),
    ('export type OpfsPackWorkerCallArgs = {', 'export type OpfsPackWorkerCallArgs = {\n  readonly reference: readonly [request: DefinitionReferenceRequest];'),
])
edit('apps/app/src/composition/worker-opfs-medical-store.ts', [
    ("import type { ContentPackSeed, EmbeddingProfile }", "import type { DefinitionReferenceRequest, DefinitionReferenceReply, ContentPackSeed, EmbeddingProfile }"),
    ('  public initialize(seed?: ContentPackSeed): Promise<StorageHealth> {', '''  public reference(request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> {
    if (this.leaseClosed) return Promise.reject(new Error('Reference lease is closed.'));
    return this.call('reference', [request]);
  }

  public initialize(seed?: ContentPackSeed): Promise<StorageHealth> {'''),
])
edit('apps/app/src/features/search/WorkerSearchMedicalCore.ts', [
    ('import type {', "import { ok } from '@localmed/contracts';\nimport type {\n  DefinitionReferenceRequest,\n  DefinitionReferenceReply,"),
    ('  public initialize(): Promise<Result<CoreStatus, LocalMedError>> {', '''  public reference(request: DefinitionReferenceRequest): Promise<Result<DefinitionReferenceReply, LocalMedError>> {
    if (this.closed) return Promise.reject(new Error('Search core is closed.'));
    return this.base.reference ? this.base.reference(request) : Promise.resolve(ok({ op: 'unavailable' }));
  }

  public initialize(): Promise<Result<CoreStatus, LocalMedError>> {'''),
])

edit('packages/contracts/src/content-modules.ts', [
    ("import { z } from 'zod';", "import { z } from 'zod';\nimport { DefinitionReferenceModuleSchema } from './definition-reference-api';"),
    ('    previewDocumentCount: z.number().int().nonnegative().default(0),', '    previewDocumentCount: z.number().int().nonnegative().default(0),\n    definitionReference: DefinitionReferenceModuleSchema.optional(),'),
    ("    if (module.kind === 'core' && !module.required) {", "    if (module.definitionReference && (module.kind !== 'reference' || module.required || module.compatibility.schemaVersion !== 7 || module.releaseState !== 'preview')) {\n      context.addIssue({ code: 'custom', path: ['definitionReference'], message: 'Reference capability requires an optional schema-7 preview edition.' });\n    }\n    if (module.kind === 'core' && !module.required) {"),
])
edit('packages/core/src/content-module-installer.ts', [
    ('  readonly schemaVersion: number;', '  readonly schemaVersion: number;\n  readonly definitionReferenceSchemaVersions?: readonly number[];'),
    ('  if (runtime.schemaVersion !== compatibility.schemaVersion) {', '  const referenceCompatible = module.definitionReference?.contract === 1 && runtime.definitionReferenceSchemaVersions?.includes(compatibility.schemaVersion) === true;\n  if (!referenceCompatible && runtime.schemaVersion !== compatibility.schemaVersion) {'),
])
edit('apps/app/src/features/modules/module-runtime-service.ts', [
    ('      sourceSetDigest: module.sourceSetDigest,', '      sourceSetDigest: module.sourceSetDigest,\n      definitionReference: module.definitionReference,'),
])
edit('apps/app/src/features/modules/browser-module-runtime.ts', [
    ('interface StoredModuleVersion {', "interface StoredModuleVersion {\n  readonly definitionReference?: ContentModuleCatalogEntry['definitionReference'];"),
    ('        key: versionKey(module.id, module.version),', '        key: versionKey(module.id, module.version),\n        ...(module.definitionReference ? { definitionReference: module.definitionReference } : {}),'),
    ('      const schemaCompatible = health.schemaVersion === module.compatibility.schemaVersion;', '''      const schemaCompatible = health.schemaVersion === module.compatibility.schemaVersion;
      let referenceValid = false;
      if (module.definitionReference) {
        const reference = await store.reference({ op: 'status', moduleId: module.id, editionId: module.definitionReference.editionId });
        referenceValid = reference.op === 'status' && reference.entries === module.definitionReference.entries && health.contentPackIds.length === 1 && health.contentPackIds[0] === module.definitionReference.editionId;
      }'''),
    ('        integrity.chunkCount === integrity.ftsRowCount &&', '        (module.definitionReference ? referenceValid : integrity.chunkCount === integrity.ftsRowCount) &&'),
    ("{ appVersion: RELEASE_VERSION, schemaVersion: 2, coreCatalogVersion: '1' }", "{ appVersion: RELEASE_VERSION, schemaVersion: 2, coreCatalogVersion: '1', definitionReferenceSchemaVersions: [7] }"),
    ('        mounts.push({ moduleId: pointer.moduleId, store, enabled: true, searchWeight: 1 });', '''        if (stored.definitionReference) {
          try {
            const status = await store.reference({ op: 'status', moduleId: pointer.moduleId, editionId: stored.definitionReference.editionId });
            if (status.op !== 'status' || status.entries !== stored.definitionReference.entries) throw new Error('Installed reference descriptor mismatch.');
          } catch (cause) {
            await store.close();
            throw cause;
          }
        }
        mounts.push({ moduleId: pointer.moduleId, store, enabled: true, searchWeight: 1,
          ...(stored.definitionReference ? { definitionReference: stored.definitionReference } : {}),
        });'''),
])

# Preview metadata is loaded only from a locally generated same-origin manifest. No public URL is invented.
edit('apps/app/src/features/modules/module-catalog.ts', [
    ("import rawCatalog from", "import { withLocalDefinitionReference } from '@/features/modules/local-definition-reference';\nimport rawCatalog from"),
    ('    modules: [...catalog.modules, ...terminologyModules.filter((module) => !known.has(module.id))],', '    modules: withLocalDefinitionReference([...catalog.modules, ...terminologyModules.filter((module) => !known.has(module.id))]),'),
])

# Initial optional downloads can finish before the core opens. Serialize later reconnects on the same owner.
edit('apps/app/src/app/use-app-session.ts', [
    ('  const connectInstalledModules = async (): Promise<void> => {', '  const reconnectInstalledModules = async (): Promise<void> => {'),
    ('  const refreshDueReminders = (): void => {', '''  let reconnecting: Promise<void> | undefined;
  let reconnectRequested = false;
  const connectInstalledModules = (): Promise<void> => {
    reconnectRequested = true;
    if (!ready() || disposed) return Promise.resolve();
    if (reconnecting) return reconnecting;
    reconnecting = (async () => {
      while (reconnectRequested && !disposed) {
        reconnectRequested = false;
        await reconnectInstalledModules();
      }
    })().finally(() => { reconnecting = undefined; });
    return reconnecting;
  };

  const refreshDueReminders = (): void => {'''),
    ("      performance.mark('minimed:search-ready');", "      performance.mark('minimed:search-ready');\n      setCoreDownloading(false);\n      if (reconnectRequested) await connectInstalledModules();"),
])

edit('apps/app/src/app/App.tsx', [
    ("import { BootScreen }", "import { FirstRunSetup } from '@/features/setup/FirstRunSetup';\nimport { isSetupDismissed, dismissSetup } from '@/features/setup/setup-state';\nimport { BootScreen }"),
    ('  const session = useAppSession();', '  const session = useAppSession();\n  const [setupDismissed, setSetupDismissed] = createSignal(isSetupDismissed());'),
    ('      <main\n        class="app-main"', '''      <Show when={shellReady() && !embeddedFloatingWindow && !setupDismissed()}>
        <FirstRunSetup
          coreReady={Boolean(session.ready())}
          coreRequired={session.coreDownloadRequired()}
          coreDownloading={session.coreDownloading()}
          coreProgress={session.coreProgress()}
          coreError={session.error()}
          onDownloadCore={session.downloadCore}
          onContentChanged={session.connectInstalledModules}
          onClose={() => { dismissSetup(); setSetupDismissed(true); }}
        />
      </Show>
      <main
        class="app-main"'''),
])
edit('apps/app/src/features/search/SearchHome.tsx', [
    ("import { AppGlyph }", "import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';\nimport { AppGlyph }"),
    ('  const [graphOpen, setGraphOpen] = createSignal(false);', '  const [graphOpen, setGraphOpen] = createSignal(false);\n  const [referenceOpen, setReferenceOpen] = createSignal(false);'),
    ('        <button\n          class="search-mode-help"', '''        <button class="search-reference-button" type="button" onClick={() => setReferenceOpen(true)}>Словарь</button>
        <button
          class="search-mode-help"'''),
    ('      <Show when={graphOpen()}>', '''      <Show when={referenceOpen()}>
        <OverlayDialog open title="Словарь терминов" class="reference-dialog" onClose={() => setReferenceOpen(false)}>
          <DefinitionReferencePanel core={props.baseCore} onContentChanged={props.onContentChanged} />
        </OverlayDialog>
      </Show>
      <Show when={graphOpen()}>'''),
])

p = Path('.gitignore')
p.write_text(p.read_text() + '\n# Owner-local reference edition; never a release asset or committed corpus.\n/apps/app/src/features/modules/catalog.definition-reference.local.json\n/apps/app/public/content/definition-reference/\n')
changed.append(str(p))
Path('data/build').mkdir(parents=True, exist_ok=True)
Path('data/build/reference-r2-changed.json').write_text(__import__('json').dumps(changed))
print('Integrated', len(changed), 'reviewed existing files.')
