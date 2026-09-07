import type { ContentPackSeed, EmbeddingProfile } from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';
import type {
  DocumentIdentity,
  LexicalHit,
  LexicalSearchRequest,
  MedicalStore,
  SearchDocumentDescriptor,
  StorageHealth,
  VectorHit,
  VectorSearchRequest,
} from '@localmed/storage';
import type { SqliteIntegrityReport } from '@localmed/storage-sqlite';

import type {
  OpfsPackWorkerCallArgs,
  OpfsPackWorkerMethod,
  OpfsPackWorkerOpenOptions,
  OpfsPackWorkerResponse,
} from '@/composition/opfs-pack-protocol';

type PendingCall = {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

type SharedWorkerStore = {
  readonly optionsKey: string;
  readonly poolName: string;
  owner: Promise<WorkerOpfsMedicalStore>;
};

export class WorkerOpfsMedicalStore implements MedicalStore {
  private static readonly sharedStores = new Map<string, SharedWorkerStore>();

  private requestId = 0;
  private readonly pending = new Map<number, PendingCall>();
  private readonly owner: WorkerOpfsMedicalStore;
  private connectionClosed = false;
  private leaseClosed = false;
  private leaseCount = 1;
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly worker: Worker,
    private readonly shared?: SharedWorkerStore,
    owner?: WorkerOpfsMedicalStore,
  ) {
    this.owner = owner ?? this;
    if (owner) return;
    worker.onmessage = (event: MessageEvent<OpfsPackWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if ('error' in event.data) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    };
    worker.onerror = () => this.shutdown(new Error('OPFS pack worker failed.'));
  }

  public static async open(options: OpfsPackWorkerOpenOptions): Promise<WorkerOpfsMedicalStore> {
    const optionsKey = JSON.stringify([options.databaseName, options.fetchTimeoutMs]);
    const existing = WorkerOpfsMedicalStore.sharedStores.get(options.poolName);
    if (existing) {
      if (existing.optionsKey !== optionsKey) {
        throw new Error(`SAH pool ${options.poolName} is already open for another database.`);
      }
      const owner = await existing.owner;
      if (owner.closing) {
        await owner.closing;
        return WorkerOpfsMedicalStore.open(options);
      }
      if (owner.connectionClosed) {
        WorkerOpfsMedicalStore.sharedStores.delete(options.poolName);
        return WorkerOpfsMedicalStore.open(options);
      }
      owner.leaseCount += 1;
      return new WorkerOpfsMedicalStore(owner.worker, existing, owner);
    }

    const shared = { optionsKey, poolName: options.poolName } as SharedWorkerStore;
    shared.owner = WorkerOpfsMedicalStore.openOwner(options, shared);
    WorkerOpfsMedicalStore.sharedStores.set(options.poolName, shared);
    try {
      return await shared.owner;
    } catch (cause) {
      if (WorkerOpfsMedicalStore.sharedStores.get(options.poolName) === shared) {
        WorkerOpfsMedicalStore.sharedStores.delete(options.poolName);
      }
      throw cause;
    }
  }

  private static async openOwner(
    options: OpfsPackWorkerOpenOptions,
    shared: SharedWorkerStore,
  ): Promise<WorkerOpfsMedicalStore> {
    const worker = new Worker(new URL('./opfs-pack.worker.ts', import.meta.url), {
      type: 'module',
    });
    const store = new WorkerOpfsMedicalStore(worker, shared);
    const opened = store.request('open', options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        opened,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Opening ${options.databaseName} timed out.`)),
            options.fetchTimeoutMs,
          );
        }),
      ]);
      return store;
    } catch (cause) {
      store.shutdown(cause instanceof Error ? cause : new Error('OPFS pack worker failed.'));
      void opened.catch(() => undefined);
      throw cause;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public initialize(seed?: ContentPackSeed): Promise<StorageHealth> {
    return this.call('initialize', seed === undefined ? [] : [seed]);
  }

  public getHealth(): Promise<StorageHealth> {
    return this.call('getHealth', []);
  }

  public inspectIntegrity(): Promise<SqliteIntegrityReport> {
    return this.owner.request('call', 'inspectIntegrity', []) as Promise<SqliteIntegrityReport>;
  }

  public listDocumentIdentities(): Promise<readonly DocumentIdentity[]> {
    return this.call('listDocumentIdentities', []);
  }

  public listSearchDocuments(): Promise<readonly SearchDocumentDescriptor[]> {
    return this.call('listSearchDocuments', []);
  }

  public listDocuments(): Promise<readonly DocumentRecord[]> {
    return this.call('listDocuments', []);
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
    return this.call('listAliases', []);
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

  public async close(): Promise<void> {
    if (this.leaseClosed) return;
    this.leaseClosed = true;
    await this.owner.release();
  }

  private async release(): Promise<void> {
    this.leaseCount -= 1;
    if (this.leaseCount > 0 || this.connectionClosed) return;
    this.closing = this.call('close', []).finally(() => {
      this.shutdown(new Error('OPFS pack worker closed.'));
    });
    await this.closing;
  }

  private request(type: 'open', options: OpfsPackWorkerOpenOptions): Promise<StorageHealth>;
  private request<M extends OpfsPackWorkerMethod>(
    type: 'call',
    method: M,
    args: OpfsPackWorkerCallArgs[M],
  ): Promise<unknown>;
  private request(
    type: 'open' | 'call',
    methodOrOptions: OpfsPackWorkerMethod | OpfsPackWorkerOpenOptions,
    args: readonly unknown[] = [],
  ): Promise<unknown> {
    if (this.connectionClosed) return Promise.reject(new Error('OPFS pack worker is closed.'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (type === 'open') {
        this.worker.postMessage({
          id,
          type: 'open',
          ...(methodOrOptions as OpfsPackWorkerOpenOptions),
        });
        return;
      }
      this.worker.postMessage({
        id,
        type: 'call',
        method: methodOrOptions as OpfsPackWorkerMethod,
        args,
      });
    });
  }

  private call<M extends Exclude<OpfsPackWorkerMethod, 'inspectIntegrity'>>(
    method: M,
    args: OpfsPackWorkerCallArgs[M],
  ): Promise<Awaited<ReturnType<NonNullable<MedicalStore[Extract<M, keyof MedicalStore>]>>>> {
    return this.owner.request('call', method, args) as Promise<
      Awaited<ReturnType<NonNullable<MedicalStore[Extract<M, keyof MedicalStore>]>>>
    >;
  }

  private shutdown(error: Error): void {
    if (!this.connectionClosed) {
      this.connectionClosed = true;
      this.worker.terminate();
    }
    if (
      this.shared &&
      WorkerOpfsMedicalStore.sharedStores.get(this.shared.poolName) === this.shared
    ) {
      WorkerOpfsMedicalStore.sharedStores.delete(this.shared.poolName);
    }
    this.failPending(error);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
