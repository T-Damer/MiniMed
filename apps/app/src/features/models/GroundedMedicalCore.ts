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

import type { LocalModelController } from './controller';

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
}

export type GroundedAssistantListener = (state: GroundedAssistantState) => void;

interface QueryPlan {
  readonly intent: string;
  readonly terms: readonly string[];
  readonly clarifyingQuestions: readonly string[];
  readonly exclusions: readonly string[];
}

interface RankingReason {
  readonly id: string;
  readonly reason: string;
}

interface CandidateRanking {
  readonly orderedIds: readonly string[];
  readonly reasons: readonly RankingReason[];
}

interface CandidatePayload {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly sectionPath: readonly string[];
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
};

const MAX_CANDIDATES = 14;
const MAX_TERMS = 12;
const MAX_QUESTIONS = 5;
const MAX_TEXT_LENGTH = 180;

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

function parseRanking(value: unknown, allowedIds: readonly string[]): CandidateRanking {
  if (!isRecord(value)) throw new Error('Модель не вернула порядок источников в формате JSON.');
  const orderedIds = boundedStrings(value['orderedIds'], allowedIds.length);
  if (!orderedIds) throw new Error('Порядок источников не прошёл проверку структуры.');
  const allowed = new Set(allowedIds);
  if (orderedIds.some((id) => !allowed.has(id))) {
    throw new Error('Модель сослалась на источник, которого не было среди кандидатов.');
  }
  const reasonsValue = value['reasons'];
  if (!Array.isArray(reasonsValue)) throw new Error('Объяснения порядка имеют неверный формат.');
  const reasons: RankingReason[] = [];
  for (const item of reasonsValue) {
    if (!isRecord(item)) continue;
    const id = item['id'];
    const reason = item['reason'];
    if (typeof id !== 'string' || typeof reason !== 'string' || !allowed.has(id)) continue;
    const cleaned = reason.replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT_LENGTH);
    if (cleaned && !reasons.some((entry) => entry.id === id)) reasons.push({ id, reason: cleaned });
  }
  return { orderedIds, reasons };
}

function candidatePayload(result: SearchResult): CandidatePayload {
  return {
    id: result.chunkId,
    documentId: result.documentId,
    title: result.title,
    sectionPath: result.sectionPath,
    snippet: result.snippet.replace(/\s+/gu, ' ').trim().slice(0, 520),
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

function completeOrder(
  ranking: CandidateRanking,
  originalIds: readonly string[],
): readonly string[] {
  const result: string[] = [];
  for (const id of [...ranking.orderedIds, ...originalIds]) {
    if (originalIds.includes(id) && !result.includes(id)) result.push(id);
  }
  return result;
}

function reorderResponse(response: SearchResponse, orderedIds: readonly string[]): SearchResponse {
  const rank = new Map(orderedIds.map((id, index) => [id, index] as const));
  const missingRank = orderedIds.length + 10_000;
  const groups: SearchResultGroup[] = response.groups.map((group) => ({
    ...group,
    results: [...group.results].sort(
      (left, right) =>
        (rank.get(left.chunkId) ?? missingRank) - (rank.get(right.chunkId) ?? missingRank) ||
        right.finalScore - left.finalScore,
    ),
  }));
  groups.sort((left, right) => {
    const leftRank = Math.min(
      ...left.results.map((result) => rank.get(result.chunkId) ?? missingRank),
    );
    const rightRank = Math.min(
      ...right.results.map((result) => rank.get(result.chunkId) ?? missingRank),
    );
    return leftRank - rightRank || right.bestScore - left.bestScore;
  });
  return { ...response, groups };
}

function planPrompt(query: string, analysis: QueryAnalysis): string {
  return JSON.stringify(
    {
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
    },
    null,
    2,
  );
}

function rankingPrompt(query: string, candidates: readonly CandidatePayload[]): string {
  return JSON.stringify(
    {
      task: 'rerank-source-candidates',
      query,
      candidates,
      rules: [
        'Use only candidate ids from this list.',
        'Do not add a diagnosis, treatment, dose or medical claim.',
        'Prefer direct source relevance, age/applicability and the requested section.',
      ],
      outputSchema: {
        orderedIds: ['candidate id in preferred order'],
        reasons: [{ id: 'candidate id', reason: 'short relevance explanation' }],
      },
    },
    null,
    2,
  );
}

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
      message: 'Локальная модель уточняет формулировку и порядок найденных источников…',
      terms: [],
      clarifyingQuestions: [],
      rerankedCandidates: 0,
      generationMs: null,
      error: null,
    });

    try {
      const planResponse = await this.controller.completeStructuredTask({
        task: 'query-plan',
        systemPrompt:
          'Ты модуль планирования медицинского поиска. Не ставь диагноз, не назначай лечение и не добавляй медицинские факты. Верни только JSON по заданной схеме.',
        userPrompt: planPrompt(request.query, deterministic.value.analysis),
        maxTokens: 240,
      });
      if (generation !== this.searchGeneration) return deterministic;
      const rankingResponse = await this.controller.completeStructuredTask({
        task: 'rerank',
        systemPrompt:
          'Ты ранжируешь только уже найденные фрагменты медицинских источников. Не создавай новые источники, диагнозы, назначения или дозы. Верни только JSON по заданной схеме.',
        userPrompt: rankingPrompt(request.query, candidates),
        maxTokens: 360,
      });
      if (generation !== this.searchGeneration) return deterministic;
      const plan = parseQueryPlan(planResponse.parsedJson);
      const ranking = parseRanking(
        rankingResponse.parsedJson,
        candidates.map((candidate) => candidate.id),
      );
      const orderedIds = completeOrder(
        ranking,
        candidates.map((candidate) => candidate.id),
      );
      const reranked = reorderResponse(deterministic.value, orderedIds);
      this.updateAssistant({
        phase: 'applied',
        query: request.query,
        modelId,
        message: `Локальная модель уточнила порядок ${candidates.length} источников.`,
        terms: plan.terms,
        clarifyingQuestions: plan.clarifyingQuestions,
        rerankedCandidates: candidates.length,
        generationMs: planResponse.generationMs + rankingResponse.generationMs,
        error: null,
      });
      return { ok: true, value: reranked };
    } catch (cause) {
      if (generation !== this.searchGeneration) return deterministic;
      const error = cause instanceof Error ? cause.message : 'Неизвестная ошибка локальной модели.';
      this.updateAssistant({
        phase: 'fallback',
        query: request.query,
        modelId,
        message: 'Показан обычный порядок источников: локальная модель не прошла проверку.',
        terms: [],
        clarifyingQuestions: [],
        rerankedCandidates: 0,
        generationMs: null,
        error,
      });
      return deterministic;
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
