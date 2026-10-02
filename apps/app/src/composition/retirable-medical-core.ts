import type {
  AnalyzeQueryRequest,
  AskRequest,
  AskResponse,
  ChunkContext,
  CoreCapabilities,
  CoreStatus,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  InstallContentPackRequest,
  InstallContentPackResponse,
  LocalMedError,
  MedicalCore,
  MedicalDocument,
  MedicalDocumentSummary,
  MedicalSection,
  QueryAnalysis,
  Result,
  SearchDocumentDescriptor,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '@localmed/contracts';
import { ok } from '@localmed/contracts';

/** Upper bound for waiting on requests that still run on a core which has been replaced. */
const DEFAULT_DRAIN_TIMEOUT_MS = 20_000;

/**
 * A MedicalCore that can be replaced under its callers.
 *
 * Installing a module builds a new core and closes the previous one. Readers, lists and the search
 * workspace hold the core they were given, so a call that began (or only started) around the swap
 * reached a store that had just been closed («DB has been closed»). The retired core therefore:
 *  - forwards every new call to its successor once {@link handOverTo} has named it;
 *  - tracks the calls still running on the wrapped core and closes it only after they settled
 *    (bounded by the drain timeout), never while a request is using its stores.
 */
export class RetirableMedicalCore implements MedicalCore {
  private readonly running = new Set<Promise<unknown>>();
  private successor: MedicalCore | undefined;
  private closing: Promise<void> | undefined;

  public constructor(
    private readonly inner: MedicalCore,
    private readonly drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  ) {}

  /** Routes this core's later calls to `next`; the wrapped core stays open until it drains. */
  public handOverTo(next: MedicalCore): void {
    if (next === this) throw new Error('A medical core cannot succeed itself.');
    this.successor = next;
  }

  private route<T>(call: (core: MedicalCore) => Promise<T>): Promise<T> {
    if (this.successor) return call(this.successor);
    const pending = call(this.inner);
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );
    this.running.add(settled);
    void settled.then(() => this.running.delete(settled));
    return pending;
  }

  public reference(
    request: DefinitionReferenceRequest,
  ): Promise<Result<DefinitionReferenceReply, LocalMedError>> {
    return this.route((core) =>
      core.reference ? core.reference(request) : Promise.resolve(ok({ op: 'unavailable' })),
    );
  }

  public initialize(): Promise<Result<CoreStatus, LocalMedError>> {
    return this.route((core) => core.initialize());
  }

  public getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>> {
    return this.route((core) => core.getCapabilities());
  }

  public listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>> {
    return this.route((core) => core.listDocuments());
  }

  public listNavigationDocuments(): Promise<
    Result<readonly MedicalDocumentSummary[], LocalMedError>
  > {
    return this.route((core) =>
      core.listNavigationDocuments ? core.listNavigationDocuments() : core.listDocuments(),
    );
  }

  public listSearchDocuments(): Promise<
    Result<readonly SearchDocumentDescriptor[], LocalMedError>
  > {
    return this.route((core) =>
      core.listSearchDocuments ? core.listSearchDocuments() : core.listDocuments(),
    );
  }

  public analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>> {
    return this.route((core) => core.analyzeQuery(request));
  }

  public search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>> {
    return this.route((core) => core.search(request));
  }

  public getDocument(documentId: string): Promise<Result<MedicalDocument, LocalMedError>> {
    return this.route((core) => core.getDocument(documentId));
  }

  public getSection(sectionId: string): Promise<Result<MedicalSection, LocalMedError>> {
    return this.route((core) => core.getSection(sectionId));
  }

  public getContext(
    chunkId: string,
    radius?: number,
  ): Promise<Result<ChunkContext, LocalMedError>> {
    return this.route((core) => core.getContext(chunkId, radius));
  }

  public getSearchResultContext(
    result: Pick<
      SearchResult,
      'chunkId' | 'documentId' | 'sectionId' | 'anchor' | 'title' | 'sectionPath' | 'sectionType'
    >,
    radius?: number,
  ): Promise<Result<ChunkContext, LocalMedError>> {
    return this.route((core) => core.getSearchResultContext(result, radius));
  }

  public ask(request: AskRequest): Promise<Result<AskResponse, LocalMedError>> {
    return this.route((core) => core.ask(request));
  }

  public installContentPack(
    request: InstallContentPackRequest,
  ): Promise<Result<InstallContentPackResponse, LocalMedError>> {
    return this.route((core) => core.installContentPack(request));
  }

  /** Waits for running requests, then closes the wrapped core once. */
  public close(): Promise<void> {
    this.closing ??= this.drainThenClose();
    return this.closing;
  }

  private async drainThenClose(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), this.drainTimeoutMs);
    });
    try {
      while (this.running.size > 0) {
        const outcome = await Promise.race([Promise.all([...this.running]), expired]);
        if (outcome === 'expired') {
          console.warn(
            `Closing a replaced MedicalCore with ${this.running.size} request(s) still running.`,
          );
          break;
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
    await this.inner.close();
  }
}
