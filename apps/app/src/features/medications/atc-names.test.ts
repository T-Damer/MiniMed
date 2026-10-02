import { describe, expect, it } from 'vitest';

import { atcLadder, normalizeAtcCode } from './atc-code';
import { loadAtcNames, parseAtcNameCatalog } from './atc-names';

describe('parseAtcNameCatalog', () => {
  it('rejects a malformed asset instead of returning an empty catalog', () => {
    expect(() => parseAtcNameCatalog(null)).toThrow();
    expect(() => parseAtcNameCatalog({ source: 'x', version: '1', publishDate: 'd' })).toThrow();
    expect(() =>
      parseAtcNameCatalog({ source: 'x', version: '1', publishDate: 'd', names: { N: 1 } }),
    ).toThrow();
  });
});

describe('the bundled NSI «АТХ» names', () => {
  it('load once and describe the whole of levels 1-4', async () => {
    const catalog = await loadAtcNames();
    expect(await loadAtcNames()).toBe(catalog);
    expect(catalog.version).toMatch(/^\d+\.\d+$/u);
    expect(catalog.publishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    const codes = Object.keys(catalog.names);
    const perLevel = [1, 3, 4, 5].map(
      (length) => codes.filter((code) => code.length === length).length,
    );
    expect(perLevel).toEqual([14, 93, 271, 937]);
    for (const code of codes) {
      expect(normalizeAtcCode(code)?.corrected).toBe(false);
      const parent = code.length === 3 ? code.slice(0, 1) : code.slice(0, -1);
      if (code.length > 1) expect(catalog.names[parent], `${code} needs ${parent}`).toBeTruthy();
    }
  });

  it('name every level of two real codes', async () => {
    const catalog = await loadAtcNames();
    const names = (raw: string) =>
      atcLadder({ code: normalizeAtcCode(raw) ?? never(raw), catalog })
        .slice(0, 4)
        .map((step) => step.name);
    expect(names('N06AB06')).toEqual([
      'Нервная система',
      'Психоаналептики',
      'Антидепрессанты',
      'Селективные ингибиторы обратного захвата серотонина',
    ]);
    expect(names('C09AA02')).toEqual([
      'Сердечно-сосудистая система',
      'Средства, действующие на ренин-ангиотензиновую систему',
      'Ингибиторы ангиотензинпревращающего фермента (АПФ)',
      'Ингибиторы АПФ',
    ]);
  });
});

function never(raw: string): never {
  throw new Error(`not an ATC code: ${raw}`);
}
