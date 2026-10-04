import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  type AtcSubstance,
  atcGroupModuleId,
  atcLevelOneGroups,
  atcSubstanceFromDocument,
  buildAtcTree,
  subgroupCountLabel,
  substanceCountLabel,
} from '@/features/medications/atc-tree';
import { atcCrumbCodes, atcParentCode } from '@/features/medications/medication-routing';

const NAMES = {
  N: 'Нервная система',
  N06: 'Психоаналептики',
  N06B: 'Психостимуляторы и ноотропные препараты',
  N06BX: 'Другие психостимуляторы и ноотропные препараты',
  N02: 'Анальгетики',
  N02B: 'Другие анальгетики и антипиретики',
  N02BE: 'Анилиды',
};

function substance(id: string, name: string, codes: readonly string[]): AtcSubstance {
  return { documentId: `esklp.mnn.${id}`, name, codes };
}

describe('buildAtcTree', () => {
  const tree = buildAtcTree(
    [
      substance('a', 'Пирацетам', ['N06BX03']),
      substance('b', 'Глицин', ['N06BX']),
      substance('c', 'Парацетамол', ['N02BE01']),
      substance('d', 'Кофеин', ['N06BC01', 'N06BX03']),
      substance('e', 'Мёд', []),
    ],
    NAMES,
  );

  it('counts distinct substances at every node', () => {
    expect(tree.nodes.get('N')?.substanceCount).toBe(4);
    expect(tree.nodes.get('N06')?.substanceCount).toBe(3);
    expect(tree.nodes.get('N06B')?.substanceCount).toBe(3);
    expect(tree.nodes.get('N06BX')?.substanceCount).toBe(3);
    expect(tree.nodes.get('N06BC')?.substanceCount).toBe(1);
    expect(tree.nodes.get('N02BE')?.substanceCount).toBe(1);
  });

  it('names the nodes from the dictionary and links them to their parents', () => {
    const level4 = tree.nodes.get('N06BX');
    expect(level4?.name).toBe('Другие психостимуляторы и ноотропные препараты');
    expect(level4?.level).toBe(4);
    expect(level4?.parentCode).toBe('N06B');
    expect(tree.nodes.get('N')?.children.map((node) => node.code)).toEqual(['N02', 'N06']);
    // A level the dictionary does not name stays unnamed instead of being invented.
    expect(tree.nodes.get('N06BC')?.name).toBeNull();
  });

  it('places substances at the deepest group of their code, sorted by name, with full codes', () => {
    const entries = tree.nodes.get('N06BX')?.entries ?? [];
    expect(entries.map((entry) => entry.substance.name)).toEqual(['Глицин', 'Кофеин', 'Пирацетам']);
    expect(entries.find((entry) => entry.substance.name === 'Пирацетам')?.codes).toEqual([
      'N06BX03',
    ]);
    expect(tree.nodes.get('N06B')?.entries).toEqual([]);
  });

  it('collects substances without a code in a synthetic closing group', () => {
    expect(tree.roots.map((node) => node.code)).toEqual(['N', 'none']);
    const none = tree.nodes.get('none');
    expect(none?.name).toBe('Без кода АТХ');
    expect(none?.entries.map((entry) => entry.substance.name)).toEqual(['Мёд']);
    expect(none?.substanceCount).toBe(1);
  });

  it('normalises Cyrillic look-alikes and drops values that are not ATC codes', () => {
    const result = buildAtcTree(
      [substance('x', 'Амлодипин', ['С08СА01']), substance('y', 'Прочее', ['~', ''])],
      {},
    );
    expect(result.nodes.get('C08CA')?.entries.map((entry) => entry.codes)).toEqual([['C08CA01']]);
    expect(result.nodes.get('C')?.name).toBe('Сердечно-сосудистая система');
    expect(result.nodes.get('none')?.substanceCount).toBe(1);
  });

  it('is empty without substances', () => {
    expect(buildAtcTree([], NAMES).roots).toEqual([]);
  });
});

describe('atcSubstanceFromDocument', () => {
  const base = {
    id: 'esklp.mnn.амлодипин',
    title: 'Амлодипин — МНН',
  };

  it('reads the standardized name and the normalised codes of an ЕСКЛП МНН document', () => {
    const document = {
      ...base,
      metadata: {
        contentMode: 'esklp-mnn',
        standardizedInn: 'АМЛОДИПИН',
        smnnNodes: [{ atcCode: 'С08СА01' }, { atcCode: 'C08CA01' }, { atcCode: '~' }],
      },
    } as unknown as MedicalDocument;
    expect(atcSubstanceFromDocument(document)).toEqual({
      documentId: 'esklp.mnn.амлодипин',
      name: 'Амлодипин',
      codes: ['C08CA01'],
    });
  });

  it('ignores documents that are not МНН cards', () => {
    const document = { ...base, metadata: { contentMode: 'registry-normalized' } };
    expect(atcSubstanceFromDocument(document as unknown as MedicalDocument)).toBeNull();
  });
});

describe('level-1 groups', () => {
  it('lists all 14 anatomical groups with dictionary names and their module ids', () => {
    const groups = atcLevelOneGroups(NAMES);
    expect(groups).toHaveLength(14);
    expect(groups.map((group) => group.code).join('')).toBe('ABCDGHJLMNPRSV');
    expect(groups.find((group) => group.code === 'N')).toEqual({
      code: 'N',
      name: 'Нервная система',
      moduleId: 'minimed.medications.nervous-system.ru',
    });
    // Without the dictionary the taxonomy headings name the groups.
    expect(atcLevelOneGroups({}).find((group) => group.code === 'B')?.name).toBe(
      'Кровь и кроветворение',
    );
  });

  it('points every group at a released medication module of the catalog', () => {
    const catalog = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../modules/catalog.preview.json'), 'utf8'),
    ) as { modules: { id: string; kind: string }[] };
    const ids = new Set(
      catalog.modules.filter((module) => module.kind === 'medication').map((module) => module.id),
    );
    for (const group of atcLevelOneGroups({})) expect(ids.has(group.moduleId)).toBe(true);
    expect(atcGroupModuleId('N06BX')).toBe('minimed.medications.nervous-system.ru');
    expect(atcGroupModuleId('none')).toBeNull();
  });
});

describe('navigation helpers', () => {
  it('lists the way down to a node and its parent', () => {
    expect(atcCrumbCodes('N06BX')).toEqual(['N', 'N06', 'N06B', 'N06BX']);
    expect(atcCrumbCodes('N')).toEqual(['N']);
    expect(atcParentCode('N06BX')).toBe('N06B');
    expect(atcParentCode('N')).toBeNull();
    expect(atcParentCode('none')).toBeNull();
  });

  it('declines the counters', () => {
    expect(substanceCountLabel(1)).toBe('1 вещество');
    expect(substanceCountLabel(3)).toBe('3 вещества');
    expect(substanceCountLabel(12)).toBe('12 веществ');
    expect(substanceCountLabel(21)).toBe('21 вещество');
    expect(substanceCountLabel(0)).toBe('0 веществ');
    expect(subgroupCountLabel(1)).toBe('1 подгруппа');
    expect(subgroupCountLabel(2)).toBe('2 подгруппы');
    expect(subgroupCountLabel(5)).toBe('5 подгрупп');
  });
});
