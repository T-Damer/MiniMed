import { describe, expect, it } from 'vitest';

import {
  type AtcClassAddition,
  additionEvidenceHolds,
  consensusCodeOf,
  normalizeQuote,
  parseAtcClassAdditions,
  parseAtcCodeExceptions,
  redundantSecondary,
  selectAtcCodes,
  selectAtcCodesOfMetadata,
} from './atc-codes';

const CARD = 'esklp.mnn.umifenovir';

describe('the ATC codes an interaction card carries (ATC4)', () => {
  it('takes the registry code, a filled code and a refined stub as they stand', () => {
    const selection = selectAtcCodes(CARD, [
      { atcCode: 'N06AB06' },
      { atcCode: 'A01AD11', atcOriginal: '~' },
      { atcCode: 'A05BA01', atcOriginal: 'A05BA' },
    ]);
    expect(selection.codes).toEqual(['A01AD11', 'A05BA01', 'N06AB06']);
    expect(selection.origins['N06AB06']).toEqual(['registry']);
    expect(selection.origins['A01AD11']).toEqual(['completed']);
    expect(selection.origins['A05BA01']).toEqual(['completed']);
  });

  it('ignores the placeholder «~» and anything that is not an ATC code', () => {
    const selection = selectAtcCodes(CARD, [
      { atcCode: '~' },
      { atcCode: null },
      { atcCode: 'без АТХ' },
      { atcCode: 'j05ax' },
      {},
    ]);
    expect(selection.codes).toEqual([]);
  });

  it('keeps level 1–5 codes and rejects the in-between shapes', () => {
    const selection = selectAtcCodes(CARD, [
      { atcCode: 'J' },
      { atcCode: 'J05' },
      { atcCode: 'J05A' },
      { atcCode: 'J05AX' },
      { atcCode: 'J05AX13' },
      { atcCode: 'J05AX1' },
      { atcCode: 'J05AX133' },
    ]);
    expect(selection.codes).toEqual(['J', 'J05', 'J05A', 'J05AX', 'J05AX13']);
  });

  describe('conflicts and unconfirmed codes', () => {
    it('never take a candidate of a flagged node, only the registry value', () => {
      const selection = selectAtcCodes('esklp.mnn.methyldopa', [
        {
          atcCode: 'C02AB01',
          atcFlag: 'conflict',
          atcCandidates: [{ code: 'C02AB02', sources: ['instruction-text'] }],
        } as never,
        { atcCode: 'J07B', atcFlag: 'unconfirmed' },
        { atcCode: '~', atcFlag: 'unconfirmed' },
      ]);
      expect(selection.codes).toEqual(['C02AB01', 'J07B']);
    });

    it('falls back to the registry value should a flagged node have been changed', () => {
      const selection = selectAtcCodes(CARD, [
        { atcCode: 'J05AX13', atcOriginal: 'L03AX', atcFlag: 'conflict' },
      ]);
      expect(selection.codes).toEqual(['L03AX']);
    });

    it('does not read a consensus from a node that is not a conflict', () => {
      expect(
        consensusCodeOf({
          atcCode: 'L03AX',
          atcConsensus: { code: 'J05AX13', sources: ['same-inn', 'instruction-text'] },
        }),
      ).toBeNull();
    });
  });

  describe('a consensus against a registry stub (ATC3: both codes)', () => {
    const stub = {
      atcCode: 'L03AX',
      atcFlag: 'conflict',
      atcConsensus: { code: 'J05AX13', sources: ['same-inn', 'instruction-text'] },
    };

    it('carries the stub and the agreed substance code', () => {
      const selection = selectAtcCodes(CARD, [stub]);
      expect(selection.codes).toEqual(['J05AX13', 'L03AX']);
      expect(selection.origins['J05AX13']).toEqual(['consensus']);
      expect(selection.origins['L03AX']).toEqual(['registry']);
    });

    it('wants a substance code and two sources', () => {
      expect(
        consensusCodeOf({ ...stub, atcConsensus: { code: 'J05AX', sources: ['a', 'b'] } }),
      ).toBeNull();
      expect(
        consensusCodeOf({ ...stub, atcConsensus: { code: 'J05AX13', sources: ['a'] } }),
      ).toBeNull();
      expect(consensusCodeOf({ ...stub, atcConsensus: 'J05AX13' })).toBeNull();
      expect(consensusCodeOf(stub)).toBe('J05AX13');
    });

    it('adds a consensus code of one node next to the codes of the others', () => {
      const selection = selectAtcCodes('esklp.mnn.sildenafil', [
        { atcCode: 'G04BE03', atcOriginal: 'G04BE' },
        {
          atcCode: 'C02KX',
          atcFlag: 'conflict',
          atcConsensus: { code: 'G04BE03', sources: ['same-inn', 'instruction-text'] },
        },
      ]);
      expect(selection.codes).toEqual(['C02KX', 'G04BE03']);
      expect(selection.origins['G04BE03']).toEqual(['completed', 'consensus']);
    });
  });

  describe('declared exceptions', () => {
    const exceptions = [
      {
        card: 'esklp.mnn.a',
        code: 'L03AB',
        reason: 'a topical form, systemic class sentences do not apply',
        review: 'docs/research/x.json',
      },
    ];

    it('remove the code of that card and say why', () => {
      const nodes = [{ atcCode: 'L03AB' }, { atcCode: 'R05CA' }];
      const selection = selectAtcCodes('esklp.mnn.a', nodes, exceptions);
      expect(selection.codes).toEqual(['R05CA']);
      expect(selection.excluded).toEqual([
        { code: 'L03AB', reason: 'a topical form, systemic class sentences do not apply' },
      ]);
      expect(Object.keys(selection.origins)).toEqual(['R05CA']);
    });

    it('leave every other card and every other code alone', () => {
      expect(selectAtcCodes('esklp.mnn.b', [{ atcCode: 'L03AB' }], exceptions).codes).toEqual([
        'L03AB',
      ]);
      expect(selectAtcCodes('esklp.mnn.a', [{ atcCode: 'L03AA' }], exceptions).codes).toEqual([
        'L03AA',
      ]);
    });
  });

  describe('declared class additions', () => {
    const additions: readonly AtcClassAddition[] = [
      {
        card: 'esklp.mnn.cold',
        role: 'primary',
        classes: ['R05D'],
        reason: 'the instruction says the dextromethorphan in it suppresses cough',
        evidence: {
          document: 'drug.rf.x.instruction',
          section: 'Показания',
          quote: 'Декстрометорфан уменьшает кашель, вызванный раздражением горла.',
        },
        review: 'docs/research/x.json',
      },
    ];

    it('add the class to that card, beside its own codes, and mark the origin', () => {
      const selection = selectAtcCodes('esklp.mnn.cold', [{ atcCode: 'R05X' }], [], additions);
      expect(selection.codes).toEqual(['R05D', 'R05X']);
      expect(selection.added).toEqual(['R05D']);
      expect(selection.origins['R05D']).toEqual(['declared']);
      expect(selection.origins['R05X']).toEqual(['registry']);
    });

    it('leave every other card alone and add nothing the card already has', () => {
      expect(selectAtcCodes('esklp.mnn.other', [{ atcCode: 'R05X' }], [], additions).codes).toEqual(
        ['R05X'],
      );
      const already = selectAtcCodes(
        'esklp.mnn.cold',
        [{ atcCode: 'R05DA09' }, { atcCode: 'R05D' }],
        [],
        additions,
      );
      expect(already.added).toEqual([]);
      expect(already.codes).toEqual(['R05D', 'R05DA09']);
    });

    it('are not removed by an exception of the same card', () => {
      const exceptions = [
        {
          card: 'esklp.mnn.cold',
          code: 'R05X',
          reason: 'declared wrong for this card',
          review: 'r',
        },
      ];
      const selection = selectAtcCodes(
        'esklp.mnn.cold',
        [{ atcCode: 'R05X' }],
        exceptions,
        additions,
      );
      expect(selection.codes).toEqual(['R05D']);
    });

    it('keep a secondary class apart from the codes, with the component that brings it', () => {
      const secondary: readonly AtcClassAddition[] = [
        {
          ...(additions[0] as AtcClassAddition),
          role: 'secondary',
          classes: ['N05CB'],
          via: 'фенобарбитал',
          label: 'снотворное',
        },
      ];
      const selection = selectAtcCodes('esklp.mnn.cold', [{ atcCode: 'N05CM' }], [], secondary);
      expect(selection.codes).toEqual(['N05CM']);
      expect(selection.added).toEqual([]);
      expect(selection.secondary).toEqual([
        { code: 'N05CB', via: 'фенобарбитал', label: 'снотворное' },
      ]);
      expect(redundantSecondary(selection)).toEqual([]);
      // the same class under another card changes nothing there
      expect(
        selectAtcCodes('esklp.mnn.other', [{ atcCode: 'N05CM' }], [], secondary).secondary,
      ).toEqual([]);
    });

    it('find a secondary class the card’s own codes already cover', () => {
      const secondary: readonly AtcClassAddition[] = [
        {
          ...(additions[0] as AtcClassAddition),
          role: 'secondary',
          classes: ['N05CB'],
          via: 'фенобарбитал',
          label: 'снотворное',
        },
      ];
      const selection = selectAtcCodes('esklp.mnn.cold', [{ atcCode: 'N05CB02' }], [], secondary);
      expect(redundantSecondary(selection).map((item) => item.code)).toEqual(['N05CB']);
    });

    it('are read from the metadata call as well', () => {
      expect(
        selectAtcCodesOfMetadata(
          'esklp.mnn.cold',
          { smnnNodes: [{ atcCode: 'R05X' }] },
          [],
          additions,
        ).codes,
      ).toEqual(['R05D', 'R05X']);
    });
  });

  it('reads the nodes of a card’s metadata, none when it has no nodes', () => {
    expect(
      selectAtcCodesOfMetadata('esklp.mnn.a', { smnnNodes: [{ atcCode: 'N02BG' }] }).codes,
    ).toEqual(['N02BG']);
    expect(selectAtcCodesOfMetadata('esklp.mnn.a', { atcCodes: ['N02BG'] }).codes).toEqual([]);
  });
});

describe('the exception file', () => {
  const valid = {
    card: 'esklp.mnn.a',
    code: 'L03AB',
    reason: 'a topical form, systemic class sentences do not apply',
    review: 'docs/research/x.json',
  };

  it('is read when every entry names a card, an ATC code, a reason and its review', () => {
    expect(parseAtcCodeExceptions({ exceptions: [valid] })).toEqual([valid]);
  });

  it('refuses an entry that cannot be audited', () => {
    expect(() => parseAtcCodeExceptions({})).toThrow('exceptions');
    expect(() => parseAtcCodeExceptions({ exceptions: [{ ...valid, card: 'drug.rf.x' }] })).toThrow(
      'esklp.mnn',
    );
    expect(() =>
      parseAtcCodeExceptions({ exceptions: [{ ...valid, code: 'L03' + 'Z9' }] }),
    ).toThrow('ATC code');
    expect(() => parseAtcCodeExceptions({ exceptions: [{ ...valid, reason: 'no' }] })).toThrow(
      'reason',
    );
    expect(() => parseAtcCodeExceptions({ exceptions: [{ ...valid, review: '' }] })).toThrow(
      'review',
    );
  });
});

describe('the class additions file', () => {
  const valid = {
    card: 'esklp.mnn.a',
    role: 'primary',
    classes: ['R05D'],
    reason: 'the instruction says it suppresses cough',
    evidence: {
      document: 'drug.rf.x.instruction',
      section: 'Показания',
      quote: 'Декстрометорфан уменьшает кашель, вызванный раздражением горла.',
    },
    review: 'docs/research/x.json',
  };
  const parse = (item: unknown) => parseAtcClassAdditions({ addClasses: [item] });

  it('reads a valid list, and no list as no additions', () => {
    expect(parse(valid)).toEqual([valid]);
    expect(parseAtcClassAdditions({ exceptions: [] })).toEqual([]);
  });

  it('refuses an addition without the reasons, the evidence or a group code', () => {
    expect(() => parse({ ...valid, card: 'a' })).toThrow(/esklp\.mnn/u);
    expect(() => parse({ ...valid, classes: [] })).toThrow(/group codes/u);
    expect(() => parse({ ...valid, classes: ['R05DA09'] })).toThrow(/group codes/u);
    expect(() => parse({ ...valid, classes: ['R'] })).toThrow(/group codes/u);
    expect(() => parse({ ...valid, reason: 'x' })).toThrow(/reason/u);
    expect(() => parse({ ...valid, evidence: undefined })).toThrow(/evidence/u);
    expect(() => parse({ ...valid, evidence: { ...valid.evidence, quote: 'short' } })).toThrow(
      /quotes/u,
    );
    expect(() =>
      parse({ ...valid, evidence: { ...valid.evidence, document: 'drug.rf.x' } }),
    ).toThrow(/instruction/u);
    expect(() => parse({ ...valid, review: '' })).toThrow(/review/u);
  });

  it('refuses the same class of one card twice, and allows two classes of one card', () => {
    expect(() => parseAtcClassAdditions({ addClasses: [valid, valid] })).toThrow(/twice/u);
    expect(
      parseAtcClassAdditions({ addClasses: [valid, { ...valid, classes: ['R05F'] }] }),
    ).toHaveLength(2);
  });

  it('reads no role as primary and refuses an unknown one', () => {
    const { role: _role, ...withoutRole } = valid;
    expect(parse(withoutRole)[0]?.role).toBe('primary');
    expect(() => parse({ ...valid, role: 'tertiary' })).toThrow(/role/u);
  });

  it('asks a secondary class for the component and the label, and a primary class for neither', () => {
    const secondary = { ...valid, role: 'secondary', via: 'фенобарбитал', label: 'снотворное' };
    expect(parse(secondary)[0]).toMatchObject({ role: 'secondary', via: 'фенобарбитал' });
    expect(() => parse({ ...secondary, via: undefined })).toThrow(/via/u);
    expect(() => parse({ ...secondary, label: ' ' })).toThrow(/label/u);
    expect(() => parse({ ...valid, via: 'фенобарбитал' })).toThrow(/secondary/u);
  });

  it('compares a quote without regard to spacing and case', () => {
    expect(normalizeQuote('  Декстрометорфан\n  уменьшает   кашель ')).toBe(
      'декстрометорфан уменьшает кашель',
    );
  });

  it('checks an addition’s quote against the section of its instruction', () => {
    const addition = parse(valid)[0] as AtcClassAddition;
    const sections = [
      { title: 'Состав', text: 'Декстрометорфан 15 мг' },
      {
        title: 'Показания к применению',
        text: 'Парацетамол обладает обезболивающим действием. Декстрометорфан  уменьшает\nкашель, вызванный раздражением горла. Витамин С.',
      },
    ];
    expect(additionEvidenceHolds(addition, sections)).toBe(true);
    // the quote must be in the section the addition names
    expect(
      additionEvidenceHolds(addition, [{ title: 'Состав', text: sections[1]?.text ?? '' }]),
    ).toBe(false);
    expect(additionEvidenceHolds(addition, [{ title: 'Показания', text: 'Другой текст' }])).toBe(
      false,
    );
  });
});
