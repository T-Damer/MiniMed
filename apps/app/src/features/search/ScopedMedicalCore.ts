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
  QueryFact,
  QueryIntent,
  Result,
  SearchDocumentDescriptor,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SearchResultGroup,
} from '@localmed/contracts';
import { lightStemRussian, normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

export type SearchScope = 'diagnosis' | 'guidelines' | 'medications' | 'legal' | 'all' | 'personal';
export type SearchAudience = 'children' | 'adults';
export type SearchResultDocumentKind = NonNullable<SearchResultGroup['documentKind']>;

const EMPTY_SCOPE_DOCUMENT_ID = '__minimed_empty_search_scope__';

const SOURCE_TYPES_BY_SCOPE: Readonly<Partial<Record<SearchScope, ReadonlySet<string>>>> = {
  guidelines: new Set([
    'clinical_recommendation',
    'clinical_recommendation_summary',
    'medical_reference',
    'rls_mkb_reference',
  ]),
  medications: new Set([
    'allmed_reference',
    'official_drug_instruction',
    'official_registry_summary',
    'rls_mkb_reference',
  ]),
  legal: new Set(['regulatory_act', 'regulatory_act_summary']),
  personal: new Set<string>(),
};

export function documentMatchesSearchScope(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata'>,
  scope: SearchScope,
): boolean {
  if (scope === 'personal') return false;
  if (document.sourceType === 'core_catalog_pointer') {
    if (scope === 'all' || scope === 'diagnosis') return true;
    const metadata = document.metadata as SearchDocumentKindMetadata | undefined;
    if (metadata?.catalogFamily === 'medication') return scope === 'medications';
    if (metadata?.catalogFamily === 'clinical') return scope === 'guidelines';
    if (metadata?.catalogFamily === 'legal') return scope === 'legal';
    return false;
  }
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

export function inferRequestedAudience(query: string): SearchAudience | undefined {
  const normalized = normalizeSurfaceText(query);
  if (/(?:^|\s)\d{1,2}\s*(?:месяц|месяца|месяцев|мес)(?=\s|$|[,.])/u.test(normalized)) {
    return 'children';
  }

  const years = normalized.match(/(?:^|\s)(\d{1,3})\s*(?:год|года|лет)(?=\s|$|[,.])/u);
  if (years?.[1]) return Number(years[1]) < 18 ? 'children' : 'adults';

  const childSignal =
    /(?:ребен|ребён|детск|дет(?:и|ей|ям|ьми|ях)|младен|груднич|новорож|несовершеннолет|подрост|школьник|мальчик|девочк|педиатр)/u.test(
      normalized,
    );
  const adultSignal = /(?:взросл|совершеннолет|мужчин|женщин|терапевт)/u.test(normalized);
  if (childSignal === adultSignal) return undefined;
  return childSignal ? 'children' : 'adults';
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

const INTERCHANGEABLE_LIQUID_FORM_STEMS = new Set(
  ['суспензия', 'сироп', 'спироп'].flatMap((value) =>
    tokenize(normalizeSurfaceText(value)).map((term) => lightStemRussian(term)),
  ),
);

function stemmedTokens(value: string): readonly string[] {
  return (normalizeSurfaceText(value).match(/[\p{L}\p{N}]+/gu) ?? []).map((term) =>
    lightStemRussian(term),
  );
}

function containsStemmedValue(textStems: ReadonlySet<string>, value: string): boolean {
  const requiredStems = stemmedTokens(value);
  return requiredStems.length > 0 && requiredStems.every((stem) => textStems.has(stem));
}

function containsStructuredMedicationFact(
  textStems: ReadonlySet<string>,
  fact: QueryFact<'dose-form' | 'route' | 'strength'>,
): boolean {
  const requiredStems = stemmedTokens(fact.normalizedValue);
  if (
    fact.kind === 'dose-form' &&
    requiredStems.some((stem) => INTERCHANGEABLE_LIQUID_FORM_STEMS.has(stem))
  ) {
    return [...INTERCHANGEABLE_LIQUID_FORM_STEMS].some((stem) => textStems.has(stem));
  }
  return requiredStems.length > 0 && requiredStems.every((stem) => textStems.has(stem));
}

function medicationContextMatchScore(
  result: SearchResult,
  groupTitle: string,
  isMedicationPointer: boolean,
  medicationFacts: readonly QueryFact<'medication'>[],
  structuredFacts: readonly QueryFact<'dose-form' | 'route' | 'strength'>[],
): number {
  const text = medicationResultText(result, isMedicationPointer ? undefined : groupTitle);
  const textStems = new Set(stemmedTokens(text));
  if (
    !medicationFacts.some((fact) => containsStemmedValue(textStems, fact.value)) ||
    !structuredFacts.every((fact) => containsStructuredMedicationFact(textStems, fact))
  ) {
    return 0;
  }

  const normalizedText = normalizeSurfaceText(text);
  const normalizedSectionPath = normalizeSurfaceText(result.sectionPath.join(' '));
  const exactFactMatches = structuredFacts.reduce(
    (matches, fact) =>
      matches + Number(normalizedText.includes(normalizeSurfaceText(fact.normalizedValue))),
    0,
  );
  const exactSectionMatches = structuredFacts.reduce(
    (matches, fact) =>
      matches + Number(normalizedSectionPath.includes(normalizeSurfaceText(fact.normalizedValue))),
    0,
  );
  return 1 + exactFactMatches + exactSectionMatches * 2;
}

function medicationResultText(result: SearchResult, groupTitle?: string): string {
  return [groupTitle, result.snippet, result.title, ...result.sectionPath, ...result.matchedTerms]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

function isMedicationSearchDocument(document: SearchDocumentDescriptor): boolean {
  if (searchResultDocumentKind(document) === 'medication') return true;
  if (document.sourceType !== 'rls_mkb_reference') return false;
  const metadata = document.metadata as SearchDocumentKindMetadata | undefined;
  return metadata?.catalogFamily === 'medication' || metadata?.entityType === 'medication';
}

function filterMedicationDocuments(
  response: SearchResponse,
  documents: readonly SearchDocumentDescriptor[],
  scope: SearchScope,
): SearchResponse {
  const positiveMedicationFacts = response.analysis.facts.filter(
    (fact): fact is QueryFact<'medication'> =>
      fact.kind === 'medication' && fact.polarity === 'positive',
  );
  const clinicalContext = response.analysis.clinicalContext;
  const structuredFacts: readonly QueryFact<'dose-form' | 'route' | 'strength'>[] = [
    ...(clinicalContext?.doseForm ?? []),
    ...(clinicalContext?.route ?? []),
    ...(clinicalContext?.strength ?? []),
  ].filter((fact) => fact.polarity === 'positive');
  const primaryIntent = response.analysis.intent?.primary;
  const excludeByIntent =
    scope !== 'medications' &&
    positiveMedicationFacts.length === 0 &&
    primaryIntent !== 'medication' &&
    primaryIntent !== 'mixed';
  const requireSameResult = positiveMedicationFacts.length > 0 && structuredFacts.length > 0;
  if (!excludeByIntent && !requireSameResult) return response;

  const documentsById = new Map(documents.map((document) => [document.id, document]));
  return {
    ...response,
    groups: response.groups.flatMap((group) => {
      const document = documentsById.get(group.documentId);
      const metadata = document?.metadata as SearchDocumentKindMetadata | undefined;
      if (!document || !isMedicationSearchDocument(document)) return [group];
      if (excludeByIntent) return [];
      if (!requireSameResult) return [group];
      const isMedicationPointer =
        document.sourceType === 'core_catalog_pointer' && metadata?.catalogFamily === 'medication';
      const rankedResults = group.results
        .map((result) => ({
          result,
          matchScore: medicationContextMatchScore(
            result,
            group.title,
            isMedicationPointer,
            positiveMedicationFacts,
            structuredFacts,
          ),
        }))
        .filter((entry) => entry.matchScore > 0)
        .toSorted(
          (left, right) =>
            right.matchScore - left.matchScore || right.result.finalScore - left.result.finalScore,
        )
        .map((entry) => entry.result);
      const firstResult = rankedResults[0];
      return firstResult
        ? [{ ...group, bestScore: firstResult.finalScore, results: rankedResults }]
        : [];
    }),
  };
}

function audiencePriority(ageGroups: readonly string[], audience: SearchAudience): number {
  const supportsChildren = ageGroups.some(
    (ageGroup) => ageGroup === 'children' || ageGroup === 'adolescents',
  );
  const supportsAdults = ageGroups.includes('adults');
  if (!supportsChildren && !supportsAdults) return 1;
  if (audience === 'children') return supportsChildren ? 2 : 0;
  return supportsAdults ? 2 : 0;
}

function audienceLabel(ageGroups: readonly string[]): string | undefined {
  const supportsChildren = ageGroups.some(
    (ageGroup) => ageGroup === 'children' || ageGroup === 'adolescents',
  );
  const supportsAdults = ageGroups.includes('adults');
  if (supportsChildren && supportsAdults) return 'Для детей и взрослых';
  if (supportsChildren) return 'Для детей';
  if (supportsAdults) return 'Для взрослых';
  return undefined;
}

interface SearchDocumentKindMetadata {
  readonly interactiveAssessmentId?: unknown;
  readonly calculationRequired?: unknown;
  readonly interactiveCalculatorId?: unknown;
  readonly catalogFamily?: unknown;
  readonly entityType?: unknown;
}

export function searchResultDocumentKind(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata'>,
): SearchResultDocumentKind {
  const metadata = document.metadata as SearchDocumentKindMetadata | undefined;
  if (typeof metadata?.interactiveAssessmentId === 'string') return 'assessment';
  if (
    metadata?.calculationRequired === true ||
    typeof metadata?.interactiveCalculatorId === 'string'
  ) {
    return 'calculator';
  }
  if (document.sourceType === 'core_catalog_pointer') {
    if (metadata?.catalogFamily === 'medication') return 'medication';
    if (metadata?.catalogFamily === 'legal') return 'legal';
    if (metadata?.catalogFamily === 'clinical' && metadata.entityType === 'disease') {
      return 'clinical-recommendation';
    }
    return 'reference';
  }
  if (
    ['allmed_reference', 'official_drug_instruction', 'official_registry_summary'].includes(
      document.sourceType,
    )
  ) {
    return 'medication';
  }
  if (document.sourceType.startsWith('clinical_recommendation')) {
    return 'clinical-recommendation';
  }
  if (document.sourceType.startsWith('regulatory_act')) return 'legal';
  return 'reference';
}

export function rankSearchGroupsByAudience(
  groups: readonly SearchResultGroup[],
  documents: readonly SearchDocumentDescriptor[],
  audience: SearchAudience | undefined,
): readonly SearchResultGroup[] {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const annotated = groups.map((group) => {
    const document = documentsById.get(group.documentId);
    const ageGroups = document?.ageGroups ?? group.ageGroups ?? [];
    const label = audienceLabel(ageGroups);
    return {
      ...group,
      ageGroups,
      ...(document ? { documentKind: searchResultDocumentKind(document) } : {}),
      title: label && !group.title.startsWith('Для ') ? `${label} · ${group.title}` : group.title,
    };
  });
  if (!audience) return annotated;

  return annotated
    .map((group, index) => ({ group, index }))
    .toSorted((left, right) => {
      const priorityDifference =
        audiencePriority(right.group.ageGroups ?? [], audience) -
        audiencePriority(left.group.ageGroups ?? [], audience);
      return priorityDifference || left.index - right.index;
    })
    .map((entry) => entry.group);
}

function diagnosisSourcePriority(kind: SearchResultDocumentKind | undefined): number {
  if (kind === 'clinical-recommendation') return 0;
  if (kind === 'reference') return 1;
  return 2;
}

export function rankDiagnosisGroups(
  groups: readonly SearchResultGroup[],
): readonly SearchResultGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .toSorted(
      (left, right) =>
        diagnosisSourcePriority(left.group.documentKind) -
          diagnosisSourcePriority(right.group.documentKind) || left.index - right.index,
    )
    .map((entry) => entry.group);
}

/**
 * A UI-level core view that keeps the public MedicalCore contract intact while constraining
 * retrieval to the source family explicitly chosen by the clinician.
 *
 * Every scope uses the deterministic base core. Optional cloud generation is outside this contract
 * and receives documents only after an explicit user action.
 */
export class ScopedMedicalCore implements MedicalCore {
  public constructor(
    private readonly base: MedicalCore,
    private readonly scope: SearchScope,
    private readonly includedDocumentIds?: ReadonlySet<string>,
  ) {}

  public initialize(): Promise<Result<CoreStatus, LocalMedError>> {
    return this.base.initialize();
  }

  public getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>> {
    return this.base.getCapabilities();
  }

  public listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>> {
    return this.base.listDocuments();
  }

  public listSearchDocuments(): Promise<
    Result<readonly SearchDocumentDescriptor[], LocalMedError>
  > {
    return this.base.listSearchDocuments
      ? this.base.listSearchDocuments()
      : this.base.listDocuments();
  }

  public analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>> {
    return this.base.analyzeQuery(request);
  }

  public async search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>> {
    const documents = await this.listSearchDocuments();
    if (!documents.ok) return { ok: false, error: documents.error };

    const sourceTypes = SOURCE_TYPES_BY_SCOPE[this.scope];
    let result: Result<SearchResponse, LocalMedError>;
    if (!sourceTypes) {
      result = await this.base.search(request);
    } else {
      const availableDocumentIds = documents.value
        .filter(
          (document) =>
            documentMatchesSearchScope(document, this.scope) &&
            (!this.includedDocumentIds || this.includedDocumentIds.has(document.id)),
        )
        .map((document) => document.id);
      const selectedDocumentIds = intersectDocumentIds(
        availableDocumentIds,
        request.filters.documentIds,
      );

      result = await this.base.search({
        ...request,
        filters: {
          ...request.filters,
          // An empty documentIds array means “no filter” in storage adapters, so use an impossible
          // sentinel when the requested source family is not installed.
          documentIds:
            selectedDocumentIds.length > 0 ? [...selectedDocumentIds] : [EMPTY_SCOPE_DOCUMENT_ID],
        },
      });
    }
    if (!result.ok) return result;

    const explicitMedicationResponse =
      this.scope === 'medications' ? keepExplicitMedicationMatches(result.value) : result.value;
    const scopedResponse = filterMedicationDocuments(
      explicitMedicationResponse,
      documents.value,
      this.scope,
    );
    const audienceRanked = rankSearchGroupsByAudience(
      scopedResponse.groups,
      documents.value,
      inferRequestedAudience(request.query),
    );
    const summaries = new Map(documents.value.map((document) => [document.id, document]));
    const ranked =
      this.scope === 'diagnosis' ? rankDiagnosisGroups(audienceRanked) : audienceRanked;
    return {
      ok: true,
      value: {
        ...scopedResponse,
        groups: ranked.map((group) => {
          const document = summaries.get(group.documentId);
          const contentKind =
            document?.metadata?.['contentMode'] === 'module-pointer'
              ? 'pointer'
              : document?.sourceType.endsWith('_summary')
                ? 'summary'
                : 'full-text';
          return { ...group, contentKind };
        }),
      },
    };
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
    // The application owns the underlying cores. A short-lived scoped view must not close them.
  }
}
