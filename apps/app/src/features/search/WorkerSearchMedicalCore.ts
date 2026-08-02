import type {
  AnalyzeQueryRequest,
  AskRequest,
  AskResponse,
  ChunkContext,
  CoreCapabilities,
  CoreStatus,
  InstallContentPackRequest,
  InstallContentPackResponse,
  LocalMedError,
  MedicalCore,
  MedicalDocument,
  MedicalDocumentSummary,
  MedicalSection,
  QueryAnalysis,
  Result,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '@localmed/contracts';

import { peekContentModuleRuntime } from '@/features/modules/module-runtime-service';
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
  SearchWorkerResult,
} from '@/features/search/search-worker-protocol';

export class WorkerSearchMedicalCore implements MedicalCore {
  private worker =
    typeof Worker === 'undefined'
      ? undefined
      : new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (result: SearchWorkerResult) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  private requestId = 0;
  private workerEligibility: Promise<boolean> | undefined;

  public constructor(private readonly base: MedicalCore) {
    // Downloaded modules are mounted into the freshly composed application core. Keep that exact
    // composition on the direct path instead of asking an independently booted Worker to rediscover
    // IndexedDB state during a live install/remove transition. Recreating this wrapper after the last
    // downloaded module is removed enables background search again.
    if ((peekContentModuleRuntime()?.listInstalled().length ?? 0) > 0) {
      this.disableWorker();
      return;
    }
    if (!this.worker) return;
    this.worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if ('error' in event.data) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    };
    this.worker.onerror = () => this.disableWorker();
  }

  private disableWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Фоновый поиск недоступен.'));
    }
    this.pending.clear();
  }

  private async canUseWorker(): Promise<boolean> {
    if (!this.worker) return false;
    this.workerEligibility ??= this.base
      .getCapabilities()
      .then((result) => {
        const enabled = result.ok && result.value.searchExecution !== 'direct-only';
        if (!enabled) this.disableWorker();
        return enabled;
      })
      .catch(() => {
        this.disableWorker();
        return false;
      });
    return this.workerEligibility;
  }

  private request(
    message:
      | { readonly method: 'analyzeQuery'; readonly request: AnalyzeQueryRequest }
      | { readonly method: 'search'; readonly request: SearchRequest },
  ): Promise<SearchWorkerResult> {
    if (!this.worker) return Promise.reject(new Error('Web Worker недоступен.'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({
        ...message,
        id,
        contentBaseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
      } satisfies SearchWorkerRequest);
    });
  }

  public initialize(): Promise<Result<CoreStatus, LocalMedError>> {
    return this.base.initialize();
  }

  public getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>> {
    return this.base.getCapabilities();
  }

  public listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>> {
    return this.base.listDocuments();
  }

  public async analyzeQuery(
    request: AnalyzeQueryRequest,
  ): Promise<Result<QueryAnalysis, LocalMedError>> {
    if (!(await this.canUseWorker())) return this.base.analyzeQuery(request);
    try {
      return (await this.request({ method: 'analyzeQuery', request })) as Result<
        QueryAnalysis,
        LocalMedError
      >;
    } catch {
      return this.base.analyzeQuery(request);
    }
  }

  public async search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>> {
    if (!(await this.canUseWorker())) return this.base.search(request);
    try {
      return (await this.request({ method: 'search', request })) as Result<
        SearchResponse,
        LocalMedError
      >;
    } catch {
      return this.base.search(request);
    }
  }

  public getDocument(documentId: string): Promise<Result<MedicalDocument, LocalMedError>> {
    return this.base.getDocument(documentId);
  }

  public getSection(sectionId: string): Promise<Result<MedicalSection, LocalMedError>> {
    return this.base.getSection(sectionId);
  }

  public getContext(
    chunkId: string,
    radius?: number,
  ): Promise<Result<ChunkContext, LocalMedError>> {
    return this.base.getContext(chunkId, radius);
  }

  public getSearchResultContext(
    result: Pick<
      SearchResult,
      'chunkId' | 'documentId' | 'sectionId' | 'anchor' | 'title' | 'sectionPath' | 'sectionType'
    >,
    radius?: number,
  ): Promise<Result<ChunkContext, LocalMedError>> {
    return this.base.getSearchResultContext(result, radius);
  }

  public ask(request: AskRequest): Promise<Result<AskResponse, LocalMedError>> {
    return this.base.ask(request);
  }

  public installContentPack(
    request: InstallContentPackRequest,
  ): Promise<Result<InstallContentPackResponse, LocalMedError>> {
    return this.base.installContentPack(request);
  }

  public async close(): Promise<void> {
    this.disableWorker();
  }
}
