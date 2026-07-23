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

function validResponse(task: LocalModelStructuredRequest): Readonly<Record<string, unknown>> {
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
    diagnosisCandidates: [],
    doseEvidence: [],
    missingInformation: ['Возраст пациента'],
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
      missingInformation: ['Возраст пациента'],
      rerankedCandidates: 2,
    });
  });

  it('keeps the ranking prompt inside the compact-model candidate budget', async () => {
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
    let candidates: readonly { readonly snippet: string }[] = [];
    let rankingPromptText = '';
    const core = new GroundedMedicalCore(
      baseCore(response),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        rankingPromptText = task.userPrompt;
        candidates = (
          JSON.parse(task.userPrompt) as {
            readonly candidates: readonly { readonly snippet: string }[];
          }
        ).candidates;
        return {
          orderedIds: [],
          diagnosisCandidates: [],
          doseEvidence: [],
          missingInformation: [],
        };
      }),
    );

    await core.search(request);

    expect(candidates).toHaveLength(6);
    expect(candidates.every((candidate) => candidate.snippet.length <= 280)).toBe(true);
    expect(rankingPromptText.length).toBeLessThanOrEqual(5_000);
    expect(rankingPromptText).not.toContain('\n');
  });

  it('accepts a diagnosis candidate only with an exact retrieved excerpt and citation', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return {
          ...validResponse(task),
          diagnosisCandidates: [
            {
              label: 'Документ B',
              sourceExcerpt: 'Документ B: клинический фрагмент для проверки порядка.',
              citationIds: ['chunk-b'],
            },
          ],
        };
      }),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(core.getAssistantState().diagnosisCandidates).toEqual([
      {
        label: 'Документ B',
        sourceExcerpt: 'Документ B: клинический фрагмент для проверки порядка.',
        citations: [
          {
            chunkId: 'chunk-b',
            documentId: 'doc-b',
            anchor: 'doc-b/section#chunk-b',
            title: 'Документ B',
            sectionPath: ['Диагностика'],
          },
        ],
      },
    ]);
  });

  it('rejects a diagnosis assembled from different cited chunks', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return {
          ...validResponse(task),
          diagnosisCandidates: [
            {
              label: 'Документ A',
              sourceExcerpt: 'Документ B: клинический фрагмент для проверки порядка.',
              citationIds: ['chunk-a', 'chunk-b'],
            },
          ],
        };
      }),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(core.getAssistantState().phase).toBe('fallback');
    expect(core.getAssistantState().diagnosisCandidates).toEqual([]);
  });

  it('rejects a dose claim without an exact regimen in a treatment fragment', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return {
          ...validResponse(task),
          doseEvidence: [
            {
              label: 'Документ B',
              sourceExcerpt: 'Документ B: клинический фрагмент для проверки порядка.',
              citationIds: ['chunk-b'],
              missingInputs: ['Масса тела'],
            },
          ],
        };
      }),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(core.getAssistantState().phase).toBe('fallback');
    expect(core.getAssistantState().doseEvidence).toEqual([]);
    expect(core.getAssistantState().error).toMatch(/не подтверждена точным режимом/u);
  });

  it('accepts only a verbatim dose regimen from a treatment fragment', async () => {
    const doseSnippet = 'Препарат X: 10 мг/кг/сут в 2 приёма.';
    const treatmentResponse: SearchResponse = {
      ...deterministicResponse,
      groups: deterministicResponse.groups.map((group) =>
        group.documentId === 'doc-b'
          ? {
              ...group,
              categories: ['treatment'],
              results: [
                searchResult('chunk-b', 'doc-b', 'Препарат X', {
                  snippet: doseSnippet,
                  sectionType: 'treatment',
                  category: 'treatment',
                }),
              ],
            }
          : group,
      ),
    };
    const core = new GroundedMedicalCore(
      baseCore(treatmentResponse),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return {
          ...validResponse(task),
          doseEvidence: [
            {
              label: 'Препарат X',
              sourceExcerpt: doseSnippet,
              citationIds: ['chunk-b'],
              missingInputs: ['Масса тела'],
            },
          ],
        };
      }),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(core.getAssistantState().phase).toBe('applied');
    expect(core.getAssistantState().doseEvidence).toMatchObject([
      {
        label: 'Препарат X',
        sourceExcerpt: doseSnippet,
        missingInputs: ['Масса тела'],
      },
    ]);
  });

  it('rejects dose evidence assembled from different cited chunks', async () => {
    const doseSnippet = '10 мг/кг/сут в 2 приёма.';
    const firstGroup = deterministicResponse.groups[0];
    const secondGroup = deterministicResponse.groups[1];
    if (!firstGroup || !secondGroup) throw new Error('Test requires two result groups.');
    const treatmentResponse: SearchResponse = {
      ...deterministicResponse,
      groups: [
        {
          ...firstGroup,
          results: [searchResult('chunk-a', 'doc-a', 'Препарат X')],
        },
        {
          ...secondGroup,
          categories: ['treatment'],
          results: [
            searchResult('chunk-b', 'doc-b', 'Документ B', {
              snippet: doseSnippet,
              sectionType: 'treatment',
              category: 'treatment',
            }),
          ],
        },
      ],
    };
    const core = new GroundedMedicalCore(
      baseCore(treatmentResponse),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return {
          ...validResponse(task),
          doseEvidence: [
            {
              label: 'Препарат X',
              sourceExcerpt: doseSnippet,
              citationIds: ['chunk-a', 'chunk-b'],
              missingInputs: ['Масса тела'],
            },
          ],
        };
      }),
    );

    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(core.getAssistantState().phase).toBe('fallback');
    expect(core.getAssistantState().doseEvidence).toEqual([]);
  });

  it('returns the untouched deterministic order when the model invents a candidate id', async () => {
    const core = new GroundedMedicalCore(
      baseCore(),
      modelController((task) => {
        if (task.task === 'query-plan') return validResponse(task);
        return { orderedIds: ['invented-id'] };
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
