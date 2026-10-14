import { describe, expect, it } from 'vitest';

import type { AtcNameCatalog } from './atc-code';
import { atcSheetSections } from './atc-sheet-model';
import { atcCodeFromText } from './atc-text-links';
import type { DrugAtcCode } from './drug-screen';

const catalog: AtcNameCatalog = {
  source: 'НСИ Минздрава, справочник АТХ',
  version: '3.8',
  publishDate: '2025-07-15',
  names: {
    J: 'Противомикробные препараты системного действия',
    J05: 'Противовирусные препараты системного действия',
    J05A: 'Противовирусные препараты прямого действия',
    J05AX: 'Прочие противовирусные препараты',
    L03: 'Иммуностимуляторы',
    L03A: 'Иммуностимуляторы',
    L03AX: 'Другие иммуностимуляторы',
  },
};

const consensus: DrugAtcCode = {
  ...atcCodeFromText('J05AX13', 'J05AX13'),
  substanceName: 'Умифеновир',
  registryValue: 'L03AX',
  consensusSources: ['same-inn', 'instruction-text'],
};

describe('the ladders of the ATC code sheet', () => {
  it('breaks a full code into its five levels with the names the data has', () => {
    const [main, ...rest] = atcSheetSections({
      code: atcCodeFromText('J05AX13', 'J05AX13'),
      catalog,
    });
    expect(rest).toEqual([]);
    expect(main?.steps.map((step) => [step.code, step.name])).toEqual([
      ['J', 'Противомикробные препараты системного действия'],
      ['J05', 'Противовирусные препараты системного действия'],
      ['J05A', 'Противовирусные препараты прямого действия'],
      ['J05AX', 'Прочие противовирусные препараты'],
      ['J05AX13', null],
    ]);
  });

  it('names level 5 by the substances that have the code when the code has no drug behind it', () => {
    const [main] = atcSheetSections({
      code: atcCodeFromText('J05AX13', 'J05AX13'),
      catalog,
      substanceName: 'Умифеновир',
    });
    expect(main?.steps.at(-1)).toMatchObject({ code: 'J05AX13', name: 'Умифеновир' });
  });

  it('leaves a level with no name as the bare code', () => {
    const [main] = atcSheetSections({ code: atcCodeFromText('J05AX13', 'J05AX13'), catalog: null });
    const level3 = main?.steps.find((step) => step.code === 'J05A');
    expect(level3).toMatchObject({ code: 'J05A', name: null, nameSource: null });
    // Level 1 still has the heading of MiniMed's own taxonomy.
    expect(main?.steps[0]).toMatchObject({ code: 'J', nameSource: 'minimed-taxonomy' });
  });

  it('follows a group stub only to its own level, with the later levels marked absent', () => {
    const [main] = atcSheetSections({ code: atcCodeFromText('J05AX', 'J05AX'), catalog });
    expect(main?.steps.map((step) => step.code)).toEqual(['J', 'J05', 'J05A', 'J05AX', null]);
  });

  it('gives an agreed code and the registry stub beside it a ladder each', () => {
    const sections = atcSheetSections({ code: consensus, catalog });
    expect(sections.map((section) => [section.key, section.heading])).toEqual([
      ['main', 'Основной код: J05AX13'],
      ['registry', 'В реестре: L03AX'],
    ]);
    expect(sections[0]?.steps.map((step) => step.code)).toEqual([
      'J',
      'J05',
      'J05A',
      'J05AX',
      'J05AX13',
    ]);
    // The stub's ladder stops at its own level and names the levels the same way.
    expect(sections[1]?.steps.map((step) => [step.code, step.name])).toEqual([
      ['L', 'Противоопухолевые и иммуномодулирующие препараты'],
      ['L03', 'Иммуностимуляторы'],
      ['L03A', 'Иммуностимуляторы'],
      ['L03AX', 'Другие иммуностимуляторы'],
    ]);
  });

  it('shows one ladder when the registry holds the same code', () => {
    const sections = atcSheetSections({
      code: { ...consensus, registryValue: 'J05AX13' },
      catalog,
    });
    expect(sections.map((section) => section.key)).toEqual(['main']);
  });

  it('shows nothing for a value that is no code', () => {
    expect(atcSheetSections({ code: { ...consensus, code: 'не код' }, catalog })).toEqual([]);
  });
});
