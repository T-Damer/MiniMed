import { describe, expect, it } from 'vitest';
import { senseSource, senseSourceLabel, senseSourceLink } from './sense-detail';

const registry = {
  source: {
    title: 'Клинические рекомендации Минздрава России: «Термины и определения»',
    authority: 'official',
  },
};
const kr = {
  documentId: 'kr.rf.904_1',
  documentTitle: 'Переломы бедренной кости',
  anchor: 'kr.rf.904_1@904_1/термины-и-определения#chunk-fbad9ac9',
};
const site = {
  source: {
    title: 'Красота и медицина: «Краткое описание» статей о заболеваниях',
    publisher: 'Красота и медицина',
    baseUrl: 'https://www.krasotaimedicina.ru/',
    authority: 'third-party',
  },
};
const wiktionary = {
  source: {
    title: 'Русский Викисловарь; медицинская выборка Kaikki/Wiktextract',
    baseUrl: 'https://ru.wiktionary.org/wiki/',
    authority: 'third-party',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'Russian Wiktionary contributors',
  },
};

describe('senseSource', () => {
  it('names a recommendation by its title and links to the exact anchor, without a draft badge', () => {
    expect(senseSource(registry, kr)).toEqual({
      label: 'КР: Переломы бедренной кости',
      link: { kind: 'document', documentId: 'kr.rf.904_1', anchor: kr.anchor },
      official: true,
    });
  });

  it('treats the first extraction of the recommendations as official too', () => {
    const first = {
      source: {
        title: 'КР',
        sourceType: 'existing-clinical-detail-dataset',
        authority: 'third-party',
      },
    };
    expect(senseSource(first, kr).official).toBe(true);
    expect(senseSource(wiktionary, {}).official).toBe(false);
  });

  it('names a site by its publisher and opens its reader anchor', () => {
    const provenance = {
      documentId: 'krasotaimedicina.disease.0007',
      anchor: 'krasotaimedicina.disease.0007@site/краткое-описание#chunk-695d4262',
      path: 'diseases/psychiatric/depression',
    };
    const source = senseSource(site, provenance);
    expect(source.label).toBe('Красота и медицина');
    expect(source.link).toEqual({
      kind: 'document',
      documentId: provenance.documentId,
      anchor: provenance.anchor,
    });
    expect(source.official).toBe(false);
  });

  it('falls back to the web page of the entry, and to the title before its first qualifier', () => {
    expect(senseSourceLabel(wiktionary, {})).toBe('Русский Викисловарь');
    expect(senseSourceLink(wiktionary, { citations: [{ path: 'депрессия' }] })).toEqual({
      kind: 'web',
      url: new URL('депрессия', 'https://ru.wiktionary.org/wiki/').href,
    });
    expect(senseSourceLink(wiktionary, {})).toBeUndefined();
  });

  it('keeps the licence and authors a share-alike source asks to be credited', () => {
    expect(senseSource(wiktionary, {}).credit).toEqual({
      authors: 'Russian Wiktionary contributors',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
    expect(senseSource(site, {}).credit).toBeUndefined();
  });

  it('never links to a non-http address', () => {
    const odd = { source: { baseUrl: 'javascript:alert(1)//', title: 'x' } };
    expect(senseSourceLink(odd, { path: 'a' })).toBeUndefined();
  });

  it('has a neutral label without any source facts', () => {
    expect(senseSourceLabel(null, {})).toBe('Источник');
  });
});
