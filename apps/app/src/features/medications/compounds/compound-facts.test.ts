import { describe, expect, it } from 'vitest';

import {
  buildCompoundIndex,
  type CompoundFacts,
  type CompoundRecord,
  loadCompoundFacts,
  lookupCompound,
  lookupCompoundByText,
  lookupCompoundsByAtc,
  normalizeCompoundName,
  parseCompoundFacts,
} from './compound-facts';

const COMPACT = {
  schemaVersion: 1,
  retrieved: '2026-11-03',
  sources: [{ id: 'wikidata', label: 'Wikidata', licence: 'CC0 1.0', url: 'https://wikidata.org' }],
  roleLabels: ['гипогликемическое средство'],
  functionLabels: ['смазывающее вещество', 'наполнитель'],
  actionLabels: ['блокатор'],
  targetTable: [['Sulfonylurea receptor 1, Kir6.2', 'KCNJ11/ABCC8']],
  tokenAliases: { ароматизатор: 'flavouring' },
  compounds: {
    glimepiride: {
      ru: 'глимепирид',
      smiles: 'CCC1=C(CN(C1=O)C(=O)NCCC2=CC=C(C=C2)S(=O)(=O)NC(=O)NC3CCC(CC3)C)C',
      formula: 'C24H34N4O5S',
      atc: ['A10BB12'],
      roles: [0],
      targets: [[0, 0]],
      wd: 106029845,
      chebi: 5383,
      chembl: 1481,
    },
    metformin: { ru: 'метформин', atc: ['A10BA02'], basis: 'm' },
    'magnesium-stearate': {
      ru: 'магния стеарат',
      kind: 'excipient',
      functions: [0],
      wd: 416713,
      cid: 11177,
    },
    lactose: { ru: 'лактоза', kind: 'excipient', functions: [1, 0], en: 'lactose' },
    flavouring: { ru: 'ароматизатор', kind: 'excipient', functions: [1] },
  },
  aliases: { 'лактоз сахар': 'lactose', 'молочн сахар': 'lactose' },
};

const index = () => buildCompoundIndex(parseCompoundFacts(structuredClone(COMPACT)));

const recordOf = (facts: CompoundFacts, key: string): CompoundRecord | undefined =>
  facts.compounds[key];

describe('parseCompoundFacts', () => {
  it('expands the compact chunk into records', () => {
    const facts = parseCompoundFacts(structuredClone(COMPACT));
    const glimepiride = recordOf(facts, 'glimepiride');
    expect(glimepiride).toEqual({
      ru: 'глимепирид',
      en: 'glimepiride',
      kind: 'active',
      basis: 'chebi',
      smiles: expect.stringContaining('CCC1='),
      formula: 'C24H34N4O5S',
      atc: ['A10BB12'],
      roles: ['гипогликемическое средство'],
      targets: ['блокатор: Sulfonylurea receptor 1, Kir6.2 (KCNJ11/ABCC8)'],
      wd: 'Q106029845',
      chebi: 'CHEBI:5383',
      chembl: 'CHEMBL1481',
    });
    expect(recordOf(facts, 'magnesium-stearate')).toMatchObject({
      kind: 'excipient',
      basis: 'curated',
      en: 'magnesium stearate',
      functions: ['смазывающее вещество'],
      cid: 11177,
    });
    expect(recordOf(facts, 'metformin')?.basis).toBe('chembl');
  });

  it('rejects a malformed chunk instead of returning an empty one', () => {
    const broken = (path: string[], value: unknown) => () => {
      const copy = structuredClone(COMPACT) as Record<string, unknown>;
      let node = copy;
      for (const step of path.slice(0, -1)) node = node[step] as Record<string, unknown>;
      node[path.at(-1) as string] = value;
      return parseCompoundFacts(copy);
    };
    expect(() => parseCompoundFacts(null)).toThrow(/object/u);
    expect(broken(['schemaVersion'], 2)).toThrow(/schemaVersion/u);
    expect(broken(['retrieved'], 'yesterday')).toThrow(/retrieved/u);
    expect(broken(['compounds', 'glimepiride', 'roles'], [5])).toThrow(/label table/u);
    expect(broken(['compounds', 'glimepiride', 'atc'], ['A10BB'])).toThrow(/ATC/u);
    expect(broken(['compounds', 'glimepiride', 'smiles'], 'C C')).toThrow(/SMILES/u);
    expect(broken(['compounds', 'glimepiride', 'wd'], -1)).toThrow(/integer/u);
    expect(broken(['compounds', 'metformin', 'basis'], 'x')).toThrow(/basis/u);
    expect(broken(['compounds', 'metformin', 'kind'], 'drug')).toThrow(/kind/u);
    expect(broken(['aliases', 'x'], 'missing')).toThrow(/aliases/u);
    expect(broken(['tokenAliases', 'x'], 'missing')).toThrow(/tokenAliases/u);
    expect(broken(['targetTable'], 'nope')).toThrow(/targetTable/u);
  });
});

describe('lookups', () => {
  it('find a compound by every spelling of its name', () => {
    const found = index();
    expect(lookupCompound(found, 'Глимепирид')?.key).toBe('glimepiride');
    expect(lookupCompound(found, 'glimepiride')?.key).toBe('glimepiride');
    expect(lookupCompound(found, 'стеарат магния')?.key).toBe('magnesium-stearate');
    expect(lookupCompound(found, 'лактозы моногидрат')?.key).toBe('lactose');
    expect(lookupCompound(found, 'лактоза безводная')?.key).toBe('lactose');
    expect(lookupCompound(found, 'Молочный сахар')?.key).toBe('lactose');
    expect(lookupCompound(found, 'неизвестное вещество')).toBeUndefined();
    expect(lookupCompound(found, '')).toBeUndefined();
  });

  it('strips salt words only for active substances', () => {
    const found = index();
    expect(lookupCompound(found, 'метформина гидрохлорид')?.key).toBe('metformin');
    expect(lookupCompound(found, 'глимепирид натрия')?.key).toBe('glimepiride');
    // «стеарат магния» is an excipient: a salt word must not turn it into something else.
    expect(lookupCompound(found, 'кальция стеарат')).toBeUndefined();
  });

  it('maps a family named by one word', () => {
    expect(lookupCompound(index(), 'ароматизатор клубничный')?.key).toBe('flavouring');
  });

  it('tries the brackets of a text as names of their own', () => {
    expect(lookupCompoundByText(index(), 'сахар молочный')?.key).toBe('lactose');
    expect(lookupCompoundByText(index(), 'твин (магния стеарат)')?.key).toBe('magnesium-stearate');
  });

  it('find compounds by level-5 ATC code', () => {
    const found = index();
    expect(lookupCompoundsByAtc(found, 'a10bb12').map((hit) => hit.key)).toEqual(['glimepiride']);
    expect(lookupCompoundsByAtc(found, 'A10BB')).toEqual([]);
  });
});

describe('the bundled chunk', () => {
  it('loads once and validates', async () => {
    const found = await loadCompoundFacts();
    expect(await loadCompoundFacts()).toBe(found);
    const facts: CompoundFacts = found.facts;
    expect(facts.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(facts.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(['wikidata', 'chebi', 'chembl', 'curated']),
    );
    for (const source of facts.sources) {
      expect(source.licence, source.id).toBeTruthy();
    }
    expect(Object.keys(facts.compounds).length).toBeGreaterThan(1000);
  });

  it('describes glimepiride by structure, ATC code and mechanism', async () => {
    const found = await loadCompoundFacts();
    const byName = lookupCompound(found, 'глимепирид');
    expect(byName?.smiles).toContain('S(=O)(=O)');
    expect(byName?.formula).toBe('C24H34N4O5S');
    expect(byName?.roles).toContain('гипогликемическое средство');
    expect(byName?.targets?.some((target) => target.includes('ABCC8'))).toBe(true);
    expect(lookupCompoundsByAtc(found, 'A10BB12').map((hit) => hit.key)).toContain(byName?.key);
  });

  it('knows the excipients of a tablet and what each does', async () => {
    const found = await loadCompoundFacts();
    const functionsOf = (name: string) => lookupCompound(found, name)?.functions ?? [];
    expect(functionsOf('лактозы моногидрат')).toContain('наполнитель');
    expect(functionsOf('магния стеарат')).toContain('смазывающее вещество');
    expect(functionsOf('натрия лаурилсульфат')).toContain('поверхностно-активное вещество');
    expect(functionsOf('кроскармеллоза натрия')).toContain('разрыхлитель');
    expect(functionsOf('кремния диоксид коллоидный')).toContain('скользящее вещество');
    expect(functionsOf('титана диоксид (Е 171)')).toContain('краситель');
    expect(functionsOf('целлюлоза микрокристаллическая')).toContain('наполнитель');
    expect(lookupCompound(found, 'магния стеарат')?.smiles).toContain('[Mg+2]');
  });

  it('keeps provenance and honest bases on every record', async () => {
    const { facts } = await loadCompoundFacts();
    for (const [key, record] of Object.entries(facts.compounds)) {
      if (record.kind !== 'active') {
        expect(record.functions?.length, key).toBeGreaterThan(0);
      }
      if (record.kind !== 'excipient') {
        expect(record.wd ?? record.chebi ?? record.chembl, key).toBeTruthy();
      }
      // A reviewed-glossary function must say so: only a source-backed record may claim a database.
      if (record.kind === 'excipient' && record.basis !== 'curated') {
        expect(record.wd ?? record.chebi, key).toBeTruthy();
      }
    }
    expect(normalizeCompoundName('магния стеарат')).toBe(normalizeCompoundName('стеарат магния'));
  });
});
