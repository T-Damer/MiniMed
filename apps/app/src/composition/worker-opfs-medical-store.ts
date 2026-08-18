import type { ContentPackSeed, EmbeddingProfile } from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';
import type {
  LexicalHit,
  LexicalSearchRequest,
  MedicalStore,
  StorageHealth,
  VectorHit,
  VectorSearchRequest,
} from '@localmed/storage';

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

export class WorkerOpfsMedicalStore implements MedicalStore {
  private requestId = 0;
  private readonly pending = new Map<number, PendingCall>();
  private closed = false;

  private constructor(private readonly worker: Worker) {
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
    const worker = new Worker(new URL('./opfs-pack.worker.ts', import.meta.url), {
      type: 'module',
    });
    const store = new WorkerOpfsMedicalStore(worker);
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
    if (this.closed) return;
    try {
      await this.call('close', []);
    } finally {
      this.shutdown(new Error('OPFS pack worker closed.'));
    }
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
    if (this.closed) return Promise.reject(new Error('OPFS pack worker is closed.'));
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

  private call<M extends OpfsPackWorkerMethod>(
    method: M,
    args: OpfsPackWorkerCallArgs[M],
  ): Promise<Awaited<ReturnType<MedicalStore[M]>>> {
    return this.request('call', method, args) as Promise<Awaited<ReturnType<MedicalStore[M]>>>;
  }

  private shutdown(error: Error): void {
    if (!this.closed) {
      this.closed = true;
      this.worker.terminate();
    }
    this.failPending(error);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
