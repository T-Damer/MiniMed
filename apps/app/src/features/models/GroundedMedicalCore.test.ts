import type {
  MedicalCore,
  QueryAnalysis,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { LocalModelController } from '@/features/models/controller';
import {
  type GroundedAssistantPhase,
  type GroundedAssistantState,
  GroundedMedicalCore,
} from '@/features/models/GroundedMedicalCore';
import type { LocalModelStructuredRequest } from '@/features/models/types';

// The model's job is narrow: understand the query (query-plan) and give a coarse relevance-based
// reorder of already-retrieved sources — no citation extraction, no diagnosis/dose claims. Both
// run in the background after search() resolves with the deterministic order, so tests wait for
// the phase the background enhancement settles into instead of reading it off the return value.
function waitForPhase(
  core: GroundedMedicalCore,
  phase: GroundedAssistantPhase,
): Promise<GroundedAssistantState> {
  return new Promise((resolve) => {
    const unsubscribe = core.subscribeAssistant((state) => {
      if (state.phase !== phase) return;
      unsubscribe();
      resolve(state);
    });
  });
}

const analysis: QueryAnalysis = {
  originalQuery: 'кашель и лихорадка',
  normalizedQuery: 'кашель и лихорадка',
  intent: {
    primary: 'diagnosis',
    secondary: [],
    confidence: 0.8,
    matchedSignals: ['кашель'],
    needsClarification: true,
  },
  facts: [],
  branches: [
    {
      id: 'original',
      kind: 'original',
      label: 'Исходный запрос',
      query: 'кашель и лихорадка',
      normalizedQuery: 'кашель и лихорадка',
      terms: ['кашель', 'лихорадка'],
      weight: 1,
    },
  ],
  suggestions: [],
  warnings: [],
};

function searchResult(
  chunkId: string,
  documentId: string,
  title: string,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    chunkId,
    documentId,
    documentVersionId: `${documentId}@1`,
    sectionId: `${documentId}:section`,
    anchor: `${documentId}/section#${chunkId}`,
    title,
    sectionPath: ['Диагностика'],
    snippet: `${title}: клинический фрагмент для проверки порядка.`,
    highlightedRanges: [],
    lexicalScore: 1,
    semanticScore: null,
    finalScore: chunkId === 'chunk-a' ? 0.9 : 0.8,
    matchedTerms: ['кашель'],
    matchedBranches: ['original'],
    sectionType: 'diagnostics',
    category: 'diagnostics',
    ...overrides,
  };
}

const deterministicResponse: SearchResponse = {
  requestId: 'request-1',
  normalizedQuery: 'кашель и лихорадка',
  elapsedMs: 4,
  modeUsed: 'lexical',
  analysis,
  suggestions: [],
  groups: [
    {
      documentId: 'doc-a',
      title: 'Документ A',
      bestScore: 0.9,
      categories: ['diagnostics'],
      results: [searchResult('chunk-a', 'doc-a', 'Документ A')],
    },
    {
      documentId: 'doc-b',
      title: 'Документ B',
      bestScore: 0.8,
      categories: ['diagnostics'],
      results: [searchResult('chunk-b', 'doc-b', 'Документ B')],
    },
  ],
  diagnostics: {
    ftsQuery: 'кашель лихорадка',
    candidateCount: 2,
    aliasMatches: [],
    terms: ['кашель', 'лихорадка'],
    branches: [],
    semantic: {
      status: 'disabled',
      requestedMode: 'auto',
      profileId: null,
      candidateCount: 0,
      elapsedMs: 0,
      fallbackReason: null,
    },
  },
};

const request: SearchRequest = {
  query: 'кашель и лихорадка',
  mode: 'auto',
  filters: {},
  limit: 20,
  includeSuggestions: true,
};

function baseCore(response: SearchResponse = deterministicResponse): MedicalCore {
  return {
    initialize: vi.fn(),
    getCapabilities: vi.fn(),
    listDocuments: vi.fn(),
    analyzeQuery: vi.fn(),
    search: vi.fn().mockResolvedValue({ ok: true, value: response }),
    getDocument: vi.fn(),
    getSection: vi.fn(),
    getContext: vi.fn(),
    getSearchResultContext: vi.fn(),
    ask: vi.fn(),
    installContentPack: vi.fn(),
    close: vi.fn(),
  } as MedicalCore;
}

// The responder returns an object for JSON tasks (query-plan) or a plain string for the
// relevance task's "1:H 2:M" text format — completeStructuredTask mirrors real sessions by only
// populating parsedJson for the object case.
function modelController(
  responder: (request: LocalModelStructuredRequest) => unknown,
  ready = true,
): LocalModelController {
  return {
    canRunStructuredTasks: () => ready,
    getState: () => ({ activeModelId: ready ? 'model-a' : null }),
    completeStructuredTask: vi.fn(async (task: LocalModelStructuredRequest) => {
      const result = responder(task);
      const isText = typeof result === 'string';
      return {
        task: task.task,
        rawText: isText ? result : JSON.stringify(result),
        parsedJson: isText ? null : result,
        generationMs: 10,
      };
    }),
  } as unknown as LocalModelController;
}

function validQueryPlan(): Readonly<Record<string, unknown>> {
  return {
    intent: 'поиск источников о причине кашля и лихорадки',
    terms: ['кашель', 'лихорадка'],
    clarifyingQuestions: ['Каков возраст пациента?'],
    exclusions: [],
  };
}

describe('GroundedMedicalCore', () => {
  it('reorders deterministic candidates by relevance labels and understands the query', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => (task.task === 'query-plan' ? validQueryPlan() : '1:L 2:H')),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // search() itself always resolves with the deterministic order.
    expect(result.value.groups.map((group) => group.documentId)).toEqual(['doc-a', 'doc-b']);

    const applied = await waitForPhase(core, 'applied');
    expect(applied.enhancedResponse?.groups.map((group) => group.documentId)).toEqual([
      'doc-b',
      'doc-a',
    ]);
    expect(applied).toMatchObject({
      modelId: 'model-a',
      terms: ['кашель', 'лихорадка'],
      clarifyingQuestions: ['Каков возраст пациента?'],
      rerankedCandidates: 2,
    });
  });

  it('keeps the relevance prompt inside the compact-model candidate budget', async () => {
    const group = deterministicResponse.groups[0];
    if (!group) throw new Error('Test requires one result group.');
    const manyResults = Array.from({ length: 10 }, (_, index) =>
      searchResult(`chunk-${index}`, 'doc-a', 'Документ A', {
        snippet: `Документ A: ${'длинный клинический фрагмент '.repeat(30)}`,
      }),
    );
    const response: SearchResponse = {
      ...deterministicResponse,
      groups: [{ ...group, results: manyResults }],
    };
    let relevancePromptText = '';
    const core = new GroundedMedicalCore(
      baseCore(response),
      modelController((task) => {
        if (task.task === 'query-plan') return validQueryPlan();
        relevancePromptText = task.userPrompt;
        return '1:H';
      }),
    );

    await core.search(request);
    await waitForPhase(core, 'applied');

    const candidateLines = relevancePromptText.split('\n').filter((line) => /^\d+\.\s/.test(line));
    expect(candidateLines).toHaveLength(6);
    expect(relevancePromptText.length).toBeLessThanOrEqual(4_000);
  });

  it('ignores an out-of-range relevance index instead of crashing', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => (task.task === 'query-plan' ? validQueryPlan() : '9:H 2:H')),
    );

    const result = await core.search(request);
    expect(result.ok).toBe(true);

    const applied = await waitForPhase(core, 'applied');
    // "9:H" has no matching candidate and is skipped; "2:H" (doc-b) is still applied.
    expect(applied.enhancedResponse?.groups.map((group) => group.documentId)).toEqual([
      'doc-b',
      'doc-a',
    ]);
    expect(applied.rerankedCandidates).toBe(1);
  });

  it('keeps the query understanding even when the relevance pass fails', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => (task.task === 'query-plan' ? validQueryPlan() : 'not a label')),
    );

    const result = await core.search(request);
    expect(result.ok).toBe(true);

    const fallback = await waitForPhase(core, 'fallback');
    expect(fallback.terms).toEqual(['кашель', 'лихорадка']);
    expect(fallback.clarifyingQuestions).toEqual(['Каков возраст пациента?']);
    expect(fallback.enhancedResponse).toBeNull();
  });

  it('still reorders by relevance when query understanding fails', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => (task.task === 'query-plan' ? { malformed: true } : '1:L 2:H')),
    );

    const result = await core.search(request);
    expect(result.ok).toBe(true);

    const applied = await waitForPhase(core, 'applied');
    expect(applied.enhancedResponse?.groups.map((group) => group.documentId)).toEqual([
      'doc-b',
      'doc-a',
    ]);
    expect(applied.terms).toEqual([]);
    expect(applied.clarifyingQuestions).toEqual([]);
  });

  it('does not call the model when no validated session is ready', async () => {
    const controller = modelController(
      (task) => (task.task === 'query-plan' ? validQueryPlan() : '1:H'),
      false,
    );
    const complete = vi.spyOn(controller, 'completeStructuredTask');
    const core = new GroundedMedicalCore(baseCore(), controller);

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(core.getAssistantState().phase).toBe('idle');
  });
});
