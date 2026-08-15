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
  SearchResultGroup,
} from '@localmed/contracts';

import type { LocalModelController } from '@/features/models/controller';
import { withoutThinking } from '@/features/models/structured-output';

export type GroundedAssistantPhase = 'idle' | 'running' | 'applied' | 'fallback';

export interface GroundedAssistantState {
  readonly phase: GroundedAssistantPhase;
  readonly query: string | null;
  readonly modelId: string | null;
  readonly message: string;
  readonly terms: readonly string[];
  readonly clarifyingQuestions: readonly string[];
  readonly rerankedCandidates: number;
  readonly generationMs: number | null;
  readonly error: string | null;
  /**
   * The best available reordering of the deterministic response, published once the relevance
   * pass produces one. `search()` itself always resolves with the deterministic order — the UI
   * picks this up via `subscribeAssistant` to upgrade in place once it is ready, instead of
   * blocking the initial results on model latency.
   */
  readonly enhancedResponse: SearchResponse | null;
}

export type GroundedAssistantListener = (state: GroundedAssistantState) => void;

interface QueryPlan {
  readonly intent: string;
  readonly terms: readonly string[];
  readonly clarifyingQuestions: readonly string[];
  readonly exclusions: readonly string[];
}

interface CandidatePayload {
  readonly id: string;
  readonly documentId: string;
  readonly anchor: string;
  readonly title: string;
  readonly sectionPath: readonly string[];
  readonly category: SearchResult['category'];
  readonly snippet: string;
}

const INITIAL_STATE: GroundedAssistantState = {
  phase: 'idle',
  query: null,
  modelId: null,
  message: 'Обычный локальный поиск готов.',
  terms: [],
  clarifyingQuestions: [],
  rerankedCandidates: 0,
  generationMs: null,
  error: null,
  enhancedResponse: null,
};

// ponytail: fits current 2K-token browser sessions; add tokenizer-aware packing for larger contexts.
const MAX_CANDIDATES = 6;
const MAX_TERMS = 12;
const MAX_QUESTIONS = 5;
const MAX_TEXT_LENGTH = 180;
const MAX_SOURCE_EXCERPT_LENGTH = 280;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedStrings(value: unknown, limit: number): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const cleaned = item.replace(/\s+/gu, ' ').trim();
    if (!cleaned || cleaned.length > MAX_TEXT_LENGTH) continue;
    if (!result.includes(cleaned)) result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function parseQueryPlan(value: unknown): QueryPlan {
  if (!isRecord(value)) throw new Error('Модель не вернула план запроса в формате JSON.');
  const terms = boundedStrings(value['terms'], MAX_TERMS);
  const questions = boundedStrings(value['clarifyingQuestions'], MAX_QUESTIONS);
  const exclusions = boundedStrings(value['exclusions'], MAX_TERMS);
  if (typeof value['intent'] !== 'string' || !terms || !questions || !exclusions) {
    throw new Error('План запроса не прошёл проверку структуры.');
  }
  return {
    intent: value['intent'].slice(0, MAX_TEXT_LENGTH),
    terms,
    clarifyingQuestions: questions,
    exclusions,
  };
}

function candidatePayload(result: SearchResult): CandidatePayload {
  return {
    id: result.chunkId,
    documentId: result.documentId,
    anchor: result.anchor,
    title: result.title,
    sectionPath: result.sectionPath,
    category: result.category,
    snippet: result.snippet.replace(/\s+/gu, ' ').trim().slice(0, MAX_SOURCE_EXCERPT_LENGTH),
  };
}

function flattenCandidates(response: SearchResponse): readonly CandidatePayload[] {
  const result: CandidatePayload[] = [];
  const seen = new Set<string>();
  for (const group of response.groups) {
    for (const item of group.results) {
      if (seen.has(item.chunkId)) continue;
      seen.add(item.chunkId);
      result.push(candidatePayload(item));
      if (result.length >= MAX_CANDIDATES) return result;
    }
  }
  return result;
}

function planPrompt(query: string, analysis: QueryAnalysis): string {
  return JSON.stringify({
    task: 'query-plan',
    query,
    deterministicAnalysis: {
      intent: analysis.intent?.primary ?? 'unknown',
      facts: analysis.facts.map((fact) => ({
        kind: fact.kind,
        value: fact.normalizedValue,
        polarity: fact.polarity,
      })),
      branches: analysis.branches.map((branch) => ({ label: branch.label, terms: branch.terms })),
    },
    outputSchema: {
      intent: 'short string describing search intent, not a diagnosis',
      terms: ['search term already supported by the query'],
      clarifyingQuestions: ['question that could improve source search'],
      exclusions: ['negated or explicitly excluded concept'],
    },
  });
}

const RELEVANCE_WEIGHTS: Readonly<Record<string, number>> = { H: 2, M: 1, L: 0 };

function relevancePrompt(query: string, candidates: readonly CandidatePayload[]): string {
  const lines = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. [${candidate.category}] ${candidate.title}: ${candidate.snippet}`,
    )
    .join('\n');
  return [
    `Запрос: ${query}`,
    '',
    'Кандидаты (раздел источника указан в квадратных скобках):',
    lines,
    '',
    'Оценивай релевантность как источник для разбора клинического случая, а не по совпадению отдельных слов.',
    'Разделы clinical-picture, differential-diagnosis и diagnostics обычно важнее для диагностики.',
    'Раздел treatment и карточки конкретных препаратов релевантны только если запрос явно про лечение или дозировку — иначе их релевантность низкая, даже если упомянут тот же симптом.',
    'Для каждого кандидата укажи одну букву релевантности запросу: H — высокая, M — средняя, L — низкая.',
    'Ответь только строкой вида "1:H 2:M 3:L" без пояснений и без повтора текста кандидатов.',
  ].join('\n');
}

function parseRelevanceLabels(
  rawText: string,
  candidates: readonly CandidatePayload[],
): ReadonlyMap<string, number> {
  const cleaned = withoutThinking(rawText);
  const weights = new Map<string, number>();
  const pattern = /(\d{1,2})\s*[:.-]\s*([HMLhml])\b/gu;
  for (const match of cleaned.matchAll(pattern)) {
    const index = Number(match[1]) - 1;
    const candidate = candidates[index];
    const letter = match[2]?.toUpperCase();
    if (!candidate || !letter || weights.has(candidate.id)) continue;
    weights.set(candidate.id, RELEVANCE_WEIGHTS[letter] ?? 0);
  }
  return weights;
}

function applyRelevanceWeights(
  response: SearchResponse,
  weights: ReadonlyMap<string, number>,
): SearchResponse {
  const weightOf = (chunkId: string): number => weights.get(chunkId) ?? -1;
  const groups: SearchResultGroup[] = response.groups.map((group) => ({
    ...group,
    results: [...group.results].sort(
      (left, right) =>
        weightOf(right.chunkId) - weightOf(left.chunkId) || right.finalScore - left.finalScore,
    ),
  }));
  groups.sort((left, right) => {
    const leftWeight = Math.max(-1, ...left.results.map((result) => weightOf(result.chunkId)));
    const rightWeight = Math.max(-1, ...right.results.map((result) => weightOf(result.chunkId)));
    return rightWeight - leftWeight || right.bestScore - left.bestScore;
  });
  return { ...response, groups };
}

/**
 * The local model's job here is deliberately narrow: understand the clinical case (query-plan)
 * and give a coarse relevance-based reorder of already-retrieved sources. It never asserts a
 * diagnosis, a dose, or a citation — that kind of clinical claim-extraction was tried and dropped
 * (see docs/adr/0011's catalog-trim amendment context and docs/GROUNDED_LOCAL_ASSISTANT.md) in
 * favor of this cheaper, faster, and more honest scope.
 */
export class GroundedMedicalCore implements MedicalCore {
  private readonly listeners = new Set<GroundedAssistantListener>();
  private state: GroundedAssistantState = INITIAL_STATE;
  private searchGeneration = 0;

  public constructor(
    private base: MedicalCore,
    private readonly controller: LocalModelController,
  ) {}

  public setBase(core: MedicalCore): void {
    this.base = core;
  }

  public getAssistantState(): GroundedAssistantState {
    return this.state;
  }

  public subscribeAssistant(listener: GroundedAssistantListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private updateAssistant(patch: Partial<GroundedAssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
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

  public analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>> {
    return this.base.analyzeQuery(request);
  }

  public async search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>> {
    const generation = ++this.searchGeneration;
    const deterministic = await this.base.search(request);
    if (!deterministic.ok || !this.controller.canRunStructuredTasks()) return deterministic;

    const candidates = flattenCandidates(deterministic.value);
    if (candidates.length < 2) return deterministic;
    const modelId = this.controller.getState().activeModelId;
    this.updateAssistant({
      phase: 'running',
      query: request.query,
      modelId,
      message: 'Локальная модель разбирает запрос и уточняет порядок источников…',
      terms: [],
      clarifyingQuestions: [],
      rerankedCandidates: 0,
      generationMs: null,
      error: null,
      enhancedResponse: null,
    });

    // search() always resolves with the deterministic order — the UI never blocks on model
    // latency. The model's understanding and reorder are published afterward through the
    // assistant state, so results appear immediately and are upgraded in place once ready.
    void this.enhance(generation, request.query, deterministic.value, candidates, modelId);
    return deterministic;
  }

  private async enhance(
    generation: number,
    query: string,
    deterministic: SearchResponse,
    candidates: readonly CandidatePayload[],
    modelId: string | null,
  ): Promise<void> {
    // Understand the case: turn the already-extracted facts into better search terms and
    // clarifying questions. Best effort — its failure alone must not block the reorder below.
    let plan: QueryPlan | null = null;
    let planGenerationMs = 0;
    try {
      const planResponse = await this.controller.completeStructuredTask({
        task: 'query-plan',
        systemPrompt:
          'Ты модуль планирования медицинского поиска. Не ставь диагноз, не назначай лечение и не добавляй медицинские факты. Верни только JSON по заданной схеме.',
        userPrompt: planPrompt(query, deterministic.analysis),
        maxTokens: 240,
      });
      if (generation !== this.searchGeneration) return;
      plan = parseQueryPlan(planResponse.parsedJson);
      planGenerationMs = planResponse.generationMs;
      this.updateAssistant({ terms: plan.terms, clarifyingQuestions: plan.clarifyingQuestions });
    } catch {
      // Best effort — the relevance reorder below is still attempted.
    }
    if (generation !== this.searchGeneration) return;

    // A cheap coarse relevance label per candidate — a few tokens of output instead of a full
    // JSON object. Carries no clinical claim (it never asserts a diagnosis or dose), only
    // reorders sources the deterministic search already retrieved.
    try {
      const relevanceResponse = await this.controller.completeStructuredTask({
        task: 'relevance',
        systemPrompt:
          'Ты оцениваешь совпадение уже найденных фрагментов с запросом. Не добавляй факты и не пиши ничего, кроме меток.',
        userPrompt: relevancePrompt(query, candidates),
        maxTokens: 64,
      });
      if (generation !== this.searchGeneration) return;
      const weights = parseRelevanceLabels(relevanceResponse.rawText, candidates);
      if (weights.size === 0) {
        throw new Error('Модель не вернула распознаваемые метки релевантности.');
      }
      this.updateAssistant({
        phase: 'applied',
        query,
        modelId,
        message: `Локальная модель уточнила порядок ${weights.size} из ${candidates.length} источников.`,
        rerankedCandidates: weights.size,
        generationMs: planGenerationMs + relevanceResponse.generationMs,
        enhancedResponse: applyRelevanceWeights(deterministic, weights),
        error: null,
      });
    } catch (cause) {
      if (generation !== this.searchGeneration) return;
      const error = cause instanceof Error ? cause.message : 'Неизвестная ошибка локальной модели.';
      this.updateAssistant({
        phase: 'fallback',
        query,
        modelId,
        message: 'Показан обычный порядок источников: локальная модель не прошла проверку.',
        rerankedCandidates: 0,
        generationMs: planGenerationMs > 0 ? planGenerationMs : null,
        enhancedResponse: null,
        error,
      });
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
    result: Parameters<MedicalCore['getSearchResultContext']>[0],
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

  public close(): Promise<void> {
    return this.base.close();
  }
}
