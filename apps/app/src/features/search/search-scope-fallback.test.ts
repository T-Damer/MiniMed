import type {
  MedicalCore,
  SearchDocumentDescriptor,
  SearchRequest,
  SearchResponse,
  SearchResultGroup,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  groupHitsBySection,
  OTHER_SOURCES_LABEL,
  scopedSearchFoundNothing,
  scopeFallbackEnabled,
  scopeMissLine,
  scopeResultsHeading,
  searchOtherSections,
} from './search-scope-fallback';

const group = (documentId: string): SearchResultGroup =>
  ({ documentId, title: documentId, results: [] }) as unknown as SearchResultGroup;

const document = (
  id: string,
  sourceType: string,
  metadata: Record<string, unknown> = {},
): SearchDocumentDescriptor =>
  ({
    id,
    title: id,
    shortTitle: id,
    sourceType,
    metadata,
    ageGroups: [],
  }) as SearchDocumentDescriptor;

const documents = new Map(
  [
    document('kr', 'clinical_recommendation'),
    document('drug', 'official_drug_instruction'),
    document('law', 'regulatory_act'),
    document('mkb', 'rls_mkb_reference'),
    document('mystery', 'unknown_source'),
  ].map((entry) => [entry.id, entry]),
);

const labels: Record<string, string> = {
  guidelines: 'Клинические рекомендации',
  medications: 'Препараты',
  legal: 'Нормативные документы',
  conditions: 'МКБ, симптомы и состояния',
};
const labelOf = (scope: string) => labels[scope] ?? scope;

describe('scopeFallbackEnabled', () => {
  it('applies to the text sections and to a group of «Все источники»', () => {
    for (const scope of ['guidelines', 'medications', 'legal', 'conditions', 'icd11'] as const)
      expect(scopeFallbackEnabled({ scope, grouped: false, catalogOnly: false })).toBe(true);
    expect(scopeFallbackEnabled({ scope: 'all', grouped: true, catalogOnly: false })).toBe(true);
  });

  it('never applies to «Все», the clinical analysis, tool lists and personal notes', () => {
    expect(scopeFallbackEnabled({ scope: 'all', grouped: false, catalogOnly: false })).toBe(false);
    for (const scope of ['diagnosis', 'calculators', 'assessments', 'personal'] as const)
      expect(scopeFallbackEnabled({ scope, grouped: false, catalogOnly: false })).toBe(false);
    expect(scopeFallbackEnabled({ scope: 'all', grouped: true, catalogOnly: true })).toBe(false);
  });
});

describe('scopedSearchFoundNothing', () => {
  const response = (patch: Partial<SearchResponse>): SearchResponse =>
    ({ groups: [], ...patch }) as unknown as SearchResponse;

  it('is true only for a response with no group, identity or named source', () => {
    expect(scopedSearchFoundNothing(response({}))).toBe(true);
    expect(scopedSearchFoundNothing(response({ groups: [group('kr')] }))).toBe(false);
    expect(scopedSearchFoundNothing(response({ identities: [{}] as unknown as never }))).toBe(
      false,
    );
    expect(
      scopedSearchFoundNothing(response({ sourceScope: { id: 'x' } as unknown as never })),
    ).toBe(false);
  });
});

describe('groupHitsBySection', () => {
  it('orders sections by their best hit and keeps the ranking inside a section', () => {
    const sections = groupHitsBySection(
      [group('drug'), group('kr'), group('drug'), group('law'), group('kr')].map(
        (entry, index) => ({
          ...entry,
          title: `hit-${index}`,
        }),
      ),
      documents,
      labelOf,
    );
    expect(sections.map((section) => section.scope)).toEqual([
      'medications',
      'guidelines',
      'legal',
    ]);
    expect(sections[0]?.groups.map((entry) => entry.title)).toEqual(['hit-0', 'hit-2']);
    expect(sections[1]?.groups.map((entry) => entry.title)).toEqual(['hit-1', 'hit-4']);
  });

  it('puts a МКБ card in its own section, not in the guidelines', () => {
    const [section] = groupHitsBySection([group('mkb')], documents, labelOf);
    expect(section).toMatchObject({ scope: 'conditions', label: 'МКБ, симптомы и состояния' });
  });

  it('keeps a hit of no section in a last group that opens nothing', () => {
    const sections = groupHitsBySection([group('mystery'), group('ghost')], documents, labelOf);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ scope: undefined, label: OTHER_SOURCES_LABEL });
    expect(sections[0]?.groups).toHaveLength(2);
  });
});

describe('copy', () => {
  it('words the miss line and the subheader as the owner asked', () => {
    expect(scopeMissLine('Флувоксами', 'Педиатрия')).toBe(
      'Поиск по запросу «Флувоксами» не дал результатов в разделе «Педиатрия»',
    );
    expect(scopeResultsHeading('Препараты')).toBe('Результаты раздела «Препараты»:');
  });
});

describe('searchOtherSections', () => {
  const request = { query: 'флувоксамин', filters: {} } as unknown as SearchRequest;
  const core = (groups: readonly SearchResultGroup[], ok = true) =>
    ({
      search: vi.fn(async () =>
        ok
          ? { ok: true, value: { groups } as unknown as SearchResponse }
          : { ok: false, error: new Error('x') },
      ),
      listSearchDocuments: vi.fn(async () => ({ ok: true, value: [...documents.values()] })),
      listDocuments: vi.fn(),
    }) as unknown as MedicalCore;

  it('groups the all-sources hits and names the section that missed', async () => {
    const found = await searchOtherSections({
      allSourcesCore: core([group('drug'), group('kr')]),
      request,
      missedLabel: 'Педиатрия',
      labelOf,
    });
    expect(found?.missedLabel).toBe('Педиатрия');
    expect(found?.sections.map((section) => section.label)).toEqual([
      'Препараты',
      'Клинические рекомендации',
    ]);
  });

  it('finds nothing to show when the wider search is empty or fails', async () => {
    const base = { request, missedLabel: 'Педиатрия', labelOf };
    expect(await searchOtherSections({ ...base, allSourcesCore: core([]) })).toBeUndefined();
    expect(await searchOtherSections({ ...base, allSourcesCore: core([], false) })).toBeUndefined();
  });
});
