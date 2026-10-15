/**
 * Secondary classes (CLS1): an additional class one component brings to a card. The drug is reached
 * by the class sentences of other instructions, and the view says it was reached that way.
 */
import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { type BuildInputDocument, createInteractionBuilder } from './interaction-build';
import { checkPair, type DrugItem, itemTargetSplit, itemTargets } from './interaction-check';
import { SPAN_FLAG_INTERACTIONS } from './interaction-extract';
import {
  createInteractionIndex,
  drugTargets,
  type InteractionIndex,
  type InteractionIndexAsset,
  parseInteractionIndex,
} from './interaction-index';
import { interactionShareText } from './interaction-print';
import { type DocumentState, pairView, printPairs, quoteViaText } from './interaction-view';

const ATC_NAMES: Readonly<Record<string, string>> = {
  C01: 'Препараты для лечения заболеваний сердца',
  C01E: 'Другие препараты для лечения заболеваний сердца',
  C01EX: 'Другие препараты для лечения заболеваний сердца',
  N03: 'Противоэпилептические препараты',
  N03A: 'Противоэпилептические препараты',
  N03AB: 'Производные гидантоина',
  N05: 'Психолептики',
  N05C: 'Снотворные и седативные средства',
  N05CA: 'Барбитураты',
  N05CB: 'Барбитураты в комбинации с другими средствами',
  N05CF: 'Бензодиазепиноподобные средства',
};

const SENTENCE = 'Снотворные средства усиливают угнетение центральной нервной системы.';

function instruction(id: string, tradeName: string, registration: string, text: string) {
  return {
    id,
    title: `${tradeName}: инструкция`,
    kind: 'national-instruction',
    sourceClass: 'grls',
    tradeName,
    inn: null,
    registrationKeys: [registration],
    sections: [
      {
        id: `section.00000000${id.slice(8, 16)}`,
        type: 'interactions',
        title: 'Взаимодействие с другими лекарственными средствами',
        chunks: () => [text],
      },
    ],
  } satisfies BuildInputDocument;
}

function buildIndex(secondary: boolean): InteractionIndex {
  const builder = createInteractionBuilder({
    cards: [
      {
        id: 'esklp.mnn.капли-с-фенобарбиталом',
        name: 'КАПЛИ',
        synonyms: [],
        components: [],
        atcCodes: ['C01EX'],
        ...(secondary
          ? {
              secondaryClasses: [
                { code: 'N05CB', via: 'фенобарбитал', label: 'барбитурат, снотворное' },
              ],
            }
          : {}),
        registrationKeys: ['ЛП-001'],
      },
      {
        id: 'esklp.mnn.зопиклон',
        name: 'ЗОПИКЛОН',
        synonyms: [],
        components: [],
        atcCodes: ['N05CF01'],
        registrationKeys: ['ЛП-002'],
      },
      {
        id: 'esklp.mnn.фенитоин',
        name: 'ФЕНИТОИН',
        synonyms: [],
        components: [],
        atcCodes: ['N03AB02'],
        registrationKeys: ['ЛП-003'],
      },
    ],
    atcNames: ATC_NAMES,
    atcBasis: { version: 'test', publishDate: '2026-01-01' },
    classAliases: [
      { text: 'снотворные', codes: ['N05CA', 'N05CB', 'N05CF'], basis: 'test' },
      { text: 'седативные', codes: ['N05C'], basis: 'test' },
    ],
  });
  builder.addModule({ id: 'minimed.medications.instructions.test.ru', version: 't', sha256: 'x' }, [
    instruction('drug.rf.aaaaaaaa.instruction', 'Капли', 'ЛП-001', 'Нет значимых данных.'),
    instruction('drug.rf.bbbbbbbb.instruction', 'Зопиклон-тест', 'ЛП-002', 'Нет значимых данных.'),
    instruction('drug.rf.cccccccc.instruction', 'Фенитоин-тест', 'ЛП-003', SENTENCE),
  ] satisfies BuildInputDocument[]);
  const { asset } = builder.finish();
  return createInteractionIndex(parseInteractionIndex(JSON.parse(JSON.stringify(asset))));
}

const index = buildIndex(true);
const withoutSecondary = buildIndex(false);
const drug = (source: InteractionIndex, slug: string, label = slug): DrugItem => ({
  id: slug,
  kind: 'drug',
  card: source.cardBySlug.get(slug) ?? -1,
  label,
});

describe('the index asset', () => {
  it('writes the secondary classes of a card as a fourth element, and only for such a card', () => {
    const cards = index.asset.cards;
    expect(cards[index.cardBySlug.get('капли-с-фенобарбиталом') ?? -1]).toEqual([
      'капли-с-фенобарбиталом',
      ['C01EX'],
      expect.any(Array),
      [['N05CB', 'фенобарбитал', 'барбитурат, снотворное']],
    ]);
    expect(cards[index.cardBySlug.get('зопиклон') ?? -1]).toHaveLength(3);
  });

  it('refuses a malformed secondary list', () => {
    const asset = JSON.parse(JSON.stringify(index.asset)) as {
      cards: unknown[][];
    } & InteractionIndexAsset;
    const first = asset.cards[0] ?? [];
    expect(() =>
      parseInteractionIndex({ ...asset, cards: [[first[0], first[1], first[2], []]] }),
    ).toThrow(/empty list of secondary/u);
    expect(() =>
      parseInteractionIndex({
        ...asset,
        cards: [[first[0], first[1], first[2], [['N05CB', 'x']]]],
      }),
    ).toThrow(/malformed secondary/u);
    expect(() =>
      parseInteractionIndex({ ...asset, cards: [[first[0], first[1], first[2], [], 5]] }),
    ).toThrow(/is not \[slug/u);
  });
});

describe('what a secondary class reaches', () => {
  it('keeps the class apart from the primary targets', () => {
    const card = index.cardBySlug.get('капли-с-фенобарбиталом') ?? -1;
    const classTarget = index.asset.targets.indexOf('c:N05CB');
    expect(classTarget).toBeGreaterThanOrEqual(0);
    const { primary, secondary } = drugTargets(index, card);
    expect(primary.has(classTarget)).toBe(false);
    expect(secondary.get(classTarget)).toEqual({
      code: 'N05CB',
      via: 'фенобарбитал',
      label: 'барбитурат, снотворное',
    });
    // the highlight and the sentence search use both
    expect(itemTargets(index, drug(index, 'капли-с-фенобарбиталом')).has(classTarget)).toBe(true);
    expect(itemTargetSplit(index, drug(index, 'капли-с-фенобарбиталом')).secondary.size).toBe(1);
  });

  it('reaches the drops with the hypnotic sentence, marked as secondary', () => {
    const pair = checkPair(
      index,
      drug(index, 'фенитоин'),
      drug(index, 'капли-с-фенобарбиталом', 'Корвалол'),
    );
    expect(pair.aReadsB.sentences).toHaveLength(1);
    expect(pair.aReadsB.sentences[0]?.secondary).toEqual({
      code: 'N05CB',
      via: 'фенобарбитал',
      label: 'барбитурат, снотворное',
    });
  });

  it('does not reach the drops without the declaration', () => {
    const pair = checkPair(
      withoutSecondary,
      drug(withoutSecondary, 'фенитоин'),
      drug(withoutSecondary, 'капли-с-фенобарбиталом'),
    );
    expect(pair.found).toBe(0);
  });

  it('does not mark a drug that belongs to the class by its own code', () => {
    const pair = checkPair(index, drug(index, 'фенитоин'), drug(index, 'зопиклон'));
    expect(pair.aReadsB.sentences).toHaveLength(1);
    expect(pair.aReadsB.sentences[0]?.secondary).toBeUndefined();
  });
});

describe('the own-class suppression', () => {
  const WARNING = 'Не применять одновременно со снотворными средствами.';

  function warningDocument(): BuildInputDocument {
    return {
      ...instruction('drug.rf.dddddddd.instruction', 'Капли', 'ЛП-001', WARNING),
      sections: [
        {
          id: 'section.00000000dddddddd',
          type: 'contraindications',
          title: 'Противопоказания',
          chunks: () => [WARNING],
        },
      ],
    };
  }

  function namedBy(primaryCodes: readonly string[], secondary: boolean): readonly string[] {
    const builder = createInteractionBuilder({
      cards: [
        {
          id: 'esklp.mnn.капли-с-фенобарбиталом',
          name: 'КАПЛИ',
          synonyms: [],
          components: [],
          atcCodes: primaryCodes,
          ...(secondary
            ? {
                secondaryClasses: [
                  { code: 'N05CB', via: 'фенобарбитал', label: 'барбитурат, снотворное' },
                ],
              }
            : {}),
          registrationKeys: ['ЛП-001'],
        },
      ],
      atcNames: ATC_NAMES,
      atcBasis: { version: 'test', publishDate: '2026-01-01' },
      classAliases: [{ text: 'снотворные', codes: ['N05CA', 'N05CB', 'N05CF'], basis: 'test' }],
    });
    builder.addModule(
      { id: 'minimed.medications.instructions.test.ru', version: 't', sha256: 'x' },
      [warningDocument()],
    );
    const { asset } = builder.finish();
    const built = createInteractionIndex(parseInteractionIndex(JSON.parse(JSON.stringify(asset))));
    return (built.asset.documents['drug.rf.dddddddd.instruction']?.sp ?? []).flatMap((span) =>
      span.slice(4).map((target) => built.asset.targets[target] ?? '?'),
    );
  }

  it('drops a class word in the warnings of the drug’s own primary class', () => {
    const targets = namedBy(['N05CB02'], false);
    expect(targets).not.toContain('c:N05CB');
    expect(targets).toContain('c:N05CA');
  });

  it('keeps it for a secondary class: «avoid other drugs that contain …» is a real warning (CLS2)', () => {
    const targets = namedBy(['C01EX'], true);
    expect(targets).toContain('c:N05CB');
    expect(targets).toContain('c:N05CA');
  });
});

describe('what the view says', () => {
  const sectionId = 'section.00000000cccccccc';
  const document: MedicalDocument = {
    id: 'drug.rf.cccccccc.instruction',
    title: 'Фенитоин-тест: инструкция',
    shortTitle: null,
    sourceType: 'official_drug_instruction',
    status: 'active',
    specialties: [],
    metadata: { documentKind: 'national-instruction' },
    versionId: 'v',
    versionLabel: 'v',
    effectiveFrom: null,
    sections: [
      {
        id: sectionId,
        documentVersionId: 'v',
        parentSectionId: null,
        title: 'Взаимодействие с другими лекарственными средствами',
        sectionType: 'interactions',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 'x',
        sectionPath: [],
        chunks: [
          {
            id: 'c',
            sectionId,
            documentVersionId: 'v',
            orderIndex: 0,
            originalText: SENTENCE,
            pageStart: null,
            pageEnd: null,
            anchor: 'x/chunk',
          },
        ],
      },
    ],
  };
  const states = new Map<string, DocumentState>([
    ['drug.rf.cccccccc.instruction', { document }],
    ['drug.rf.aaaaaaaa.instruction', 'missing'],
  ]);

  it('names the component and the class on a quote reached that way', () => {
    const view = pairView(
      index,
      checkPair(index, drug(index, 'фенитоин'), drug(index, 'капли-с-фенобарбиталом', 'Корвалол')),
      states,
      [],
    );
    const quote = view.sides.flatMap((side) => side.quotes)[0];
    expect(quote?.text).toBe(SENTENCE);
    expect(quote?.flags).toBe(SPAN_FLAG_INTERACTIONS);
    expect(quote ? quoteViaText(quote) : null).toBe('через фенобарбитал (барбитурат, снотворное)');
  });

  it('says nothing on a quote reached by the drug’s own class', () => {
    const view = pairView(
      index,
      checkPair(index, drug(index, 'фенитоин'), drug(index, 'зопиклон')),
      states,
      [],
    );
    const quote = view.sides.flatMap((side) => side.quotes)[0];
    expect(quote?.secondary).toBeNull();
    expect(quote ? quoteViaText(quote) : 'x').toBeNull();
  });

  it('puts the same words into the print and the share text', () => {
    const view = pairView(
      index,
      checkPair(index, drug(index, 'фенитоин'), drug(index, 'капли-с-фенобарбиталом', 'Корвалол')),
      states,
      [],
    );
    const printed = printPairs([view]);
    expect(printed[0]?.sides[0]?.quotes[0]?.section).toBe(
      'Взаимодействие с другими лекарственными средствами · через фенобарбитал (барбитурат, снотворное)',
    );
    expect(interactionShareText(printed)).toContain('через фенобарбитал');
  });
});
