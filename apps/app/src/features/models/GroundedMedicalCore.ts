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

export interface GroundedSourceCitation {
  readonly chunkId: string;
  readonly documentId: string;
  readonly anchor: string;
  readonly title: string;
  readonly sectionPath: readonly string[];
}

export interface GroundedDiagnosisCandidate {
  readonly label: string;
  readonly sourceExcerpt: string;
  readonly citations: readonly GroundedSourceCitation[];
}

export interface GroundedDoseEvidence {
  readonly label: string;
  readonly sourceExcerpt: string;
  readonly missingInputs: readonly string[];
  readonly citations: readonly GroundedSourceCitation[];
}

export interface GroundedAssistantState {
  readonly phase: GroundedAssistantPhase;
  readonly query: string | null;
  readonly modelId: string | null;
  readonly message: string;
  readonly terms: readonly string[];
  readonly clarifyingQuestions: readonly string[];
  readonly diagnosisCandidates: readonly GroundedDiagnosisCandidate[];
  readonly doseEvidence: readonly GroundedDoseEvidence[];
  readonly missingInformation: readonly string[];
  readonly rerankedCandidates: number;
  readonly generationMs: number | null;
  readonly error: string | null;
  /**
   * The best available reordering of the deterministic response, published as soon as either
   * stage of the background enhancement produces one. `search()` itself always resolves with the
   * deterministic order — the UI picks this up via `subscribeAssistant` to upgrade in place once
   * it is ready, instead of blocking the initial results on model latency.
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

interface CandidateRanking {
  readonly orderedIds: readonly string[];
  readonly diagnosisCandidates: readonly GroundedDiagnosisCandidate[];
  readonly doseEvidence: readonly GroundedDoseEvidence[];
  readonly missingInformation: readonly string[];
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
  diagnosisCandidates: [],
  doseEvidence: [],
  missingInformation: [],
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
const MAX_CLINICAL_SUGGESTIONS = 5;
const MAX_CITATIONS = 4;

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

function boundedString(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/gu, ' ').trim();
  if (!cleaned || cleaned.length > maxLength) return null;
  return cleaned;
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

function sourceCitation(candidate: CandidatePayload): GroundedSourceCitation {
  return {
    chunkId: candidate.id,
    documentId: candidate.documentId,
    anchor: candidate.anchor,
    title: candidate.title,
    sectionPath: candidate.sectionPath,
  };
}

function citedCandidates(
  value: unknown,
  candidateById: ReadonlyMap<string, CandidatePayload>,
): readonly CandidatePayload[] {
  const ids = boundedStrings(value, MAX_CITATIONS);
  if (!ids || ids.length === 0) {
    throw new Error('Клиническое предложение не содержит ссылку на найденный фрагмент.');
  }
  const candidates = ids.map((id) => candidateById.get(id));
  if (candidates.some((candidate) => !candidate)) {
    throw new Error('Модель сослалась на источник, которого не было среди кандидатов.');
  }
  return candidates as readonly CandidatePayload[];
}

function isExactSourceExcerpt(excerpt: string, candidates: readonly CandidatePayload[]): boolean {
  const normalized = excerpt.toLocaleLowerCase('ru-RU');
  return candidates.some((candidate) =>
    candidate.snippet.toLocaleLowerCase('ru-RU').includes(normalized),
  );
}

function labelAppearsInSource(label: string, candidates: readonly CandidatePayload[]): boolean {
  const normalized = label.toLocaleLowerCase('ru-RU');
  return candidates.some((candidate) =>
    `${candidate.title} ${candidate.snippet}`.toLocaleLowerCase('ru-RU').includes(normalized),
  );
}

function candidateSupportsClaim(
  candidate: CandidatePayload,
  label: string,
  sourceExcerpt: string,
): boolean {
  return (
    labelAppearsInSource(label, [candidate]) && isExactSourceExcerpt(sourceExcerpt, [candidate])
  );
}

function containsDoseRegimen(excerpt: string): boolean {
  const dose =
    /(?:^|[^\p{L}\p{N}])\d+(?:[.,]\d+)?\s*(?:мкг|мг|г|мл|ед\.?|ме)(?:\s*\/\s*(?:кг|сут(?:ки)?))?/iu;
  const regimen =
    /(?:м(?:к)?г\s*\/\s*кг|\/\s*сут|раз(?:а)?\s+(?:в|за)\s+сут|кажд(?:ые|ый|ую)|однократно|курс(?:ом)?|в течение\s+\d+)/iu;
  return dose.test(excerpt) && regimen.test(excerpt);
}

function parseDiagnosisCandidates(
  value: unknown,
  candidateById: ReadonlyMap<string, CandidatePayload>,
): readonly GroundedDiagnosisCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error('Диагностические кандидаты имеют неверный формат.');
  }
  const result: GroundedDiagnosisCandidate[] = [];
  for (const item of value.slice(0, MAX_CLINICAL_SUGGESTIONS)) {
    if (!isRecord(item)) throw new Error('Диагностический кандидат имеет неверный формат.');
    const label = boundedString(item['label']);
    const sourceExcerpt = boundedString(item['sourceExcerpt'], MAX_SOURCE_EXCERPT_LENGTH);
    if (!label || !sourceExcerpt) {
      throw new Error('Диагностический кандидат не прошёл проверку текста.');
    }
    const candidates = citedCandidates(item['citationIds'], candidateById);
    if (!candidates.some((candidate) => candidateSupportsClaim(candidate, label, sourceExcerpt))) {
      throw new Error('Диагностический кандидат не подтверждён процитированным фрагментом.');
    }
    result.push({
      label,
      sourceExcerpt,
      citations: candidates.map(sourceCitation),
    });
  }
  return result;
}

function parseDoseEvidence(
  value: unknown,
  candidateById: ReadonlyMap<string, CandidatePayload>,
): readonly GroundedDoseEvidence[] {
  if (!Array.isArray(value)) throw new Error('Дозировочные фрагменты имеют неверный формат.');
  const result: GroundedDoseEvidence[] = [];
  for (const item of value.slice(0, MAX_CLINICAL_SUGGESTIONS)) {
    if (!isRecord(item)) throw new Error('Дозировочный фрагмент имеет неверный формат.');
    const label = boundedString(item['label']);
    const sourceExcerpt = boundedString(item['sourceExcerpt'], MAX_SOURCE_EXCERPT_LENGTH);
    const missingInputs = boundedStrings(item['missingInputs'], MAX_QUESTIONS);
    if (!label || !sourceExcerpt || !missingInputs) {
      throw new Error('Дозировочный фрагмент не прошёл проверку текста.');
    }
    const candidates = citedCandidates(item['citationIds'], candidateById);
    if (
      !containsDoseRegimen(sourceExcerpt) ||
      !candidates.some(
        (candidate) =>
          candidate.category === 'treatment' &&
          candidateSupportsClaim(candidate, label, sourceExcerpt),
      )
    ) {
      throw new Error('Дозировка не подтверждена точным режимом из лечебного раздела.');
    }
    result.push({
      label,
      sourceExcerpt,
      missingInputs,
      citations: candidates.map(sourceCitation),
    });
  }
  return result;
}

function parseRanking(value: unknown, candidates: readonly CandidatePayload[]): CandidateRanking {
  if (!isRecord(value)) throw new Error('Модель не вернула порядок источников в формате JSON.');
  const allowedIds = candidates.map((candidate) => candidate.id);
  const orderedIds = boundedStrings(value['orderedIds'], allowedIds.length);
  if (!orderedIds) throw new Error('Порядок источников не прошёл проверку структуры.');
  const allowed = new Set(allowedIds);
  if (orderedIds.some((id) => !allowed.has(id))) {
    throw new Error('Модель сослалась на источник, которого не было среди кандидатов.');
  }
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const diagnosisCandidates = parseDiagnosisCandidates(value['diagnosisCandidates'], candidateById);
  const doseEvidence = parseDoseEvidence(value['doseEvidence'], candidateById);
  const missingInformation = boundedStrings(value['missingInformation'], MAX_QUESTIONS);
  if (!missingInformation) throw new Error('Недостающие сведения имеют неверный формат.');
  return {
    orderedIds,
    diagnosisCandidates,
    doseEvidence,
    missingInformation,
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

function rankingPrompt(query: string, candidates: readonly CandidatePayload[]): string {
  return JSON.stringify({
    task: 'rerank-source-candidates',
    query,
    candidates: candidates.map(({ id, title, category, snippet }) => ({
      id,
      title,
      category,
      snippet,
    })),
    rules: [
      'Use only candidate ids from this list.',
      'Prefer direct source relevance, age/applicability and the requested section.',
      'A diagnosis candidate label must be copied from a cited candidate title or snippet.',
      'sourceExcerpt must be an exact contiguous quote copied from one cited candidate snippet.',
      'Dose evidence is allowed only when the exact quote contains both a numeric dose and a regimen.',
      'Never calculate, personalize or complete a dose. List missing patient inputs instead.',
      'Return empty clinical arrays when retrieved candidates do not contain the required evidence.',
    ],
    outputSchema: {
      orderedIds: ['candidate id in preferred order'],
      diagnosisCandidates: [
        {
          label: 'diagnosis name copied from cited source',
          sourceExcerpt: 'exact quote copied from cited candidate snippet',
          citationIds: ['candidate id'],
        },
      ],
      doseEvidence: [
        {
          label: 'medicine name copied from cited source',
          sourceExcerpt: 'exact quote with numeric dose and regimen',
          citationIds: ['candidate id'],
          missingInputs: ['patient input required before applying the source regimen'],
        },
      ],
      missingInformation: ['patient detail needed to narrow the evidence'],
    },
  });
}

const RELEVANCE_WEIGHTS: Readonly<Record<string, number>> = { H: 2, M: 1, L: 0 };

// A cheap first-pass reorder: a coarse per-candidate relevance letter instead of the full
// citation-checked JSON in `rankingPrompt`. Carries no clinical claim (it never asserts a
// diagnosis or dose), so it can safely stay applied even if the slower, stricter pass below fails.
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
      message: 'Локальная модель уточняет порядок найденных источников…',
      terms: [],
      clarifyingQuestions: [],
      diagnosisCandidates: [],
      doseEvidence: [],
      missingInformation: [],
      rerankedCandidates: 0,
      generationMs: null,
      error: null,
      enhancedResponse: null,
    });

    // search() always resolves with the deterministic order — the UI never blocks on model
    // latency. The (much slower) model-assisted reorder and citation extraction are published
    // afterward through the assistant state, so results appear immediately and are upgraded in
    // place once ready.
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
    // Stage 1: a cheap coarse relevance label per candidate — a few tokens of output instead of a
    // full JSON object, so it finishes long before stage 2 and gives an early, better-than-nothing
    // reorder. It never asserts a diagnosis or dose, so it stays applied even if stage 2 fails.
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
      if (weights.size > 0) {
        this.updateAssistant({
          enhancedResponse: applyRelevanceWeights(deterministic, weights),
          message: 'Быстрый порядок готов, локальная модель уточняет точные цитаты…',
        });
      }
    } catch {
      // Best effort — stage 2 below remains authoritative for the final phase/message.
    }
    if (generation !== this.searchGeneration) return;

    // Stage 2: the slower, citation-checked rerank — unchanged from before, just no longer gates
    // search()'s return value.
    try {
      const planResponse = await this.controller.completeStructuredTask({
        task: 'query-plan',
        systemPrompt:
          'Ты модуль планирования медицинского поиска. Не ставь диагноз, не назначай лечение и не добавляй медицинские факты. Верни только JSON по заданной схеме.',
        userPrompt: planPrompt(query, deterministic.analysis),
        maxTokens: 240,
      });
      if (generation !== this.searchGeneration) return;
      const rankingResponse = await this.controller.completeStructuredTask({
        task: 'rerank',
        systemPrompt:
          'Ты извлекаешь данные только из уже найденных фрагментов медицинских источников. Не создавай новые факты, источники, назначения или расчёты. Клинический текст копируй дословно и связывай только с доступными id. Верни только JSON по заданной схеме.',
        userPrompt: rankingPrompt(query, candidates),
        maxTokens: 512,
      });
      if (generation !== this.searchGeneration) return;
      const plan = parseQueryPlan(planResponse.parsedJson);
      const ranking = parseRanking(rankingResponse.parsedJson, candidates);
      const orderedIds = completeOrder(
        ranking,
        candidates.map((candidate) => candidate.id),
      );
      const reranked = reorderResponse(deterministic, orderedIds);
      this.updateAssistant({
        phase: 'applied',
        query,
        modelId,
        message: `Локальная модель уточнила порядок ${candidates.length} источников.`,
        terms: plan.terms,
        clarifyingQuestions: plan.clarifyingQuestions,
        diagnosisCandidates: ranking.diagnosisCandidates,
        doseEvidence: ranking.doseEvidence,
        missingInformation: ranking.missingInformation,
        rerankedCandidates: candidates.length,
        generationMs: planResponse.generationMs + rankingResponse.generationMs,
        enhancedResponse: reranked,
        error: null,
      });
    } catch (cause) {
      if (generation !== this.searchGeneration) return;
      const error = cause instanceof Error ? cause.message : 'Неизвестная ошибка локальной модели.';
      // A stage-1 reorder carries no clinical claim, so keep it visible even when the stricter
      // citation pass below fails — only the citation-derived fields fall back fully.
      const fastOrder = this.state.query === query ? this.state.enhancedResponse : null;
      this.updateAssistant({
        phase: 'fallback',
        query,
        modelId,
        message: fastOrder
          ? 'Показан быстрый порядок источников: точные цитаты не прошли проверку.'
          : 'Показан обычный порядок источников: локальная модель не прошла проверку.',
        terms: [],
        clarifyingQuestions: [],
        diagnosisCandidates: [],
        doseEvidence: [],
        missingInformation: [],
        rerankedCandidates: 0,
        generationMs: null,
        enhancedResponse: fastOrder,
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
