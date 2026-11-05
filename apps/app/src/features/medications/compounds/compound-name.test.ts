import { describe, expect, it } from 'vitest';

import {
  dropHydration,
  dropSalt,
  extractENumbers,
  joinHyphenBreaks,
  normalizeCompoundName,
  parentheticalAlternatives,
  stemToken,
} from './compound-name';

describe('normalizeCompoundName', () => {
  it('collapses genitive, inverted and nominative spellings of one substance', () => {
    const lactose = normalizeCompoundName('лактозы моногидрат');
    expect(normalizeCompoundName('Лактоза моногидрат')).toBe(lactose);
    expect(normalizeCompoundName('моногидрат лактозы')).toBe(lactose);
    expect(normalizeCompoundName('магния стеарат')).toBe(normalizeCompoundName('стеарат магния'));
    expect(normalizeCompoundName('кремния диоксид коллоидный')).toBe(
      normalizeCompoundName('диоксид кремния коллоидный'),
    );
    expect(normalizeCompoundName('натрия лаурилсульфат')).toBe(
      normalizeCompoundName('лаурилсульфат натрия'),
    );
  });

  it('treats ё as е and ignores case', () => {
    expect(normalizeCompoundName('ЖЁЛТЫЙ краситель')).toBe(
      normalizeCompoundName('желтый Краситель'),
    );
  });

  it('drops grades, E-numbers, amounts and brackets', () => {
    const povidone = normalizeCompoundName('повидон');
    expect(normalizeCompoundName('повидон К 30')).toBe(povidone);
    expect(normalizeCompoundName('Повидон-К25')).toBe(povidone);
    expect(normalizeCompoundName('макрогол-3350')).toBe(normalizeCompoundName('макрогол'));
    const titanium = normalizeCompoundName('титана диоксид');
    expect(normalizeCompoundName('титана диоксид (Е 171)')).toBe(titanium);
    expect(normalizeCompoundName('титана диоксид Е171')).toBe(titanium);
    expect(normalizeCompoundName('кросповидон (тип А) 2,55 мг')).toBe(
      normalizeCompoundName('кросповидон'),
    );
    expect(normalizeCompoundName('гипромеллоза (гидроксипропилметилцеллюлоза)')).toBe(
      normalizeCompoundName('гипромеллоза'),
    );
  });

  it('ignores the qualifiers of a solution and pH adjustment', () => {
    expect(normalizeCompoundName('1 М раствор натрия гидроксида до рН 7,0-9,0')).toBe(
      normalizeCompoundName('натрия гидроксид'),
    );
  });

  it('joins words broken by a hyphen at a line end', () => {
    expect(joinHyphenBreaks('микрокристалличес-\n\nкая')).toBe('микрокристаллическая');
    expect(normalizeCompoundName('целлюлоза микрокристалличес-\nкая')).toBe(
      normalizeCompoundName('целлюлоза микрокристаллическая'),
    );
    expect(joinHyphenBreaks('альфа-токоферол')).toBe('альфа-токоферол');
  });

  it('keeps different substances apart', () => {
    expect(normalizeCompoundName('натрия гидроксид')).not.toBe(
      normalizeCompoundName('натрия гидрокарбонат'),
    );
    expect(normalizeCompoundName('карбомер')).not.toBe(normalizeCompoundName('кармеллоза'));
    expect(normalizeCompoundName('')).toBe('');
    expect(normalizeCompoundName('12,5 мг')).toBe('');
  });
});

describe('name helpers', () => {
  it('cuts case endings only while three letters remain', () => {
    expect(stemToken('магния')).toBe('магн');
    expect(stemToken('лак')).toBe('лак');
    expect(stemToken('вода')).toBe('вод');
  });

  it('reads E-numbers in any spelling', () => {
    expect(extractENumbers('краситель железа оксид желтый (Е 172), титана диоксид Е171')).toEqual([
      'E172',
      'E171',
    ]);
  });

  it('lists brackets that are names, not E-numbers', () => {
    expect(parentheticalAlternatives('кремния диоксид (аэросил) (Е 551)')).toEqual(['аэросил']);
  });

  it('drops hydration and salt words only on request', () => {
    const lactose = normalizeCompoundName('лактозы моногидрат');
    expect(dropHydration(lactose)).toBe(normalizeCompoundName('лактоза'));
    const metformin = normalizeCompoundName('метформина гидрохлорид');
    expect(dropSalt(metformin)).toBe(normalizeCompoundName('метформин'));
    expect(dropSalt(normalizeCompoundName('диклофенак натрия'))).toBe(
      normalizeCompoundName('диклофенак'),
    );
  });
});
