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
  QueryIntent,
  Result,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '@localmed/contracts';
import { lightStemRussian, normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

export type SearchScope = 'diagnosis' | 'guidelines' | 'medications' | 'legal' | 'all';

const EMPTY_SCOPE_DOCUMENT_ID = '__minimed_empty_search_scope__';

const SOURCE_TYPES_BY_SCOPE: Readonly<Partial<Record<SearchScope, ReadonlySet<string>>>> = {
  guidelines: new Set(['clinical_recommendation', 'clinical_recommendation_summary']),
  medications: new Set([
    'allmed_reference',
    'official_drug_instruction',
    'official_registry_summary',
  ]),
  legal: new Set(['regulatory_act', 'regulatory_act_summary']),
};

export function documentMatchesSearchScope(
  document: Pick<MedicalDocumentSummary, 'sourceType'>,
  scope: SearchScope,
): boolean {
  const sourceTypes = SOURCE_TYPES_BY_SCOPE[scope];
  return sourceTypes ? sourceTypes.has(document.sourceType) : true;
}

export function inferSearchScope(intent: QueryIntent | undefined): SearchScope | undefined {
  if (
    !intent ||
    intent.confidence < 0.55 ||
    intent.primary === 'unknown' ||
    intent.primary === 'mixed'
  ) {
    return undefined;
  }
  if (intent.primary === 'medication') return 'medications';
  if (intent.primary === 'administrative-reference') return 'legal';
  if (intent.primary === 'diagnosis') return 'diagnosis';
  return 'guidelines';
}

function intersectDocumentIds(
  available: readonly string[],
  requested: readonly string[] | undefined,
): readonly string[] {
  if (!requested?.length) return available;
  const allowed = new Set(available);
  return requested.filter((documentId) => allowed.has(documentId));
}

function keepExplicitMedicationMatches(response: SearchResponse): SearchResponse {
  const medicationTerms = new Set(
    response.analysis.facts
      .filter((fact) => fact.kind === 'medication' && fact.polarity !== 'negative')
      .flatMap((fact) =>
        tokenize(fact.normalizedValue).flatMap((term) => [term, lightStemRussian(term)]),
      ),
  );
  if (medicationTerms.size === 0) return response;

  return {
    ...response,
    groups: response.groups.filter((group) => {
      const title = normalizeSurfaceText(group.title);
      return (
        [...medicationTerms].some((term) => title.includes(term)) ||
        group.results.some((result) =>
          result.matchedTerms.some((term) =>
            medicationTerms.has(lightStemRussian(normalizeSurfaceText(term))),
          ),
        )
      );
    }),
  };
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
    private readonly includedDocumentIds?: ReadonlySet<string>,
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
      .filter(
        (document) =>
          sourceTypes.has(document.sourceType) &&
          (!this.includedDocumentIds || this.includedDocumentIds.has(document.id)),
      )
      .map((document) => document.id);
    const selectedDocumentIds = intersectDocumentIds(
      availableDocumentIds,
      request.filters.documentIds,
    );

    const result = await this.base.search({
      ...request,
      filters: {
        ...request.filters,
        // An empty documentIds array means “no filter” in storage adapters, so use an impossible
        // sentinel when the requested source family is not installed.
        documentIds:
          selectedDocumentIds.length > 0 ? [...selectedDocumentIds] : [EMPTY_SCOPE_DOCUMENT_ID],
      },
    });
    return result.ok && this.scope === 'medications'
      ? { ok: true, value: keepExplicitMedicationMatches(result.value) }
      : result;
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
