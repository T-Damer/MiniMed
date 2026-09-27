import type { DefinitionReferenceHit } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  expansionCountLabel,
  groupReferenceHits,
  licenseLabel,
  referenceAnnotationFlags,
  referenceBlockLabel,
  referenceEntryType,
  referenceLocation,
  referenceLocationLabel,
  referenceSourceAttribution,
} from '@/features/reference/reference-entry';

const hit = (
  id: string,
  title: string,
  kind: string,
  textKind: DefinitionReferenceHit['textKind'] = 'source-excerpt',
): DefinitionReferenceHit => ({
  id,
  title,
  kind,
  coverage: kind === 'abbreviation' ? 'abbreviation' : 'explicit-definition',
  textKind,
  reviewStatus: 'requires-review',
  identityStatus: 'source-local-proposed',
  blockCount: 2,
  match: 'name',
});

describe('reference entry types', () => {
  it('follows only the declared kind and text kind', () => {
    expect(referenceEntryType(hit('a', 'АД', 'abbreviation'))).toBe('abbreviation');
    expect(referenceEntryType(hit('b', 'кокцидиоид', 'term', 'source-gloss'))).toBe('gloss');
    expect(referenceEntryType(hit('c', 'Гипертензия', 'term'))).toBe('definition');
    // An id that looks like a dictionary entry changes nothing.
    expect(referenceEntryType(hit('ruwikt.1', 'слово', 'term'))).toBe('definition');
  });

  it('never labels an abbreviation block as a definition', () => {
    expect(referenceBlockLabel('definition', 'abbreviation')).toBe('Расшифровка');
    expect(referenceBlockLabel('definition', 'gloss')).toBe('Толкование');
    expect(referenceBlockLabel('definition', 'definition')).toBe('Определение');
  });

  it('folds same-spelled abbreviations into one row at the first hit, keeping search order', () => {
    const groups = groupReferenceHits([
      hit('a1', 'АД', 'abbreviation'),
      hit('d1', 'Артериальное давление', 'term'),
      hit('a2', 'ад', 'abbreviation'),
      hit('g1', 'ад', 'term', 'source-gloss'),
    ]);
    expect(groups.map((group) => [group.type, group.hits.map((item) => item.id)])).toEqual([
      ['abbreviation', ['a1', 'a2']],
      ['definition', ['d1']],
      ['gloss', ['g1']],
    ]);
  });

  it('counts expansions with the Russian plural forms', () => {
    expect([1, 3, 5, 12, 21, 22].map(expansionCountLabel)).toEqual([
      '1 расшифровка',
      '3 расшифровки',
      '5 расшифровок',
      '12 расшифровок',
      '21 расшифровка',
      '22 расшифровки',
    ]);
  });
});

describe('reference provenance', () => {
  it('reads flags only from a metadata annotation', () => {
    expect(
      referenceAnnotationFlags('{"flags":["conflicting-expansion"],"note":"Построчно извлечено"}'),
    ).toEqual(['conflicting-expansion']);
    expect(referenceAnnotationFlags('{"note":"","sourceSubjects":["medicine"]}')).toEqual([]);
    expect(referenceAnnotationFlags('Обычное примечание')).toEqual([]);
    expect(() => referenceAnnotationFlags('{"flags":')).toThrow();
  });

  it('names the clinical-guideline document and section from the exact locator', () => {
    const location = referenceLocation({
      locator:
        'clinical-301_3.db; document=kr.rf.301_3; version=kr.rf.301_3@301_3; section=section.ccb6; chars=0:19',
      sectionTitle: 'Список сокращений',
    });
    expect(location).toEqual({ documentId: 'kr.rf.301_3', sectionTitle: 'Список сокращений' });
    expect(referenceLocationLabel(location)).toBe(
      'Клинические рекомендации 301_3 · раздел «Список сокращений»',
    );
    expect(referenceLocationLabel(referenceLocation({ locator: 'ru-extract.jsonl:1' }))).toBe(
      undefined,
    );
  });

  it('attributes a dictionary gloss exactly as its source declares', () => {
    const attribution = referenceSourceAttribution(
      {
        source: {
          title: 'Русский Викисловарь; медицинская выборка Kaikki/Wiktextract',
          baseUrl: 'https://ru.wiktionary.org/wiki/',
          license: 'CC-BY-SA-4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          attribution: 'Russian Wiktionary contributors; extraction by Wiktextract/Kaikki.org',
        },
      },
      { citations: [{ path: '%D0%BA%D0%BE%D0%BA' }] },
    );
    expect(attribution).toEqual({
      name: 'Русский Викисловарь',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'Russian Wiktionary contributors; extraction by Wiktextract/Kaikki.org',
      entryUrl: 'https://ru.wiktionary.org/wiki/%D0%BA%D0%BE%D0%BA',
    });
    expect(licenseLabel('CC0-1.0')).toBe('CC0-1.0');
    // No link from a non-web base URL.
    expect(
      referenceSourceAttribution(
        { source: { title: 'X', baseUrl: 'javascript:alert(1)//' } },
        { citations: [{ path: 'x' }] },
      ).entryUrl,
    ).toBe(undefined);
  });
});
