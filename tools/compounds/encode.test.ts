import { describe, expect, it } from 'vitest';

import {
  type CompoundFacts,
  type CompoundRecord,
  parseCompoundFacts,
} from '../../apps/app/src/features/medications/compounds/compound-facts';
import { type BuildFacts, encodeCompoundFacts } from './encode';

const facts: BuildFacts = {
  schemaVersion: 1,
  retrieved: '2026-11-03',
  sources: [{ id: 'wikidata', label: 'Wikidata', licence: 'CC0 1.0', url: 'https://wikidata.org' }],
  compounds: {
    glimepiride: {
      ru: 'глимепирид',
      en: 'glimepiride',
      kind: 'active',
      smiles: 'CCC1=C(CN(C1=O)C(=O)N)C',
      formula: 'C24H34N4O5S',
      atc: ['A10BB12'],
      roles: ['гипогликемическое средство', 'стимулятор секреции инсулина'],
      targets: [
        { n: 'Sulfonylurea receptor 1, Kir6.2', g: 'KCNJ11/ABCC8', a: 'блокатор' },
        { n: 'Some protein' },
      ],
      basis: 'chebi',
      wd: 'Q106029845',
      chebi: 'CHEBI:5383',
      cid: 3476,
      chembl: 'CHEMBL1481',
    },
    'polyethylene-glycol': {
      ru: 'макрогол',
      en: 'polyethylene glycol',
      kind: 'both',
      functions: ['пластификатор', 'растворитель'],
      basis: 'curated',
    },
    'magnesium-stearate': {
      ru: 'магния стеарат',
      en: 'magnesium stearate',
      kind: 'excipient',
      functions: ['смазывающее вещество'],
      basis: 'wikidata',
    },
  },
  aliases: { пэг: 'polyethylene-glycol' },
  tokenAliases: {},
};

const recordOf = (facts: CompoundFacts, key: string): CompoundRecord | undefined =>
  facts.compounds[key];

describe('encodeCompoundFacts', () => {
  it('round-trips through parseCompoundFacts', () => {
    const text = encodeCompoundFacts(facts);
    const parsed = parseCompoundFacts(JSON.parse(text));
    expect(recordOf(parsed, 'glimepiride')).toMatchObject({
      ru: 'глимепирид',
      en: 'glimepiride',
      kind: 'active',
      basis: 'chebi',
      atc: ['A10BB12'],
      roles: ['гипогликемическое средство', 'стимулятор секреции инсулина'],
      targets: ['блокатор: Sulfonylurea receptor 1, Kir6.2 (KCNJ11/ABCC8)', 'Some protein'],
      wd: 'Q106029845',
      chebi: 'CHEBI:5383',
      cid: 3476,
      chembl: 'CHEMBL1481',
    });
    expect(recordOf(parsed, 'polyethylene-glycol')).toMatchObject({
      kind: 'both',
      basis: 'curated',
      functions: ['пластификатор', 'растворитель'],
    });
    expect(recordOf(parsed, 'magnesium-stearate')?.basis).toBe('wikidata');
    expect(parsed.aliases).toEqual({ пэг: 'polyethylene-glycol' });
  });

  it('leaves out defaults, shares labels and writes one compound per line', () => {
    const text = encodeCompoundFacts(facts);
    expect(text).not.toContain('"kind":"active"');
    expect(text).not.toContain('"basis":"c"'); // the default of an active
    expect(text).toContain('"basis":"w"'); // an excipient that a source backs
    expect(text).toContain('"wd":106029845');
    expect(text.match(/Sulfonylurea receptor/gu)).toHaveLength(1);
    expect(text.split('\n').filter((line) => line.startsWith('"glimepiride"'))).toHaveLength(1);
    expect(text).not.toContain('"en":"glimepiride"');
  });
});
