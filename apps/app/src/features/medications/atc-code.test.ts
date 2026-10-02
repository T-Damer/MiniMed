import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ATC_ANATOMICAL_GROUPS,
  atcCatalogCitation,
  atcGroupChain,
  atcLadder,
  atcPrefixes,
  normalizeAtcCode,
} from './atc-code';

function code(raw: string) {
  const parsed = normalizeAtcCode(raw);
  if (!parsed) throw new Error(`not an ATC code: ${raw}`);
  return parsed;
}

describe('normalizeAtcCode', () => {
  it('accepts codes of every level', () => {
    expect(normalizeAtcCode('N')?.level).toBe(1);
    expect(normalizeAtcCode('N06')?.level).toBe(2);
    expect(normalizeAtcCode('N06B')?.level).toBe(3);
    expect(normalizeAtcCode('N06BX')?.level).toBe(4);
    expect(normalizeAtcCode('N06BX03')?.level).toBe(5);
  });

  it('maps Cyrillic look-alike letters to Latin and reports the correction', () => {
    // «С01ВА» below is typed with Cyrillic С, В and А.
    expect(normalizeAtcCode('С01ВА')).toEqual({ code: 'C01BA', level: 4, corrected: true });
    expect(normalizeAtcCode('М01АЕ01')).toEqual({ code: 'M01AE01', level: 5, corrected: true });
    expect(normalizeAtcCode('n06bx')).toEqual({ code: 'N06BX', level: 4, corrected: true });
    expect(normalizeAtcCode('J01CR02')?.corrected).toBe(false);
  });

  it('drops spaces and soft hyphens inside the code', () => {
    expect(normalizeAtcCode(' N06 BX­03 ')?.code).toBe('N06BX03');
  });

  it('rejects the registry placeholder and non-codes', () => {
    expect(normalizeAtcCode('~')).toBeNull();
    expect(normalizeAtcCode('')).toBeNull();
    expect(normalizeAtcCode('N0')).toBeNull();
    expect(normalizeAtcCode('N06BX0')).toBeNull();
    expect(normalizeAtcCode('Z99')).toBeNull();
    expect(normalizeAtcCode('Актитропил')).toBeNull();
  });
});

describe('atcPrefixes', () => {
  it('lists the code level by level', () => {
    expect(atcPrefixes('N06BX03').map((step) => step.code)).toEqual([
      'N',
      'N06',
      'N06B',
      'N06BX',
      'N06BX03',
    ]);
    expect(atcPrefixes('N06BX').map((step) => step.code)).toEqual(['N', 'N06', 'N06B', 'N06BX']);
  });
});

describe('atcGroupChain', () => {
  it('splits the ЕСКЛП group text on semicolons', () => {
    expect(atcGroupChain('а; б ;в')).toEqual(['а', 'б', 'в']);
    expect(atcGroupChain(null)).toEqual([]);
    expect(atcGroupChain('~')).toEqual([]);
  });
});

describe('atcLadder', () => {
  const chain =
    'противовирусные препараты системного действия; противовирусные препараты прямого действия; другие противовирусные препараты';

  it('names levels 2-4 from a three-entry group chain on a level-4 code', () => {
    const steps = atcLadder({ code: code('J05AX'), groupText: chain });
    expect(steps.map((step) => step.code)).toEqual(['J', 'J05', 'J05A', 'J05AX', null]);
    expect(steps[0]?.name).toBe('Противоинфекционные препараты системного действия');
    expect(steps[0]?.nameSource).toBe('minimed-taxonomy');
    expect(steps[1]?.name).toBe('Противовирусные препараты системного действия');
    expect(steps[2]?.name).toBe('Противовирусные препараты прямого действия');
    expect(steps[3]?.name).toBe('Другие противовирусные препараты');
    expect(steps[3]?.nameSource).toBe('esklp-group-text');
    expect(steps[4]).toMatchObject({ code: null, name: null, nameSource: null });
  });

  it('takes the level-5 name from the node substance', () => {
    const steps = atcLadder({
      code: code('A07BA01'),
      groupText: null,
      substanceName: 'Активированный уголь',
    });
    expect(steps[4]).toMatchObject({
      code: 'A07BA01',
      name: 'Активированный уголь',
      nameSource: 'esklp-substance',
    });
  });

  it('does not guess names for a free-text group or an ambiguous chain', () => {
    const free = atcLadder({ code: code('N06BX'), groupText: 'ноотропное средство' });
    expect(free.slice(1, 4).map((step) => step.name)).toEqual([null, null, null]);
    expect(free[0]?.name).toBe('Нервная система');
    const two = atcLadder({
      code: code('A02AX'),
      groupText: 'препараты для лечения заболеваний; антациды',
    });
    expect(two.slice(1, 4).map((step) => step.name)).toEqual([null, null, null]);
    // A chain of three entries on a code that stops at level 3 does not align with the levels.
    const short = atcLadder({
      code: code('J07B'),
      groupText: 'МИБП-вакцины; вирусные вакцины; вакцины против COVID-19',
    });
    expect(short.slice(1, 3).map((step) => step.name)).toEqual([null, null]);
  });

  it('keeps the structure of a level-1 code and marks the rest as absent', () => {
    const steps = atcLadder({ code: code('N') });
    expect(steps.map((step) => step.code)).toEqual(['N', null, null, null, null]);
  });
});

describe('atcLadder with the NSI catalog', () => {
  const catalog = {
    source: 'НСИ Минздрава, справочник АТХ',
    version: '3.8',
    publishDate: '2025-07-15',
    names: {
      J: 'Противомикробные препараты системного действия',
      J05: 'Противовирусные препараты системного действия',
      J05A: 'Противовирусные препараты прямого действия',
      J05AX: 'Прочие противовирусные препараты',
    },
  };

  it('names levels 1-4 from the catalog and prefers it over the older sources', () => {
    const steps = atcLadder({
      code: code('J05AX'),
      catalog,
      groupText: 'а; б; в',
      substanceName: 'Ингибиторы',
    });
    expect(steps.slice(0, 4).map((step) => step.name)).toEqual(Object.values(catalog.names));
    expect(steps.slice(0, 4).map((step) => step.nameSource)).toEqual(Array(4).fill('nsi-atc'));
  });

  it('keeps the older sources where the catalog has no such code and never names level 5 from it', () => {
    const steps = atcLadder({
      code: code('J05AX09'),
      catalog: { ...catalog, names: { J: catalog.names.J, J05AX09: 'не должно использоваться' } },
      groupText: null,
      substanceName: 'Маравирок',
    });
    expect(steps[0]?.nameSource).toBe('nsi-atc');
    expect(steps[1]).toMatchObject({ code: 'J05', name: null, nameSource: null });
    expect(steps[4]).toMatchObject({ name: 'Маравирок', nameSource: 'esklp-substance' });
    const taxonomyOnly = atcLadder({ code: code('N'), catalog });
    expect(taxonomyOnly[0]).toMatchObject({
      name: 'Нервная система',
      nameSource: 'minimed-taxonomy',
    });
  });

  it('finds the names for a code typed with Cyrillic look-alikes', () => {
    // «J05АХ» below has Cyrillic А and Х.
    const steps = atcLadder({ code: code('J05АХ'), catalog });
    expect(steps[3]).toMatchObject({ code: 'J05AX', name: catalog.names.J05AX });
  });

  it('cites the dictionary version and date', () => {
    expect(atcCatalogCitation(catalog)).toBe(
      'НСИ Минздрава, справочник АТХ, версия 3.8 от 15.07.2025',
    );
  });
});

describe('level-1 headings', () => {
  it('match the module titles of the medication taxonomy', () => {
    const taxonomy = readFileSync(
      fileURLToPath(
        new URL('../../../../../content/medication-module-taxonomy.yaml', import.meta.url),
      ),
      'utf8',
    );
    const found = new Map<string, string>();
    for (const block of taxonomy.split('  - id:').slice(1)) {
      const title = /title: (.+)/u.exec(block)?.[1]?.trim();
      const prefix = /atcPrefixes: \[([A-Z])\]/u.exec(block)?.[1];
      if (title && prefix) found.set(prefix, title);
    }
    expect(Object.fromEntries(found)).toEqual(ATC_ANATOMICAL_GROUPS);
  });
});
