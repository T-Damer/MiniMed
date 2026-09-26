import { describe, expect, it } from 'vitest';
import rawCatalog from '../../../content/definition-drafts/catalog.json';
import probes from '../../../tools/benchmarks/data/definition-reverse-probes.json';
import {
  createDefinitionLookup,
  DEFINITION_CATALOG_MAX_BYTES,
  definitionSourceUrl,
  parseDefinitionCatalog,
} from './definition-catalog';

const catalog = parseDefinitionCatalog(rawCatalog);
const lookup = createDefinitionLookup(catalog);

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Missing test fixture entry.');
  return value;
}

describe('compact draft definition lookup', () => {
  for (const term of catalog.terms) {
    it(`keeps exact title identity: ${term.id}`, () => {
      const hit = lookup.search(term.title)[0];
      expect(hit?.term.id).toBe(term.id);
      expect(hit?.reviewStatus).toBe('requires-review');
      expect(hit?.citations.length).toBeGreaterThan(0);
    });
  }

  for (const probe of probes.cases) {
    it(`finds a partial definition: ${probe.id}`, () => {
      const rank =
        lookup.search(probe.query, 20).findIndex((hit) => hit.term.id === probe.expectedId) + 1;
      expect(rank).toBeGreaterThan(0);
      expect(rank).toBeLessThanOrEqual(probe.maxRank);
    });
  }

  it('preserves both Jaspers meanings and complete criterion lists', () => {
    const hits = lookup.search('Ясперс');
    expect(
      hits
        .slice(0, 2)
        .map((hit) => hit.term.id)
        .toSorted(),
    ).toEqual(['draft.definition.jaspers-consciousness', 'draft.definition.jaspers-reactive']);
    expect(hits.find((hit) => hit.term.id.endsWith('consciousness'))?.term.items).toHaveLength(4);
    expect(hits.find((hit) => hit.term.id.endsWith('reactive'))?.term.items).toHaveLength(3);
  });

  it('keeps negation meaningful instead of dropping it from reverse lookup', () => {
    expect(lookup.search('запахи не ощущаются')[0]?.term.id).toBe('draft.definition.anosmia');
    expect(lookup.search('запахи ощущаются слабее')[0]?.term.id).toBe('draft.definition.hyposmia');
    expect(lookup.search('не')).toEqual([]);
    expect(lookup.search('без нет')).toEqual([]);
  });

  it('repairs a bounded spelling error and strips only leading lookup preambles', () => {
    expect(lookup.search('Что такое тиннитус')[0]?.term.id).toBe('draft.definition.tinnitus');
    expect(lookup.search('тинитус')[0]?.term.id).toBe('draft.definition.tinnitus');
  });

  it('does not index publisher names, review notes or missing corpus concepts', () => {
    expect(lookup.search('NIDCD')).toEqual([]);
    expect(lookup.search('балльная шкала')).toEqual([]);
    expect(lookup.search('электромагнитная индукция')).toEqual([]);
  });

  it('enforces input, query and result bounds', () => {
    expect(lookup.search('')).toEqual([]);
    expect(lookup.search('я'.repeat(513))).toEqual([]);
    expect(lookup.search('амнезия', 0)).toEqual([]);
    expect(lookup.search('амнезия', Number.NaN)).toEqual([]);
    expect(lookup.search('амнезия', 1)).toHaveLength(1);
    expect(new TextEncoder().encode(JSON.stringify(rawCatalog)).byteLength).toBeLessThan(
      DEFINITION_CATALOG_MAX_BYTES,
    );
  });

  it('stores a shared numeric source catalog, not repeated publisher objects', () => {
    expect(catalog.sources).toHaveLength(5);
    for (const term of catalog.terms) {
      for (const reference of term.references) {
        expect(typeof reference.source).toBe('number');
        expect(reference.locator.trim()).not.toBe('');
      }
    }
  });

  it('rejects dangling references and duplicate IDs', () => {
    const duplicateSource = structuredClone(rawCatalog);
    duplicateSource.sources.push(first(duplicateSource.sources));
    expect(() => createDefinitionLookup(duplicateSource)).toThrow();
    const broken = structuredClone(rawCatalog);
    first(first(broken.terms).references).source = 999;
    expect(() => createDefinitionLookup(broken)).toThrow();
    const duplicateTerm = structuredClone(rawCatalog);
    duplicateTerm.terms.push(first(duplicateTerm.terms));
    expect(() => createDefinitionLookup(duplicateTerm)).toThrow();
  });

  it('does not silently publish or promote drafts, even from institutional sources', () => {
    expect(() => createDefinitionLookup({ ...rawCatalog, reviewStatus: 'reviewed' })).toThrow();
    expect(() =>
      createDefinitionLookup({ ...rawCatalog, publicationState: 'published' }),
    ).toThrow();
    expect(() => createDefinitionLookup({ ...rawCatalog, textKind: 'source-quote' })).toThrow();
    expect(() =>
      createDefinitionLookup({ ...rawCatalog, oversized: 'x'.repeat(300_000) }),
    ).toThrow();
  });

  it('rejects unsafe external URLs and accepts only the referenced source subtree', () => {
    const source = first(catalog.sources);
    for (const path of [
      'https://evil.example/',
      '//evil.example/',
      '../other',
      '%2e%2e/other',
      '\\evil',
      '/other',
    ]) {
      expect(() => definitionSourceUrl(source, path)).toThrow();
    }
    expect(definitionSourceUrl(source, '5')).toBe(
      'https://www.psychiatry.ru/lib/1/book/10/chapter/5',
    );
  });
});
