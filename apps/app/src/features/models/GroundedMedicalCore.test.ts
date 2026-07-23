import type {
  MedicalCore,
  QueryAnalysis,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { LocalModelController } from './controller';
import { GroundedMedicalCore } from './GroundedMedicalCore';
import type { LocalModelStructuredRequest } from './types';

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

function searchResult(chunkId: string, documentId: string, title: string): SearchResult {
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

function baseCore(): MedicalCore {
  return {
    initialize: vi.fn(),
    getCapabilities: vi.fn(),
    listDocuments: vi.fn(),
    analyzeQuery: vi.fn(),
    search: vi.fn().mockResolvedValue({ ok: true, value: deterministicResponse }),
    getDocument: vi.fn(),
    getSection: vi.fn(),
    getContext: vi.fn(),
    ask: vi.fn(),
    installContentPack: vi.fn(),
    close: vi.fn(),
  } as MedicalCore;
}

function modelController(
  responder: (request: LocalModelStructuredRequest) => unknown,
  ready = true,
): LocalModelController {
  return {
    canRunStructuredTasks: () => ready,
    getState: () => ({ activeModelId: ready ? 'model-a' : null }),
    completeStructuredTask: vi.fn(async (task: LocalModelStructuredRequest) => ({
      task: task.task,
      rawText: JSON.stringify(responder(task)),
      parsedJson: responder(task),
      generationMs: 10,
    })),
  } as unknown as LocalModelController;
}

function validResponse(task: LocalModelStructuredRequest): unknown {
  if (task.task === 'query-plan') {
    return {
      intent: 'поиск источников о причине кашля и лихорадки',
      terms: ['кашель', 'лихорадка'],
      clarifyingQuestions: ['Каков возраст пациента?'],
      exclusions: [],
    };
  }
  return {
    orderedIds: ['chunk-b', 'chunk-a'],
    reasons: [
      { id: 'chunk-b', reason: 'Раздел точнее соответствует формулировке запроса.' },
      { id: 'chunk-a', reason: 'Дополнительный релевантный источник.' },
    ],
  };
}

describe('GroundedMedicalCore', () => {
  it('reorders only deterministic candidate ids after valid structured output', async () => {
    const core = new GroundedMedicalCore(baseCore(), modelController(validResponse));

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((group) => group.documentId)).toEqual(['doc-b', 'doc-a']);
    expect(core.getAssistantState()).toMatchObject({
      phase: 'applied',
      modelId: 'model-a',
      terms: ['кашель', 'лихорадка'],
      rerankedCandidates: 2,
    });
  });

  it('returns the untouched deterministic order when the model invents a candidate id', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return { orderedIds: ['invented-id'], reasons: [] };
      }),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((group) => group.documentId)).toEqual(['doc-a', 'doc-b']);
    expect(core.getAssistantState().phase).toBe('fallback');
    expect(core.getAssistantState().error).toMatch(/не было среди кандидатов/u);
  });

  it('does not call the model when no validated session is ready', async () => {
    const controller = modelController(validResponse, false);
    const complete = vi.spyOn(controller, 'completeStructuredTask');
    const core = new GroundedMedicalCore(baseCore(), controller);

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(core.getAssistantState().phase).toBe('idle');
  });
});
