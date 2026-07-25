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

export type SearchScope = 'diagnosis' | 'guidelines' | 'medications' | 'legal' | 'all';

const EMPTY_SCOPE_DOCUMENT_ID = '__minimed_empty_search_scope__';

const SOURCE_TYPES_BY_SCOPE: Readonly<Partial<Record<SearchScope, ReadonlySet<string>>>> = {
  guidelines: new Set(['clinical_recommendation', 'clinical_recommendation_summary']),
  medications: new Set(['official_drug_instruction', 'official_registry_summary']),
  legal: new Set(['regulatory_act']),
};

export function documentMatchesSearchScope(
  document: Pick<MedicalDocumentSummary, 'sourceType'>,
  scope: SearchScope,
): boolean {
  const sourceTypes = SOURCE_TYPES_BY_SCOPE[scope];
  return sourceTypes ? sourceTypes.has(document.sourceType) : true;
}

function intersectDocumentIds(
  available: readonly string[],
  requested: readonly string[] | undefined,
): readonly string[] {
  if (!requested?.length) return available;
  const allowed = new Set(available);
  return requested.filter((documentId) => allowed.has(documentId));
}

/**
 * A UI-level core view that keeps the public MedicalCore contract intact while constraining
 * retrieval to the source family explicitly chosen by the clinician.
 *
 * Diagnosis is the only scope allowed to use the optional grounded local-model wrapper. All other
 * scopes call the deterministic base core directly.
 */
export class ScopedMedicalCore implements MedicalCore {
  public constructor(
    private readonly base: MedicalCore,
    private readonly assistant: MedicalCore | undefined,
    private readonly scope: SearchScope,
  ) {}

  private target(): MedicalCore {
    return this.scope === 'diagnosis' && this.assistant ? this.assistant : this.base;
  }

  public initialize(): Promise<Result<CoreStatus, LocalMedError>> {
    return this.base.initialize();
  }

  public getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>> {
    return this.target().getCapabilities();
  }

  public listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>> {
    return this.base.listDocuments();
  }

  public analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>> {
    return this.target().analyzeQuery(request);
  }

  public async search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>> {
    const sourceTypes = SOURCE_TYPES_BY_SCOPE[this.scope];
    if (!sourceTypes) return this.target().search(request);

    const documents = await this.base.listDocuments();
    if (!documents.ok) return { ok: false, error: documents.error };

    const availableDocumentIds = documents.value
      .filter((document) => sourceTypes.has(document.sourceType))
      .map((document) => document.id);
    const selectedDocumentIds = intersectDocumentIds(
      availableDocumentIds,
      request.filters.documentIds,
    );

    return this.base.search({
      ...request,
      filters: {
        ...request.filters,
        // An empty documentIds array means “no filter” in storage adapters, so use an impossible
        // sentinel when the requested source family is not installed.
        documentIds:
          selectedDocumentIds.length > 0 ? selectedDocumentIds : [EMPTY_SCOPE_DOCUMENT_ID],
      },
    });
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
    return this.target().ask(request);
  }

  public installContentPack(
    request: InstallContentPackRequest,
  ): Promise<Result<InstallContentPackResponse, LocalMedError>> {
    return this.base.installContentPack(request);
  }

  public async close(): Promise<void> {
    // The application owns the underlying cores. A short-lived scoped view must not close them.
  }
}
