import type { CoreIdentityHit, SearchResponse, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  cleanSelection,
  MAX_LOOKUP_QUERIES,
  nominativeForms,
  resolveSelectionTerm,
  type SelectionSearch,
  selectionLookupQueries,
} from './selection-term';

const hit = (title: string, coverage = 'definition'): CoreIdentityHit => ({
  name: title.toLowerCase(),
  title,
  kind: 'term',
  coverage,
  target: {
    type: 'definition',
    moduleId: 'minimed.definition.reference.ru',
    moduleVersion: '1',
    entityId: `entity.${title.toLowerCase()}`,
    editionId: 'edition',
  },
});

const group = (title: string): SearchResultGroup =>
  ({ documentId: `doc.${title}`, title, bestScore: 1, categories: [], results: [] }) as never;

function response(partial: Partial<SearchResponse>): SearchResponse {
  return {
    requestId: 'r',
    normalizedQuery: '',
    elapsedMs: 1,
    modeUsed: 'lexical',
    analysis: {} as never,
    suggestions: [],
    groups: [],
    diagnostics: {} as never,
    ...partial,
  };
}

/** A search over a tiny dictionary: only the exact (case/ё-insensitive) names are identities. */
function searchOver(
  names: readonly string[],
  groups: Record<string, SearchResultGroup[]> = {},
  coverage = 'definition',
) {
  const asked: string[] = [];
  const search: SelectionSearch = async (query) => {
    asked.push(query);
    const key = query.toLowerCase().replaceAll('ё', 'е');
    const found = names.find((name) => name.toLowerCase().replaceAll('ё', 'е') === key);
    return {
      ok: true,
      value: response({
        ...(found ? { identities: [hit(found, coverage)] } : {}),
        groups: groups[query] ?? [],
      }),
    };
  };
  return { search, asked };
}

describe('cleanSelection', () => {
  it('collapses whitespace, joins line-end hyphenation and drops edge punctuation', () => {
    expect(cleanSelection('  «Гипертен-\n зия», ')).toBe('Гипертензия');
    expect(cleanSelection('острый   коронарный\nсиндром.')).toBe('острый коронарный синдром');
  });

  it('refuses what is not a term', () => {
    expect(cleanSelection('')).toBeUndefined();
    expect(cleanSelection('123 456')).toBeUndefined();
    expect(cleanSelection('а')).toBeUndefined();
    expect(cleanSelection('один два три четыре пять шесть семь')).toBeUndefined();
    expect(cleanSelection('слово '.repeat(20))).toBeUndefined();
  });
});

describe('nominativeForms', () => {
  it('gives the nominative first for inflected nouns and adjectives', () => {
    expect(nominativeForms('гипертензии')[0]).toBe('гипертензия');
    expect(nominativeForms('диабетом')).toContain('диабет');
    expect(nominativeForms('Синдрома')).toContain('синдром');
    expect(nominativeForms('сахарного')[0]).toBe('сахарный');
    expect(nominativeForms('почки')[0]).toBe('почка');
    expect(nominativeForms('болезни')[0]).toBe('болезнь');
    expect(nominativeForms('недостаточности')[0]).toBe('недостаточность');
  });

  it('folds ё and ignores non-Cyrillic or too short words', () => {
    expect(nominativeForms('Лёгкого')).toContain('легкий');
    expect(nominativeForms('insulin')).toEqual([]);
    expect(nominativeForms('на')).toEqual([]);
  });
});

describe('selectionLookupQueries', () => {
  it('asks the selection as selected first, then its nominative forms', () => {
    expect(selectionLookupQueries('Диабет')[0]).toBe('Диабет');
    const queries = selectionLookupQueries('диабете');
    expect(queries[0]).toBe('диабете');
    expect(queries).toContain('диабет');
  });

  it('adds the nominative phrase and shorter parts of a phrase, bounded', () => {
    const queries = selectionLookupQueries('острого коронарного синдрома');
    expect(queries[0]).toBe('острого коронарного синдрома');
    expect(queries[1]).toBe('острый коронарный синдром');
    expect(queries.length).toBeLessThanOrEqual(MAX_LOOKUP_QUERIES);
    expect(selectionLookupQueries('лечение пневмонии')).toContain('пневмония');
  });

  it('has no queries for a passage or noise', () => {
    expect(selectionLookupQueries('...')).toEqual([]);
    expect(selectionLookupQueries('один два три четыре пять шесть семь')).toEqual([]);
  });
});

describe('resolveSelectionTerm', () => {
  it('finds an exact name at once', async () => {
    const { search, asked } = searchOver(['Диабет']);
    const lookup = await resolveSelectionTerm('диабет', search);
    expect(lookup?.identities.map((item) => item.title)).toEqual(['Диабет']);
    expect(asked).toEqual(['диабет']);
  });

  it('reaches the headword of an inflected form', async () => {
    const { search } = searchOver(['Гипертензия']);
    const lookup = await resolveSelectionTerm('гипертензии', search);
    expect(lookup?.matched).toBe('гипертензия');
    expect(lookup?.identities.map((item) => item.title)).toEqual(['Гипертензия']);
  });

  it('reaches a multi-word headword from its genitive phrase', async () => {
    const { search } = searchOver(['Острый коронарный синдром']);
    const lookup = await resolveSelectionTerm('острого коронарного синдрома', search);
    expect(lookup?.identities[0]?.title).toBe('Острый коронарный синдром');
  });

  it('finds the term inside a longer phrase', async () => {
    const { search } = searchOver(['Пневмония']);
    const lookup = await resolveSelectionTerm('лечение пневмонии', search);
    expect(lookup?.matched).toBe('пневмония');
  });

  it('prefers the headword with a definition over a bare name of the typed form', async () => {
    const asked: string[] = [];
    const search: SelectionSearch = async (query) => {
      asked.push(query);
      const identities =
        query === 'пневмонии'
          ? [hit('Пневмонии', 'needs-definition')]
          : query === 'пневмония'
            ? [hit('Пневмония')]
            : [];
      return { ok: true, value: response({ identities }) };
    };
    const lookup = await resolveSelectionTerm('пневмонии', search);
    expect(lookup?.identities.map((item) => item.title)).toEqual(['Пневмония']);
    expect(lookup?.matched).toBe('пневмония');
  });

  it('keeps a bare name when no candidate has a definition', async () => {
    const { search } = searchOver(['Анамнез'], {}, 'needs-definition');
    const lookup = await resolveSelectionTerm('анамнез', search);
    expect(lookup?.identities.map((item) => item.title)).toEqual(['Анамнез']);
  });

  it('without a definition returns the documents found for the selection', async () => {
    const found = [group('Инфаркт миокарда')];
    const { search } = searchOver([], { инфаркту: found });
    const lookup = await resolveSelectionTerm('инфаркту', search);
    expect(lookup?.identities).toEqual([]);
    expect(lookup?.groups).toBe(found);
    expect(lookup?.matched).toBe('инфаркту');
  });

  it('answers with nothing found when nothing matches', async () => {
    const { search } = searchOver([]);
    const lookup = await resolveSelectionTerm('абракадабра', search);
    expect(lookup).toMatchObject({ identities: [], groups: [] });
  });

  it('carries the core spelling correction of the search that found the documents', async () => {
    const correction = {
      correctedQuery: 'аменция',
      corrections: [{ original: 'оменция', corrected: 'аменция', cost: 0.5 }],
    };
    const search: SelectionSearch = async () => ({
      ok: true,
      value: response({ groups: [group('Аменция')], queryCorrection: correction as never }),
    });
    const lookup = await resolveSelectionTerm('оменция', search);
    expect(lookup?.correction?.correctedQuery).toBe('аменция');
  });

  it('is undefined for a selection that is not a term and rejects when every search fails', async () => {
    const { search } = searchOver([]);
    expect(await resolveSelectionTerm('...', search)).toBeUndefined();
    const failing: SelectionSearch = async () => ({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'core closed' } as never,
    });
    await expect(resolveSelectionTerm('диабет', failing)).rejects.toThrow('core closed');
  });
});
