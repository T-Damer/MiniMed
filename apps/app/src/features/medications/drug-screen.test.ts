import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildDrugScreen,
  displayDrugName,
  displayStrength,
  drugAtcCodes,
  drugGroupLinks,
  drugRelatedProducts,
  drugSectionIndex,
  drugShareText,
  formatSourceEdition,
  instructionIndexFromSummaries,
} from './drug-screen';
import {
  type MedicationProduct,
  parseEsklpMedicationProducts,
  type TradeNameSupplement,
} from './medication-record';

function substanceCard(): MedicalDocument {
  const node = (smnnCode: string, strength: string, tradeNames: readonly string[]) => ({
    smnnCode,
    standardizedInn: 'ФОНТУРАЦЕТАМ',
    dosageForm: 'ТАБЛЕТКИ',
    strength,
    pharmacotherapeuticGroup: 'ноотропное средство',
    atcCode: 'N06BX',
    tradeNames: tradeNames.map((tradeName, index) => ({
      tradeName,
      registrationNumber: `ЛП-${smnnCode}-${String(index)}`,
      dosageForm: 'ТАБЛЕТКИ',
      strength,
    })),
    klpPositions: tradeNames.map((tradeName, index) => ({
      klpCode: `klp-${smnnCode}-${String(index)}`,
      tradeName,
      registrationNumber: `ЛП-${smnnCode}-${String(index)}`,
      dosageForm: 'ТАБЛЕТКИ',
      strength,
      holder: 'ОАО ФАРМСТАНДАРТ-ЛЕКСРЕДСТВА',
      manufacturer: 'ОАО ФАРМСТАНДАРТ-ЛЕКСРЕДСТВА',
    })),
  });
  return {
    id: 'esklp.mnn.фонтурацетам',
    title: 'ФОНТУРАЦЕТАМ',
    shortTitle: null,
    sourceType: 'official_registry_summary',
    status: 'active',
    specialties: [],
    versionId: 'v1',
    versionLabel: '2026-08-28',
    effectiveFrom: null,
    sections: [],
    metadata: {
      contentMode: 'esklp-mnn',
      standardizedInn: 'ФОНТУРАЦЕТАМ',
      sourceEdition: '2026-08-28',
      atcCodes: ['N06BX'],
      smnnNodes: [
        node('smnn.50', '50.0мг', ['АКТИТРОПИЛ', 'Нанотропил ново', 'Фонтурацетам']),
        node('smnn.100', '100.0мг', ['АКТИТРОПИЛ', 'Нооредит']),
      ],
    },
  };
}

function productNamed(products: readonly MedicationProduct[], name: string, strength: string) {
  const found = products.find(
    (product) =>
      product.tradeName === name && product.presentations[0]?.strength?.startsWith(strength),
  );
  if (!found) throw new Error(`no product ${name} ${strength}`);
  return found;
}

describe('displayDrugName', () => {
  it('turns an all-capitals registry name into a sentence-case name', () => {
    expect(displayDrugName('АКТИТРОПИЛ')).toBe('Актитропил');
    expect(displayDrugName('АМБРОКСОЛ+ГВАЙФЕНЕЗИН')).toBe('Амброксол+гвайфенезин');
    expect(displayDrugName('ФАКТОР VIII СВЁРТЫВАНИЯ')).toBe('Фактор VIII свёртывания');
  });

  it('leaves a name that already has lower-case letters, and names without letters', () => {
    expect(displayDrugName('Нанотропил ново')).toBe('Нанотропил ново');
    expect(displayDrugName('Мексидол ФОРТЕ')).toBe('Мексидол ФОРТЕ');
    expect(displayDrugName('123')).toBe('123');
  });
});

describe('displayStrength', () => {
  it('drops the decimal point of whole numbers only', () => {
    expect(displayStrength('50.0 мг')).toBe('50 мг');
    expect(displayStrength('100.0мг')).toBe('100мг');
    expect(displayStrength('2.5 мг')).toBe('2.5 мг');
    expect(displayStrength('10.05 мг')).toBe('10.05 мг');
  });
});

describe('drugAtcCodes', () => {
  it('lists each code once with the node text it came from', () => {
    const codes = drugAtcCodes(substanceCard(), undefined);
    expect(codes).toEqual([
      {
        code: 'N06BX',
        level: 4,
        sourceCode: null,
        groupText: 'ноотропное средство',
        substanceName: 'Фонтурацетам',
        edition: '28.08.2026',
      },
    ]);
  });

  it('corrects Cyrillic letters and remembers the source spelling', () => {
    const card = substanceCard();
    const corrected: MedicalDocument = {
      ...card,
      metadata: {
        ...card.metadata,
        smnnNodes: [{ smnnCode: 'a', atcCode: 'N06ВХ', standardizedInn: 'Х' }],
      },
    };
    expect(drugAtcCodes(corrected, undefined)).toMatchObject([
      { code: 'N06BX', sourceCode: 'N06ВХ' },
    ]);
  });

  it('keeps only the nodes of the trade name and drops the «~» placeholder', () => {
    const card = substanceCard();
    const mixed: MedicalDocument = {
      ...card,
      metadata: {
        ...card.metadata,
        smnnNodes: [
          { smnnCode: 'one', atcCode: 'N06BX' },
          { smnnCode: 'two', atcCode: '~' },
          { smnnCode: 'three', atcCode: 'C01EB' },
        ],
      },
    };
    expect(drugAtcCodes(mixed, undefined).map((item) => item.code)).toEqual(['C01EB', 'N06BX']);
    expect(drugAtcCodes(mixed, { smnnCodes: ['one'] }).map((item) => item.code)).toEqual(['N06BX']);
    // A node without a code is shown without one; codes of other nodes are not borrowed.
    expect(drugAtcCodes(mixed, { smnnCodes: ['two'] })).toEqual([]);
  });

  it('falls back to the document-level list when no node has a code', () => {
    const card = substanceCard();
    const bare: MedicalDocument = {
      ...card,
      metadata: { ...card.metadata, smnnNodes: [], atcCodes: ['N06BX', '~'] },
    };
    expect(drugAtcCodes(bare, undefined).map((item) => item.code)).toEqual(['N06BX']);
    expect(drugAtcCodes(undefined, undefined)).toEqual([]);
  });
});

describe('formatSourceEdition', () => {
  it('writes an ISO date the Russian way', () => {
    expect(formatSourceEdition('2026-08-28')).toBe('28.08.2026');
    expect(formatSourceEdition('август')).toBe('август');
    expect(formatSourceEdition(null)).toBeNull();
  });
});

describe('drugGroupLinks', () => {
  it('shows the most specific entry of a chain and keeps the whole text as the title', () => {
    const [link] = drugGroupLinks([
      'антациды; комбинированные препараты; препараты алюминия',
      'Препараты алюминия',
    ]);
    expect(link).toMatchObject({
      label: 'Препараты алюминия',
      title: 'Антациды → комбинированные препараты → препараты алюминия',
      query: 'препараты алюминия',
    });
    expect(drugGroupLinks(['ноотропное средство', '~', ' '])).toHaveLength(1);
  });
});

describe('drugRelatedProducts', () => {
  const products = parseEsklpMedicationProducts(substanceCard());

  it('lists one entry per other trade name, never the current one', () => {
    const current = productNamed(products, 'АКТИТРОПИЛ', '50');
    const related = drugRelatedProducts(products, current);
    expect(related.map((item) => item.label)).toEqual([
      'Нанотропил ново',
      'Нооредит',
      'Фонтурацетам',
    ]);
  });

  it('opens the registration with the same form and strength when there is one', () => {
    const current = productNamed(products, 'АКТИТРОПИЛ', '100');
    const related = drugRelatedProducts(products, current);
    const nooredit = related.find((item) => item.label === 'Нооредит');
    expect(nooredit?.product.presentations[0]?.strength).toBe('100.0мг');
    // «Нанотропил ново» is only registered at 50 mg: the same form still wins.
    const nanotropil = related.find((item) => item.label === 'Нанотропил ново');
    expect(nanotropil?.product.presentations[0]?.strength).toBe('50.0мг');
  });

  it('lists every trade name on the substance card', () => {
    expect(drugRelatedProducts(products, undefined).map((item) => item.label)).toEqual([
      'Актитропил',
      'Нанотропил ново',
      'Нооредит',
      'Фонтурацетам',
    ]);
  });

  it('does not offer analogues of a single-name substance', () => {
    const single = parseEsklpMedicationProducts({
      ...substanceCard(),
      metadata: {
        contentMode: 'esklp-mnn',
        smnnNodes: [
          {
            smnnCode: 'one',
            dosageForm: 'ТАБЛЕТКИ',
            tradeNames: [{ tradeName: 'ОДИН', registrationNumber: 'r', dosageForm: 'ТАБЛЕТКИ' }],
          },
        ],
      },
    });
    expect(drugRelatedProducts(single, single[0])).toEqual([]);
  });
});

describe('instructionIndexFromSummaries', () => {
  it('maps registration numbers of instruction documents only', () => {
    const index = instructionIndexFromSummaries([
      {
        id: 'grls.1',
        sourceType: 'official_drug_instruction',
        metadata: { registrationNumber: 'ЛП-1' },
      },
      {
        id: 'grls.2',
        sourceType: 'official_registry_summary',
        metadata: { registrationNumber: 'ЛП-2' },
      },
      { id: 'grls.3', sourceType: 'official_drug_instruction' },
    ]);
    expect([...index]).toEqual([['ЛП-1', 'grls.1']]);
  });
});

describe('buildDrugScreen', () => {
  const card = substanceCard();
  const products = parseEsklpMedicationProducts(card);
  const baseInput = {
    source: card,
    document: card,
    sourceProducts: products,
    supplements: [] as readonly TradeNameSupplement[],
    documentTitle: () => undefined,
  };

  it('builds a trade-name screen from an ЕСКЛП registration', () => {
    const product = productNamed(products, 'АКТИТРОПИЛ', '50');
    const screen = buildDrugScreen({ ...baseInput, product });
    expect(screen?.header).toMatchObject({
      kind: 'product',
      kicker: 'Препарат',
      title: 'Актитропил',
      latinName: null,
      meta: ['Таблетки · 50мг', 'ОАО ФАРМСТАНДАРТ-ЛЕКСРЕДСТВА'],
      imageReference: null,
    });
    expect(screen?.links.substance).toEqual({
      label: 'Фонтурацетам',
      target: { kind: 'substance-card' },
    });
    expect(screen?.links.groups.map((group) => group.label)).toEqual(['Ноотропное средство']);
    expect(screen?.links.relatedTitle).toBe('Аналоги (дженерики, синонимы)');
    expect(screen?.links.atc.map((item) => item.code)).toEqual(['N06BX']);
    expect(screen?.header.formInMeta).toBe(true);
    expect(screen && drugShareText(screen.header, 'https://example.test/#/doc')).toBe(
      'Актитропил\nТаблетки · 50мг · ОАО ФАРМСТАНДАРТ-ЛЕКСРЕДСТВА\nhttps://example.test/#/doc',
    );
  });

  it('builds the substance card when no trade name is selected', () => {
    const screen = buildDrugScreen({ ...baseInput, product: undefined });
    expect(screen?.header).toMatchObject({
      kind: 'substance',
      kicker: 'Действующее вещество',
      title: 'Фонтурацетам',
    });
    expect(screen?.links.substance).toBeNull();
    expect(screen?.links.relatedTitle).toBe('Торговые наименования');
    expect(screen?.links.related).toHaveLength(4);
  });

  it('takes the packaging photo and the Latin name from the matching Allmed supplement', () => {
    const product = productNamed(products, 'АКТИТРОПИЛ', '50');
    const supplement = {
      document: card,
      product: {
        ...product,
        sourceKind: 'allmed',
        tradeName: 'Актитропил',
        inn: 'Actitropil',
        imageReference: 'img/preparations/7.png',
      },
    } satisfies TradeNameSupplement;
    const screen = buildDrugScreen({ ...baseInput, product, supplements: [supplement] });
    expect(screen?.header.imageReference).toBe('img/preparations/7.png');
    expect(screen?.header.latinName).toBe('Actitropil');
  });

  it('ignores an Allmed Latin name that is missing or not Latin', () => {
    const product = productNamed(products, 'АКТИТРОПИЛ', '50');
    const supplement = (inn: string) =>
      ({
        document: card,
        product: { ...product, sourceKind: 'allmed', tradeName: 'Актитропил', inn },
      }) satisfies TradeNameSupplement;
    expect(
      buildDrugScreen({ ...baseInput, product, supplements: [supplement('Не указано')] })?.header
        .latinName,
    ).toBeNull();
    expect(
      buildDrugScreen({ ...baseInput, product, supplements: [supplement('Актитропил')] })?.header
        .latinName,
    ).toBeNull();
  });

  it('links to a substance card that is a different document, only when the app lists it', () => {
    const allmed: MedicationProduct = {
      ...productNamed(products, 'АКТИТРОПИЛ', '50'),
      sourceKind: 'allmed',
      mnnDocumentId: null,
      linkedMnnDocumentId: card.id,
      inn: 'Actitropil',
      imageReference: 'img/preparations/7.png',
      pharmacotherapeuticGroups: [],
    };
    const allmedDocument = {
      ...card,
      id: 'drug.allmed.7',
      metadata: { contentMode: 'allmed-snapshot' },
    };
    const input = {
      ...baseInput,
      source: allmedDocument,
      document: allmedDocument,
      product: allmed,
    };
    expect(buildDrugScreen(input)?.links.substance).toBeNull();
    expect(
      buildDrugScreen({
        ...input,
        documentTitle: (id) => (id === card.id ? 'ФОНТУРАЦЕТАМ' : undefined),
      })?.links.substance,
    ).toEqual({ label: 'Фонтурацетам', target: { kind: 'document', documentId: card.id } });
    expect(buildDrugScreen(input)?.header.latinName).toBe('Actitropil');
    expect(buildDrugScreen(input)?.links.atc).toEqual([]);
  });

  it('is not a drug screen for other documents', () => {
    const other: MedicalDocument = { ...card, metadata: { contentMode: 'guideline' } };
    expect(
      buildDrugScreen({ ...baseInput, source: other, document: other, product: undefined }),
    ).toBeNull();
    expect(buildDrugScreen({ ...baseInput, source: undefined, product: undefined })).toBeNull();
  });
});

describe('drugSectionIndex', () => {
  const section = (anchor: string, title: string, depth = 1) => ({ anchor, title, depth });

  it('numbers the top-level sections', () => {
    expect(
      drugSectionIndex([
        section('a', 'Показания'),
        section('a.1', 'Детям', 2),
        section('b', 'Противопоказания'),
      ]),
    ).toEqual([
      { anchor: 'a', label: 'Показания', number: '01' },
      { anchor: 'b', label: 'Противопоказания', number: '02' },
    ]);
  });

  it('shortens long titles and skips a document with one section', () => {
    const long = 'Я'.repeat(80);
    const [first] = drugSectionIndex([section('a', long), section('b', 'Б')]);
    expect(first?.label).toHaveLength(36);
    expect(first?.label.endsWith('…')).toBe(true);
    expect(drugSectionIndex([section('a', 'Один')])).toEqual([]);
    expect(drugSectionIndex([])).toEqual([]);
  });
});
