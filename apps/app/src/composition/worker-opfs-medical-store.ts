import type {
  ContentPackSeed,
  CoreIdentityHit,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  EmbeddingProfile,
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
  VectorSearchRequest,
} from '@localmed/storage';
import type { SqliteIntegrityReport } from '@localmed/storage-sqlite';

import type {
  OpfsPackWorkerCallArgs,
  OpfsPackWorkerLockStatus,
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

export interface OpfsDownloadUi {
  requestDownload(): Promise<void>;
  onProgress(progress: { loaded: number; total: number; phase?: 'installing' }): void;
}

export class WorkerOpfsMedicalStore implements MedicalStore {
  private onDownloadWait: (waiting: boolean) => void = () => {};
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
    private readonly downloadUi?: OpfsDownloadUi,
    onLockStatus?: (status: OpfsPackWorkerLockStatus) => void,
  ) {
    this.owner = owner ?? this;
    if (owner) return;
    worker.onmessage = (event: MessageEvent<OpfsPackWorkerResponse>) => {
      if ('status' in event.data) {
        if (!this.connectionClosed) onLockStatus?.(event.data.status);
        return;
      }
      if ('event' in event.data) {
        const message = event.data;
        if (this.connectionClosed) return;
        if (message.event === 'download-progress') {
          this.downloadUi?.onProgress({
            loaded: message.loaded,
            total: message.total,
            ...(message.phase ? { phase: message.phase } : {}),
          });
        } else {
          this.onDownloadWait(true);
          if (!this.downloadUi) {
            this.shutdown(new Error('Unexpected core download request.'));
            return;
          }
          void this.downloadUi.requestDownload().then(
            () => {
              if (this.connectionClosed) return;
              this.onDownloadWait(false);
              this.worker.postMessage({ type: 'approve-download', id: message.id });
            },
            (cause: unknown) =>
              this.shutdown(
                cause instanceof Error ? cause : new Error('Core download was not approved.'),
              ),
          );
        }
        return;
      }
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if ('error' in event.data) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    };
    worker.onerror = () => this.shutdown(new Error('OPFS pack worker failed.'));
  }

  public static async open(
    options: OpfsPackWorkerOpenOptions,
    downloadUi?: OpfsDownloadUi,
    onWaitingForOtherTab?: (waiting: boolean) => void,
  ): Promise<WorkerOpfsMedicalStore> {
    const optionsKey = JSON.stringify([options.databaseName, options.fetchTimeoutMs]);
    const existing = WorkerOpfsMedicalStore.sharedStores.get(options.poolName);
    if (existing) {
      if (existing.optionsKey !== optionsKey) {
        throw new Error(`SAH pool ${options.poolName} is already open for another database.`);
      }
      const owner = await existing.owner;
      if (owner.closing) {
        await owner.closing;
        return WorkerOpfsMedicalStore.open(options, downloadUi, onWaitingForOtherTab);
      }
      if (owner.connectionClosed) {
        WorkerOpfsMedicalStore.sharedStores.delete(options.poolName);
        return WorkerOpfsMedicalStore.open(options, downloadUi, onWaitingForOtherTab);
      }
      owner.leaseCount += 1;
      return new WorkerOpfsMedicalStore(owner.worker, existing, owner);
    }

    const shared = { optionsKey, poolName: options.poolName } as SharedWorkerStore;
    shared.owner = WorkerOpfsMedicalStore.openOwner(
      options,
      shared,
      downloadUi,
      onWaitingForOtherTab,
    );
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
    downloadUi?: OpfsDownloadUi,
    onWaitingForOtherTab?: (waiting: boolean) => void,
  ): Promise<WorkerOpfsMedicalStore> {
    const worker = new Worker(new URL('./opfs-pack.worker.ts', import.meta.url), {
      type: 'module',
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectTimeout: (error: Error) => void = () => undefined;
    const timedOut = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    let lockAcquired = false;
    let awaitingApproval = false;
    const armTimeout = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!lockAcquired || awaitingApproval) return;
      timer = setTimeout(
        () => rejectTimeout(new Error(`Opening ${options.databaseName} timed out.`)),
        options.fetchTimeoutMs,
      );
    };
    // Neither another tab's pool lock nor the user's download consent is an I/O failure: the
    // timeout covers only the download/open while this worker owns the pool and may proceed.
    const store = new WorkerOpfsMedicalStore(worker, shared, undefined, downloadUi, (status) => {
      const waiting = status === 'lock-wait';
      onWaitingForOtherTab?.(waiting);
      if (waiting) return;
      lockAcquired = true;
      armTimeout();
    });
    store.onDownloadWait = (waiting) => {
      awaitingApproval = waiting;
      armTimeout();
    };
    const opened = store.request('open', {
      ...options,
      ...(downloadUi ? { waitForDownloadApproval: true } : {}),
    });
    try {
      await Promise.race([opened, timedOut]);
      return store;
    } catch (cause) {
      store.shutdown(cause instanceof Error ? cause : new Error('OPFS pack worker failed.'));
      void opened.catch(() => undefined);
      throw cause;
    } finally {
      store.onDownloadWait = () => {};
      if (timer) clearTimeout(timer);
    }
  }

  public reference(request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> {
    if (this.leaseClosed) return Promise.reject(new Error('Reference lease is closed.'));
    return this.call('reference', [request]);
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

  public lookupCoreIdentities(query: string): Promise<readonly CoreIdentityHit[]> {
    return this.call('lookupCoreIdentities', [query]);
  }

  public listSearchDocuments(): Promise<readonly SearchDocumentDescriptor[]> {
    return this.call('listSearchDocuments', []);
  }

  public listDocuments(): Promise<readonly DocumentRecord[]> {
    return this.call('listDocuments', []);
  }

  public listNavigationDocuments(): Promise<readonly DocumentRecord[]> {
    return this.call('listNavigationDocuments', []);
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
