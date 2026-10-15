import type {
  ContentPackSeed,
  CoreIdentityHit,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  EmbeddingProfile,
  SearchFilters,
} from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';
import type {
  DocumentIdentity,
  LexicalHit,
  LexicalSearchRequest,
  MedicalStore,
  SearchDocumentDescriptor,
  StorageHealth,
  VectorHit,
  VectorScore,
  VectorSearchRequest,
} from '@localmed/storage';
import { SHELF_POOL_NAME } from '@/composition/module-shelf-names';
import type {
  ShelfCall,
  ShelfCallMethod,
  ShelfCallOutcome,
  ShelfLockStatus,
  ShelfRequest,
  ShelfResponse,
  ShelfStats,
} from '@/composition/module-shelf-protocol';

/**
 * The module shelf (client side): the installed modules are files of one OPFS pool, owned by one
 * worker that keeps a SQLite connection per file. Each `ShelfModuleStore` is a thin `MedicalStore`
 * for one of them, so `MultiMedicalStore` mounts a module exactly as it mounted an in-memory one.
 *
 * Why a shelf: a module used to be deserialized whole into the wasm heap of the main thread
 * (at most 2 GB), so ~800 clinical modules (1.65 GB) plus their page caches ended in SQLITE_NOMEM
 * and a search core that could not read anything. On the shelf a module costs a connection
 * (~170 KB) and a 256 KiB page cache in the worker, whatever its size.
 */

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type ShelfRequestBody = WithoutId<ShelfRequest>;

interface QueuedCall extends ShelfCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

/** Whole-pack listings never change while a module file is open read-only. */
type ShelfListingMethod = 'listDocumentIdentities' | 'listAliases' | 'listNavigationDocuments';

export interface ShelfEntry {
  leases: number;
  /** Settles when the worker has the connection open (or failed to). */
  readonly opened: Promise<void>;
  readonly listings: Map<ShelfListingMethod, Promise<unknown>>;
  /** The file's health never changes while it is open read-only; every search asks for it. */
  health?: Promise<StorageHealth> | undefined;
}

export interface ShelfWorker {
  postMessage(message: ShelfRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShelfResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface ModuleShelfOptions {
  readonly createWorker?: () => ShelfWorker;
  readonly poolName?: string;
  /** How long a worker without open files lives on, for the next install or core rebuild. */
  readonly idleShutdownMs?: number;
}

const IDLE_SHUTDOWN_MS = 4_000;

export class ModuleShelf {
  private worker: ShelfWorker | undefined;
  private ready: Promise<void> | undefined;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly entries = new Map<string, ShelfEntry>();
  private queued: QueuedCall[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private failure: Error | undefined;
  private waitingForOtherTab: ((waiting: boolean) => void) | undefined;

  public constructor(private readonly options: ModuleShelfOptions = {}) {}

  /** True once the shelf could not start (no OPFS, a worker error): callers keep modules in memory. */
  public get unavailable(): boolean {
    return this.failure !== undefined;
  }

  /** True while the worker is alive (files are open, or an install is writing). */
  public get running(): boolean {
    return this.worker !== undefined;
  }

  public onWaitingForOtherTab(listener: (waiting: boolean) => void): void {
    this.waitingForOtherTab = listener;
  }

  /**
   * Writes a module's database image into the pool without keeping a connection. Throws when the
   * image cannot be stored or is not a database; the caller then keeps the bytes elsewhere.
   */
  public async put(file: string, bytes: Uint8Array): Promise<void> {
    await this.send({ type: 'put', file, byteLength: bytes.byteLength, bytes });
    this.scheduleIdleShutdown();
  }

  /** The database image of a file, or null when the pool does not hold it. */
  public async read(file: string): Promise<Uint8Array | null> {
    const bytes = (await this.send({ type: 'read', file })) as Uint8Array | null | undefined;
    this.scheduleIdleShutdown();
    return bytes ?? null;
  }

  /** What the shelf worker holds now: open files and the size of its wasm heap. */
  public async stats(): Promise<ShelfStats> {
    return (await this.send({ type: 'stats' })) as ShelfStats;
  }

  /** Deletes the files of module versions no stored row refers to; open files are left. */
  public async sweep(referencedVersionKeys: readonly string[]): Promise<number> {
    const removed = (await this.send({ type: 'sweep', referencedVersionKeys })) as number;
    this.scheduleIdleShutdown();
    return removed;
  }

  /**
   * Opens a module file. `bytes` is written first when the pool does not hold the file (an index
   * that is still in IndexedDB); without it the file must be there already. A file that is open
   * is leased again, as a core rebuild opens every module while the previous core is still live.
   */
  public async open(
    file: string,
    byteLength: number,
    options: { readonly bytes?: Uint8Array; readonly cacheSizeKiB: number },
  ): Promise<ShelfModuleStore> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    let entry = this.entries.get(file);
    if (entry) {
      entry.leases += 1;
    } else {
      const created: ShelfEntry = {
        leases: 1,
        opened: this.send({
          type: 'open',
          file,
          byteLength,
          cacheSizeKiB: options.cacheSizeKiB,
          ...(options.bytes ? { bytes: options.bytes } : {}),
        }).then(() => undefined),
        listings: new Map(),
      };
      entry = created;
      this.entries.set(file, created);
    }
    const current = entry;
    try {
      await current.opened;
    } catch (cause) {
      current.leases -= 1;
      if (this.entries.get(file) === current && current.leases === 0) this.entries.delete(file);
      this.scheduleIdleShutdown();
      throw cause;
    }
    return new ShelfModuleStore(this, file, current);
  }

  /**
   * @internal Used by `ShelfModuleStore`. Calls made in the same turn of the event loop travel as
   * one message and come back as one: a search asks every mounted module, hundreds of them.
   */
  public call(file: string, method: ShelfCallMethod, args: readonly unknown[]): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.queued.push({ file, method, args, resolve, reject });
      if (this.queued.length === 1) queueMicrotask(() => void this.flushCalls());
    });
  }

  private async flushCalls(): Promise<void> {
    // Calls issued in the microtasks that ran before this one are in the queue now.
    await Promise.resolve();
    const calls = this.queued;
    this.queued = [];
    try {
      const outcomes = (await this.send({
        type: 'batch',
        calls: calls.map(({ file, method, args }) => ({ file, method, args })),
      })) as readonly ShelfCallOutcome[];
      calls.forEach((call, index) => {
        const outcome = outcomes[index];
        if (outcome && 'value' in outcome) call.resolve(outcome.value);
        else call.reject(new Error(outcome?.error ?? 'The module store call failed.'));
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('The module shelf call failed.');
      for (const call of calls) call.reject(error);
    }
  }

  /** @internal */
  public async release(file: string, entry: ShelfEntry): Promise<void> {
    entry.leases -= 1;
    if (entry.leases > 0 || this.entries.get(file) !== entry) return;
    this.entries.delete(file);
    try {
      await this.send({ type: 'close', file });
    } finally {
      this.scheduleIdleShutdown();
    }
  }

  /** Stops the worker (tests, and the end of the page). Open stores fail afterwards. */
  public dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.shutdown(new Error('The module shelf was closed.'));
    this.entries.clear();
  }

  private scheduleIdleShutdown(): void {
    if (this.entries.size > 0 || this.pending.size > 0 || !this.worker) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.entries.size === 0 && this.pending.size === 0) {
        this.shutdown(new Error('The module shelf is idle.'), false);
      }
    }, this.options.idleShutdownMs ?? IDLE_SHUTDOWN_MS);
  }

  private shutdown(error: Error, failed = true): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
    if (failed) this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker =
      this.options.createWorker?.() ??
      (new Worker(new URL('./module-shelf.worker.ts', import.meta.url), {
        type: 'module',
      }) as unknown as ShelfWorker);
    this.worker = worker;
    worker.onmessage = (event) => {
      const data = event.data;
      if ('status' in data) {
        this.waitingForOtherTab?.(data.status === ('lock-wait' satisfies ShelfLockStatus));
        return;
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if ('error' in data) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    worker.onerror = () => this.shutdown(new Error('The module shelf worker failed.'));
    const ready = this.request({
      type: 'init',
      poolName: this.options.poolName ?? SHELF_POOL_NAME,
    }).then(() => undefined);
    this.ready = ready;
    ready.catch((cause: unknown) =>
      this.shutdown(cause instanceof Error ? cause : new Error('The module shelf did not start.')),
    );
    return ready;
  }

  private async send(body: ShelfRequestBody): Promise<unknown> {
    if (this.failure) throw this.failure;
    await this.start();
    return this.request(body);
  }

  private request(body: ShelfRequestBody): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('The module shelf is closed.'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...body, id } as ShelfRequest);
    });
  }
}

/** A module file of the shelf as a `MedicalStore`; the connection lives in the shelf worker. */
export class ShelfModuleStore implements MedicalStore {
  private closed = false;

  public constructor(
    private readonly shelf: ModuleShelf,
    private readonly file: string,
    private readonly entry: ShelfEntry,
  ) {}

  public reference(request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> {
    return this.call('reference', [request]);
  }

  public initialize(seed?: ContentPackSeed): Promise<StorageHealth> {
    if (seed !== undefined) {
      this.entry.listings.clear();
      this.entry.health = undefined;
    }
    return this.call('initialize', seed === undefined ? [] : [seed]);
  }

  /**
   * Asked once per file, not once per search: `MedicalCore` checks `getHealth` of every mounted
   * store before each search, and answering it in the worker cost ~9 messages × 800 modules.
   */
  public getHealth(): Promise<StorageHealth> {
    if (this.closed) return Promise.reject(new Error('The module store is closed.'));
    let health = this.entry.health;
    if (!health) {
      health = this.call<StorageHealth>('getHealth', []);
      this.entry.health = health;
      const entry = this.entry;
      health.catch(() => {
        if (entry.health === health) entry.health = undefined;
      });
    }
    return health;
  }

  public listDocumentIdentities(): Promise<readonly DocumentIdentity[]> {
    return this.listing('listDocumentIdentities');
  }

  public lookupCoreIdentities(query: string): Promise<readonly CoreIdentityHit[]> {
    return this.call('lookupCoreIdentities', [query]);
  }

  public listCoreIdentityNames(): Promise<readonly string[]> {
    return this.call('listCoreIdentityNames', []);
  }

  public listSearchDocuments(): Promise<readonly SearchDocumentDescriptor[]> {
    return this.call('listSearchDocuments', []);
  }

  public listDocuments(): Promise<readonly DocumentRecord[]> {
    return this.call('listDocuments', []);
  }

  public listNavigationDocuments(): Promise<readonly DocumentRecord[]> {
    return this.listing('listNavigationDocuments');
  }

  public getDocument(id: string): Promise<DocumentRecord | null> {
    return this.call('getDocument', [id]);
  }

  public getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    return this.call('getDocumentByVersionId', [versionId]);
  }

  public getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    return this.call('getSectionsByDocument', [documentId]);
  }

  public getSection(id: string): Promise<SectionRecord | null> {
    return this.call('getSection', [id]);
  }

  public getChunksByDocument(documentId: string): Promise<readonly ChunkRecord[]> {
    return this.call('getChunksByDocument', [documentId]);
  }

  public getChunksBySection(sectionId: string): Promise<readonly ChunkRecord[]> {
    return this.call('getChunksBySection', [sectionId]);
  }

  public getChunk(id: string): Promise<ChunkRecord | null> {
    return this.call('getChunk', [id]);
  }

  public getChunkWindow(chunkId: string, radius: number): Promise<readonly ChunkRecord[]> {
    return this.call('getChunkWindow', [chunkId, radius]);
  }

  public listAliases(): Promise<readonly AliasRecord[]> {
    return this.listing('listAliases');
  }

  public listEmbeddingProfiles(): Promise<readonly EmbeddingProfile[]> {
    return this.call('listEmbeddingProfiles', []);
  }

  public search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    return this.call('search', [request]);
  }

  public searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    return this.call('searchVector', [request]);
  }

  public scoreVectors(request: VectorSearchRequest): Promise<readonly VectorScore[]> {
    return this.call('scoreVectors', [request]);
  }

  public hydrateVectorHits(
    scores: readonly VectorScore[],
    filters: SearchFilters,
  ): Promise<readonly VectorHit[]> {
    return this.call('hydrateVectorHits', [scores, filters]);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.shelf.release(this.file, this.entry);
  }

  /** Read once per open file, across the leases of a core rebuild; a failed read is retried. */
  private listing<M extends ShelfListingMethod>(method: M): Promise<never> {
    let pending = this.entry.listings.get(method);
    if (!pending) {
      pending = this.call(method, []);
      this.entry.listings.set(method, pending);
      const listings = this.entry.listings;
      pending.catch(() => listings.delete(method));
    }
    return pending as Promise<never>;
  }

  private call<T>(method: ShelfCallMethod, args: readonly unknown[]): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The module store is closed.'));
    return this.shelf.call(this.file, method, args) as Promise<T>;
  }
}

let sharedShelf: ModuleShelf | undefined;

/**
 * The page's module shelf, or undefined where one cannot run (no worker, no OPFS, or a shelf that
 * failed to start): then modules stay in memory, as before.
 */
export function getModuleShelf(): ModuleShelf | undefined {
  if (
    typeof Worker === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.locks ||
    !navigator.storage?.getDirectory
  ) {
    return undefined;
  }
  sharedShelf ??= new ModuleShelf();
  return sharedShelf.unavailable ? undefined : sharedShelf;
}

export function resetModuleShelfForTests(): void {
  sharedShelf?.dispose();
  sharedShelf = undefined;
}
