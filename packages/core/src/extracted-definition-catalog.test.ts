import { describe, expect, it } from 'vitest';
import { createDefinitionLookup, parseDefinitionCatalog } from './definition-catalog';

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Missing fixture entry');
  return value;
}

function fixture() {
  return {
    version: 3, id: 'fixture.excerpt', reviewStatus: 'requires-review', publicationState: 'local-dev', textKind: 'source-excerpt',
    sources: [{ id: 2001, title: 'Учебный источник — синтетическая проверка', authority: 'professional-reference', accessed: '2026-09-21', sourceType: 'owner-pdf', fileName: 'fixture.pdf', baseUrl: '', sourceSha256: 'a'.repeat(64), rightsStatus: 'owner-provided-not-redistribution-permission', releaseEligible: false }],
    blocks: [
      { id: 1, source: 2001, text: 'Альфа — пояснение из источника.', locator: 'PDF p. 1', textSha256: 'b'.repeat(64) },
      { id: 2, source: 2001, text: '1. Первое условие.\n2. Второе условие. Все условия необходимы.', locator: 'PDF pp. 1–2', textSha256: 'c'.repeat(64) },
    ],
    terms: [{ id: 'fixture.alpha', title: 'Альфа', kind: 'criterion_set', aliases: [] as string[], blockIds: [1, 2], itemBlocks: [2], coverage: 'criterion-list', note: 'Историческая редакция источника; требует проверки.' }],
  };
}

describe('source-excerpt catalog boundary', () => {
  it('preserves source text, list numbering and qualifications', () => {
    const raw = fixture();
    const term = first(parseDefinitionCatalog(raw).terms);
    expect(term.definition).toBe(raw.blocks.map((block) => block.text).join('\n\n'));
    expect(term.items).toEqual([]);
    expect(term.coverage).toBe('criterion-list');
  });
  it('finds an owner definition without inventing an external URL', () => {
    const hit = first(createDefinitionLookup(fixture()).search('первое условие'));
    expect(hit.term.id).toBe('fixture.alpha');
    expect(hit.textKind).toBe('source-excerpt');
    expect(hit.citations.every((citation) => citation.url === '')).toBe(true);
  });
  it('keeps owner source details and review state', () => {
    const catalog = parseDefinitionCatalog(fixture());
    expect(first(catalog.sources).fileName).toBe('fixture.pdf');
    expect(catalog.reviewStatus).toBe('requires-review');
    expect(catalog.publicationState).toBe('local-dev');
  });
  it('rejects publication promotion', () => {
    const raw = fixture();
    expect(() => parseDefinitionCatalog({ ...raw, publicationState: 'published' })).toThrow();
    first(raw.sources).releaseEligible = true;
    expect(() => parseDefinitionCatalog(raw)).toThrow();
  });
  it('rejects dangling source and block references', () => {
    const raw = fixture();
    first(raw.blocks).source = 999;
    expect(() => parseDefinitionCatalog(raw)).toThrow();
    const another = fixture();
    first(another.terms).blockIds.push(999);
    expect(() => parseDefinitionCatalog(another)).toThrow();
  });
  it('rejects incomplete list/detail block membership', () => {
    const raw = fixture();
    first(raw.terms).itemBlocks.push(999);
    expect(() => parseDefinitionCatalog(raw)).toThrow();
  });
  it('rejects duplicate term and block identities', () => {
    const raw = fixture();
    raw.terms.push(first(raw.terms));
    expect(() => parseDefinitionCatalog(raw)).toThrow();
    const another = fixture();
    another.blocks.push(first(another.blocks));
    expect(() => parseDefinitionCatalog(another)).toThrow();
  });
  it('does not turn a scale mention into a calculator', () => {
    const raw = fixture();
    first(raw.terms).kind = 'scale';
    first(raw.terms).coverage = 'mention-only';
    const term = first(parseDefinitionCatalog(raw).terms);
    expect(term.coverage).toBe('mention-only');
    expect(term).not.toHaveProperty('scoring');
    expect(term).not.toHaveProperty('interactiveRoute');
  });
  it('rejects owner URLs and local path traversal', () => {
    const raw = fixture();
    first(raw.sources).baseUrl = 'https://evil.example/';
    expect(() => parseDefinitionCatalog(raw)).toThrow();
    const another = fixture();
    first(another.sources).fileName = '../private.pdf';
    expect(() => parseDefinitionCatalog(another)).toThrow();
  });
  it('rejects missing checksums and oversized input', () => {
    const raw = fixture();
    first(raw.sources).sourceSha256 = 'invalid';
    expect(() => parseDefinitionCatalog(raw)).toThrow();
    expect(() => parseDefinitionCatalog({ ...fixture(), extra: 'x'.repeat(17 * 1024 * 1024) })).toThrow();
  });
});
