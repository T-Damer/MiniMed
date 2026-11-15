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
import {
  createIndexedDbShelfFacts,
  type ShelfFacts,
  type ShelfFactsStore,
} from '@/composition/module-shelf-facts';
import { SHELF_SHARD_COUNT, shelfPoolName, shelfShardOf } from '@/composition/module-shelf-names';
import type {
  ShelfCall,
  ShelfCallMethod,
  ShelfCallOutcome,
  ShelfLockStatus,
  ShelfRequest,
  ShelfResponse,
  ShelfStats,
} from '@/composition/module-shelf-protocol';

import { RELEASE_VERSION } from '../../../../release';

/**
 * The module shelf (client side): the installed modules are files of a few OPFS pools (shards),
 * each owned by one worker that keeps a SQLite connection per file. Each `ShelfModuleStore` is a
 * thin `MedicalStore` for one of them, so `MultiMedicalStore` mounts a module exactly as it
 * mounted an in-memory one.
 *
 * Why a shelf: a module used to be deserialized whole into the wasm heap of the main thread
 * (at most 2 GB), so ~800 clinical modules (1.65 GB) plus their page caches ended in SQLITE_NOMEM
 * and a search core that could not read anything. On the shelf a module costs a connection
 * (~170 KB) and a 256 KiB page cache in the worker, whatever its size. Why shards: SQLite in a
 * worker is synchronous, so one worker answered the hundreds of modules a search asks one after
 * another; three workers answer them on three threads.
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
type ShelfListingMethod =
  | 'listDocumentIdentities'
  | 'listAliases'
  | 'listNavigationDocuments'
  | 'listSearchDocuments'
  | 'listCoreIdentityNames'
  | 'listEmbeddingProfiles';

export interface ShelfEntry {
  leases: number;
  /**
   * Settles when the worker has the connection open (or failed to). Unset while the connection is
   * not asked for yet: a file with kept facts is opened by its first real call or by the
   * background warm-up, not at the start (800 cold file opens cost 18–20 s on a phone).
   */
  opened?: Promise<void> | undefined;
  /** Opens the connection now, once. */
  readonly connect: () => Promise<void>;
  /** The worker's `initialize` has been sent for this file in this page. */
  initSent?: boolean;
  readonly listings: Map<ShelfListingMethod, Promise<unknown>>;
  /** The file's health never changes while it is open read-only; every search asks for it. */
  health?: Promise<StorageHealth> | undefined;
  /**
   * The health came from the kept facts and the worker's own `initialize` has not run yet: it is
   * sent in front of the first call that reaches the file.
   */
  initPending?: boolean;
  /** What is kept of this file across starts (`module-shelf-facts`). */
  facts: ShelfFacts;
  /**
   * The documents of the file, once its identities are known. A module is then asked only about
   * documents it holds: a search or a reader call otherwise went to every one of ~800 files.
   */
  documents?: { readonly ids: ReadonlySet<string>; readonly versions: ReadonlySet<string> };
  /** True once the file is known to carry no core identity names. */
  noCoreNames?: boolean;
}

/** Derives the membership shortcuts from a listing that has just become known. */
function noteListing(entry: ShelfEntry, method: string, value: unknown): void {
  if (method === 'listDocumentIdentities' && Array.isArray(value)) {
    const identities = value as readonly DocumentIdentity[];
    entry.documents = {
      ids: new Set(identities.map((identity) => identity.id)),
      versions: new Set(identities.map((identity) => identity.versionId)),
    };
  }
  if (method === 'listCoreIdentityNames' && Array.isArray(value)) {
    entry.noCoreNames = value.length === 0;
  }
}

export interface ShelfWorker {
  postMessage(message: ShelfRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShelfResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface ModuleShelfOptions {
  /** The worker of a shard (tests); the shard index tells them apart. */
  readonly createWorker?: (shard: number) => ShelfWorker;
  /** Shards of the shelf (`SHELF_SHARD_COUNT`); tests use fewer. */
  readonly shardCount?: number;
  /** The pool of a shard (`shelfPoolName`). */
  readonly poolName?: (shard: number) => string;
  /** How long a worker without open files lives on, for the next install or core rebuild. */
  readonly idleShutdownMs?: number;
  /** Health and listings kept across starts; without it every start asks the files. */
  readonly facts?: ShelfFactsStore;
}

interface ShelfShardOptions {
  readonly facts?: ShelfFactsStore | undefined;
  readonly createWorker?: (() => ShelfWorker) | undefined;
  readonly poolName: string;
  readonly idleShutdownMs?: number | undefined;
}

const IDLE_SHUTDOWN_MS = 4_000;

/** One worker and its pool: the files of the modules whose names hash to it. */
class ShelfShard {
  private worker: ShelfWorker | undefined;
  private ready: Promise<void> | undefined;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly entries = new Map<string, ShelfEntry>();
  private queued: QueuedCall[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private failure: Error | undefined;
  private waitingForOtherTab: ((waiting: boolean) => void) | undefined;
  /** The pool's files, as its worker listed them at start and the shelf changed them since. */
  private files = new Set<string>();

  public constructor(private readonly options: ShelfShardOptions) {}

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

  /** Whether the pool holds `file`; starts the worker, which lists the pool. */
  public async holds(file: string): Promise<boolean> {
    if (this.failure) throw this.failure;
    await this.start();
    return this.files.has(file) || this.entries.has(file);
  }

  /** Whether a connection to `file` is open (or opening) here. */
  public isOpen(file: string): boolean {
    return this.entries.has(file);
  }

  public async put(file: string, bytes: Uint8Array): Promise<void> {
    await this.send({ type: 'put', file, byteLength: bytes.byteLength, bytes });
    this.files.add(file);
    this.scheduleIdleShutdown();
  }

  /** Deletes a file no connection here uses (a module moved to its own shard). */
  public async unlink(file: string): Promise<void> {
    await this.send({ type: 'unlink', file });
    this.files.delete(file);
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

  public async sweep(referencedVersionKeys: readonly string[]): Promise<number> {
    const removed = (await this.send({ type: 'sweep', referencedVersionKeys })) as number;
    this.files = new Set(
      ((await this.send({ type: 'list' })) as readonly string[] | undefined) ?? [],
    );
    this.scheduleIdleShutdown();
    return removed;
  }

  public async open(
    file: string,
    byteLength: number,
    options: { readonly bytes?: Uint8Array; readonly cacheSizeKiB: number },
  ): Promise<ShelfModuleStore> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    // A file just written (`bytes`) is asked itself; an installed one may have kept facts.
    const known =
      options.bytes || this.entries.has(file) || !this.options.facts
        ? undefined
        : (await this.options.facts.load()).get(file);
    // Known facts and a file the pool lists: nothing has to be read now. A file the pool does not
    // list is opened at once, so a missing module is reported at the mount as before.
    let lazy = false;
    if (known?.health && !this.entries.has(file)) {
      await this.start();
      lazy = this.files.has(file);
    }
    let entry = this.entries.get(file);
    if (entry) {
      entry.leases += 1;
    } else {
      const keptHealth = known?.health;
      const created: ShelfEntry = {
        leases: 1,
        connect: () => {
          created.opened ??= this.send({
            type: 'open',
            file,
            byteLength,
            cacheSizeKiB: options.cacheSizeKiB,
            ...(options.bytes ? { bytes: options.bytes } : {}),
          }).then(() => {
            this.files.add(file);
          });
          return created.opened;
        },
        listings: new Map(
          Object.entries(known?.listings ?? {}).map(([method, value]) => [
            method as ShelfListingMethod,
            Promise.resolve(value),
          ]),
        ),
        ...(keptHealth ? { health: Promise.resolve(keptHealth), initPending: true } : {}),
        facts: { ...(keptHealth ? { health: keptHealth } : {}), listings: { ...known?.listings } },
      };
      for (const [method, value] of Object.entries(known?.listings ?? {})) {
        noteListing(created, method, value);
      }
      entry = created;
      this.entries.set(file, created);
      if (!lazy) void created.connect().catch(() => undefined);
    }
    const current = entry;
    try {
      // A lazily kept file has nothing to wait for; anything else waits for its connection.
      if (current.opened) await current.opened;
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
      const wasEmpty = this.queued.length === 0;
      const entry = this.entries.get(file);
      if (entry && method === 'initialize') entry.initSent = true;
      if (entry?.initPending) {
        // The start answered from the kept facts; the file itself is initialised now, in front of
        // its first real call (same message, same order).
        entry.initPending = false;
        entry.initSent = true;
        if (method !== 'initialize') {
          const ignore = (): void => undefined;
          this.queued.push({
            file,
            method: 'initialize',
            args: [],
            resolve: ignore,
            reject: ignore,
          });
        }
      }
      this.queued.push({ file, method, args, resolve, reject });
      if (wasEmpty) queueMicrotask(() => void this.flushCalls());
    });
  }

  /** @internal Keeps an answer of `file` for the next start. */
  public remember(file: string, entry: ShelfEntry, fact: ShelfFacts): void {
    for (const [method, value] of Object.entries(fact.listings ?? {})) {
      noteListing(entry, method, value);
    }
    if (!this.options.facts || this.entries.get(file) !== entry) return;
    if (fact.health) entry.facts.health = fact.health;
    if (fact.listings) entry.facts.listings = { ...entry.facts.listings, ...fact.listings };
    this.options.facts.save(file, entry.facts);
  }

  private async flushCalls(): Promise<void> {
    // Calls issued in the microtasks that ran before this one are in the queue now.
    await Promise.resolve();
    const queued = this.queued;
    this.queued = [];
    // Files whose connection was left for later are opened now; a file that cannot be opened
    // fails its own calls only.
    const unopened = new Map<string, Error>();
    await Promise.all(
      [...new Set(queued.map((call) => call.file))].map(async (file) => {
        const entry = this.entries.get(file);
        if (!entry) return;
        try {
          await entry.connect();
        } catch (cause) {
          unopened.set(
            file,
            cause instanceof Error ? cause : new Error('The module file could not be opened.'),
          );
        }
      }),
    );
    const calls = queued.filter((call) => {
      const failure = unopened.get(call.file);
      if (failure) call.reject(failure);
      return !failure;
    });
    if (calls.length === 0) return;
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
      // A connection that was never asked for has nothing to close.
      if (entry.opened) {
        await entry.opened.catch(() => undefined);
        await this.send({ type: 'close', file });
      }
    } finally {
      this.scheduleIdleShutdown();
    }
  }

  /**
   * Opens the connections left for later, one after another, so the first search does not pay for
   * all of them at once. One at a time: a reader's call for a single file waits for one open.
   */
  public async warm(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      if (this.failure) return;
      if (!entry.opened) await entry.connect().catch(() => undefined);
    }
  }

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
    const ready = this.request({ type: 'init', poolName: this.options.poolName }).then((names) => {
      this.files = new Set((names as readonly string[] | undefined) ?? []);
    });
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

/**
 * The shelf as callers see it: a file lives in the shard its name hashes to (`shelfShardOf`), so
 * the modules of one search spread over the shard workers. A file an earlier app wrote into the
 * single pool (now shard 0) moves to its shard when it is first opened, one file at a time.
 */
export class ModuleShelf {
  private readonly shards: readonly ShelfShard[];
  private readonly waitingShards = new Set<number>();
  private waitingForOtherTab: ((waiting: boolean) => void) | undefined;
  /** Moves read a whole image into this thread: one at a time. */
  private moves: Promise<unknown> = Promise.resolve();

  public constructor(options: ModuleShelfOptions = {}) {
    const count = Math.max(1, options.shardCount ?? SHELF_SHARD_COUNT);
    this.shards = Array.from({ length: count }, (_, index) => {
      const create = options.createWorker;
      const shard = new ShelfShard({
        facts: options.facts,
        createWorker: create ? () => create(index) : undefined,
        poolName: (options.poolName ?? shelfPoolName)(index),
        idleShutdownMs: options.idleShutdownMs,
      });
      shard.onWaitingForOtherTab((waiting) => {
        const before = this.waitingShards.size > 0;
        if (waiting) this.waitingShards.add(index);
        else this.waitingShards.delete(index);
        if (before !== this.waitingShards.size > 0) this.waitingForOtherTab?.(!before);
      });
      return shard;
    });
  }

  /** True once a shard could not start (no OPFS, a worker error): callers keep modules in memory. */
  public get unavailable(): boolean {
    return this.shards.some((shard) => shard.unavailable);
  }

  /** True while a shard worker is alive (files are open, or an install is writing). */
  public get running(): boolean {
    return this.shards.some((shard) => shard.running);
  }

  public onWaitingForOtherTab(listener: (waiting: boolean) => void): void {
    this.waitingForOtherTab = listener;
  }

  /**
   * Writes a module's database image into the pool without keeping a connection. Throws when the
   * image cannot be stored or is not a database; the caller then keeps the bytes elsewhere.
   */
  public put(file: string, bytes: Uint8Array): Promise<void> {
    return this.home(file).put(file, bytes);
  }

  /** The database image of a file, or null when no shard holds it. */
  public async read(file: string): Promise<Uint8Array | null> {
    const holder = await this.holder(file);
    return holder ? holder.read(file) : null;
  }

  /** What the shard workers hold now: open files and the size of their wasm heaps, summed. */
  public async stats(): Promise<ShelfStats> {
    const all = await Promise.all(this.shards.map((shard) => shard.stats()));
    return {
      openFiles: all.reduce((total, stats) => total + stats.openFiles, 0),
      heapBytes: all.reduce((total, stats) => total + stats.heapBytes, 0),
    };
  }

  /**
   * Deletes the files of module versions no stored row refers to; open files are left. Only the
   * shards already running are asked: starting a worker would hold its pool lock for nothing.
   */
  public async sweep(referencedVersionKeys: readonly string[]): Promise<number> {
    const running = this.shards.filter((shard) => shard.running);
    const removed = await Promise.all(running.map((shard) => shard.sweep(referencedVersionKeys)));
    return removed.reduce((total, count) => total + count, 0);
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
    const home = this.home(file);
    if (options.bytes || this.shards.length === 1 || home.isOpen(file)) {
      return home.open(file, byteLength, options);
    }
    const holder = await this.holder(file);
    // Not on the shelf at all: the home shard reports the missing file as before. A connection of
    // the previous core still using the old copy keeps reading it where it is.
    if (!holder || holder === home || holder.isOpen(file)) {
      return (holder ?? home).open(file, byteLength, options);
    }
    const moved = this.moves.then(() =>
      this.openMoved(file, byteLength, holder, options.cacheSizeKiB),
    );
    this.moves = moved.catch(() => undefined);
    return moved;
  }

  /** Opens, in the background, the files whose connection the start left for later. */
  public async warm(): Promise<void> {
    await Promise.all(this.shards.map((shard) => shard.warm()));
  }

  /** Stops the workers (tests, and the end of the page). Open stores fail afterwards. */
  public dispose(): void {
    for (const shard of this.shards) shard.dispose();
  }

  private home(file: string): ShelfShard {
    return this.shards[shelfShardOf(file, this.shards.length)] as ShelfShard;
  }

  private async holder(file: string): Promise<ShelfShard | undefined> {
    const home = this.home(file);
    if (await home.holds(file)) return home;
    for (const shard of this.shards) {
      if (shard !== home && (await shard.holds(file))) return shard;
    }
    return undefined;
  }

  /** Moves a file to its shard from the shard an earlier app wrote it to, then opens it there. */
  private async openMoved(
    file: string,
    byteLength: number,
    holder: ShelfShard,
    cacheSizeKiB: number,
  ): Promise<ShelfModuleStore> {
    const home = this.home(file);
    const bytes = (await home.holds(file)) ? null : await holder.read(file);
    // Another open moved it while this one waited its turn.
    if (!bytes) return home.open(file, byteLength, { cacheSizeKiB });
    const store = await home.open(file, bytes.byteLength, { bytes, cacheSizeKiB });
    if (!holder.isOpen(file)) await holder.unlink(file);
    return store;
  }
}

/** A module file of the shelf as a `MedicalStore`; the connection lives in a shard worker. */
export class ShelfModuleStore implements MedicalStore {
  private closed = false;

  public constructor(
    private readonly shelf: ShelfShard,
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
      this.entry.initPending = false;
    }
    // Kept from an earlier start: the answer is known, and the file is initialised with its
    // first real call instead of now (800 files at every start).
    // Also on a core rebuild: the file was initialised once in this page already.
    if (
      seed === undefined &&
      (this.entry.initPending || this.entry.initSent) &&
      this.entry.health &&
      !this.closed
    ) {
      return this.entry.health;
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
      health.then(
        (value) => this.shelf.remember(this.file, entry, { health: value }),
        () => {
          if (entry.health === health) entry.health = undefined;
        },
      );
    }
    return health;
  }

  public listDocumentIdentities(): Promise<readonly DocumentIdentity[]> {
    return this.listing('listDocumentIdentities');
  }

  public lookupCoreIdentities(query: string): Promise<readonly CoreIdentityHit[]> {
    // A clinical module carries no core identity names: nothing to look up in it.
    if (this.entry.noCoreNames && !this.closed) return Promise.resolve([]);
    return this.call('lookupCoreIdentities', [query]);
  }

  public listCoreIdentityNames(): Promise<readonly string[]> {
    return this.listing('listCoreIdentityNames');
  }

  public listSearchDocuments(): Promise<readonly SearchDocumentDescriptor[]> {
    return this.listing('listSearchDocuments');
  }

  public listDocuments(): Promise<readonly DocumentRecord[]> {
    return this.call('listDocuments', []);
  }

  public listNavigationDocuments(): Promise<readonly DocumentRecord[]> {
    return this.listing('listNavigationDocuments');
  }

  public getDocument(id: string): Promise<DocumentRecord | null> {
    if (this.lacksDocument(id)) return Promise.resolve(null);
    return this.call('getDocument', [id]);
  }

  public getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    const known = this.entry.documents;
    if (known && !known.versions.has(versionId) && !this.closed) return Promise.resolve(null);
    return this.call('getDocumentByVersionId', [versionId]);
  }

  public getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    if (this.lacksDocument(documentId)) return Promise.resolve([]);
    return this.call('getSectionsByDocument', [documentId]);
  }

  public getSection(id: string): Promise<SectionRecord | null> {
    return this.call('getSection', [id]);
  }

  public getChunksByDocument(documentId: string): Promise<readonly ChunkRecord[]> {
    if (this.lacksDocument(documentId)) return Promise.resolve([]);
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
    return this.listing('listEmbeddingProfiles');
  }

  public search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    if (this.outsideDocumentFilter(request.filters)) return Promise.resolve([]);
    return this.call('search', [request]);
  }

  public searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    if (this.outsideDocumentFilter(request.filters)) return Promise.resolve([]);
    return this.call('searchVector', [request]);
  }

  public scoreVectors(request: VectorSearchRequest): Promise<readonly VectorScore[]> {
    if (this.outsideDocumentFilter(request.filters)) return Promise.resolve([]);
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

  /** True when the file's documents are known and `documentId` is not one of them. */
  private lacksDocument(documentId: string): boolean {
    const known = this.entry.documents;
    return known !== undefined && !known.ids.has(documentId) && !this.closed;
  }

  /** True when the request names documents and none of them is in this file. */
  private outsideDocumentFilter(filters: SearchFilters): boolean {
    const known = this.entry.documents;
    const wanted = filters.documentIds;
    if (!known || !wanted || wanted.length === 0 || this.closed) return false;
    return !wanted.some((id) => known.ids.has(id));
  }

  /** Read once per open file, across the leases of a core rebuild; a failed read is retried. */
  private listing<M extends ShelfListingMethod>(method: M): Promise<never> {
    let pending = this.entry.listings.get(method);
    if (!pending) {
      pending = this.call(method, []);
      this.entry.listings.set(method, pending);
      const entry = this.entry;
      pending.then(
        (value) => this.shelf.remember(this.file, entry, { listings: { [method]: value } }),
        () => entry.listings.delete(method),
      );
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
  sharedShelf ??= new ModuleShelf(
    typeof indexedDB === 'undefined' ? {} : { facts: createIndexedDbShelfFacts(RELEASE_VERSION) },
  );
  return sharedShelf.unavailable ? undefined : sharedShelf;
}

export function resetModuleShelfForTests(): void {
  sharedShelf?.dispose();
  sharedShelf = undefined;
}
