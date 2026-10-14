/**
 * The owner decisions of 2026-10-14, ATC4c: class words that name one part of a group are narrowed to
 * that part (and «гипотензивные» is widened), and a card can be added to a class by a declaration.
 * Read against the committed index and the review record (docs/research/atc-index-review-*.json).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseAtcClassAdditions, parseAtcCodeExceptions } from './atc-codes';
import { CLASS_ALIASES, classPatterns, deriveClassPhrases } from './class-phrases';
import {
  createInteractionIndex,
  drugTargetSet,
  type InteractionIndexAsset,
  parseInteractionIndex,
} from './interaction-index';
import { nameStems } from './mention-matcher';

const ROOT = resolve(import.meta.dirname, '../../../../..');
const read = (path: string): unknown => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

const asset = parseInteractionIndex(
  read('apps/app/src/features/drug-interactions/data/interaction-index.json'),
) as InteractionIndexAsset;
const index = createInteractionIndex(asset);
const atcNames = (
  read('apps/app/src/features/medications/atc-names.json') as { names: Record<string, string> }
).names;
const declarations = read('apps/app/src/features/drug-interactions/data/atc-code-exceptions.json');
const additions = parseAtcClassAdditions(declarations);
const { phrases } = deriveClassPhrases(atcNames, CLASS_ALIASES);

interface WordRecord {
  readonly id: string;
  readonly word: string;
  readonly before: { readonly codes: readonly string[] };
  readonly after: { readonly origin: string; readonly codes: readonly string[] };
  readonly applied: boolean;
  readonly userVerdict: string;
  readonly userVerdictWhy: string;
  readonly scenarios: readonly string[];
  readonly oldCodesForMeasure: string;
  readonly effect: {
    readonly cardsBefore: number;
    readonly cardsAfter: number;
    readonly cardsLosingTheClass: number;
    readonly cardsGainingTheClass: number;
    readonly pairsLost: { readonly document: number; readonly sentence: number };
    readonly pairsGained: { readonly document: number; readonly sentence: number };
    readonly lostByDrug: readonly { readonly card: string; readonly atc: readonly string[] }[];
    readonly gainedByDrug: readonly { readonly card: string; readonly atc: readonly string[] }[];
  };
}
const review = read('docs/research/atc-index-review-2026-10-14.json') as {
  ownerDecisions: readonly {
    readonly id: string;
    readonly words?: readonly WordRecord[];
    readonly additions?: readonly { readonly card: string; readonly classes: readonly string[] }[];
    readonly notApplied?: readonly { readonly card: string }[];
  }[];
  userPerspective: {
    readonly summary: { readonly better: number; readonly neutral: number; readonly worse: number };
    readonly scenarios: readonly {
      readonly id: string;
      readonly verdict: string;
      readonly why: string;
      readonly before: { readonly found: number };
      readonly after: { readonly found: number };
    }[];
    readonly comparing: Record<string, string>;
    readonly search: Record<string, string>;
  };
};
const decisionWords = review.ownerDecisions.find((item) => item.id === 'OD4')?.words ?? [];

const cardIndex = (slug: string): number => {
  const found = index.cardBySlug.get(slug);
  expect(found, slug).toBeDefined();
  return found ?? -1;
};
const targetsOf = (slug: string): ReadonlySet<string> =>
  new Set([...drugTargetSet(index, cardIndex(slug))].map((target) => asset.targets[target] ?? ''));
const phraseOf = (word: string) =>
  phrases.find((phrase) => phrase.stems.join(' ') === nameStems(word).join(' '));
const covers = (word: string, code: string): boolean => {
  const phrase = phraseOf(word);
  return classPatterns(phrase ? [phrase] : []).some((pattern) =>
    code.startsWith(pattern.target.slice(2)),
  );
};

interface Narrowing {
  readonly word: string;
  readonly codes: readonly string[];
  /** Codes of real drugs the word must reach. */
  readonly reaches: readonly string[];
  /** Codes of drugs the word is not about. */
  readonly misses: readonly string[];
}
const ANTIHYPERTENSIVE = ['C02', 'C03A', 'C03B', 'C03C', 'C03D', 'C03E', 'C07', 'C08', 'C09'];
const NARROWINGS: readonly Narrowing[] = [
  {
    word: 'макролиды',
    codes: ['J01FA'],
    reaches: ['J01FA01', 'J01FA09', 'J01FA10'],
    misses: ['J01FF01', 'J01FG01', 'J01CA04'],
  },
  {
    word: 'линкозамиды',
    codes: ['J01FF'],
    reaches: ['J01FF01', 'J01FF02'],
    misses: ['J01FA09', 'J01FG01'],
  },
  {
    word: 'стрептограмины',
    codes: ['J01FG'],
    reaches: ['J01FG01'],
    misses: ['J01FA01', 'J01FF01'],
  },
  {
    word: 'цитостатики',
    codes: ['L01A', 'L01B', 'L01C', 'L01D', 'L01XA', 'L01XB', 'L01XX'],
    reaches: ['L01AA01', 'L01BA01', 'L01CD01', 'L01DB01', 'L01XA01', 'L01XB01', 'L01XX05'],
    misses: ['L01EA01', 'L01EX01', 'L01FA01', 'L01FF01', 'L01XE01', 'L01XC05', 'L01XG01'],
  },
  {
    word: 'психостимуляторы',
    codes: ['N06BA', 'N06BC', 'N06CB'],
    reaches: ['N06BA09', 'N06BC01'],
    misses: ['N06BX03', 'N06BX18'],
  },
  {
    word: 'снотворные',
    codes: ['N05CA', 'N05CB', 'N05CC', 'N05CD', 'N05CE', 'N05CF', 'N05CH', 'N05CJ', 'N05CX'],
    reaches: ['N05CF02', 'N05CD08', 'N05CH01', 'N05CB02', 'N05CJ02'],
    misses: ['N05CM09', 'N05CM18', 'N05BA01'],
  },
  {
    word: 'противодиарейные',
    codes: ['A07B', 'A07D', 'A07X'],
    reaches: ['A07BA01', 'A07BC05', 'A07DA03', 'A07XA04'],
    misses: ['A07FA02', 'A07FA51', 'A07EC02', 'A07AA11', 'A07CA'],
  },
  {
    word: 'анальгетики',
    codes: ['A03EA', 'N02A', 'N02B', 'S02DA'],
    reaches: ['N02AA01', 'N02AX02', 'N02BE01', 'N02BA01', 'N02BF02'],
    misses: ['N02CC01', 'N02CA52', 'N02CD07'],
  },
  {
    word: 'деконгестанты',
    codes: ['R01AA', 'R01AB', 'R01BA', 'S01GA'],
    reaches: ['R01AA07', 'R01AB01', 'R01BA02', 'S01GA01'],
    misses: ['R01AD09', 'R01AC03', 'R01AX10', 'S01GX07'],
  },
  {
    word: 'кровезаменители',
    codes: ['B05A'],
    reaches: ['B05AA07', 'B05AA01', 'B05AA05'],
    misses: ['B05BB01', 'B05XA03', 'B05CB01', 'B05BA03', 'B05DA'],
  },
  {
    word: 'гипотензивные',
    codes: ANTIHYPERTENSIVE,
    reaches: ['C02AC01', 'C03AA03', 'C03CA01', 'C07AB07', 'C08CA01', 'C09AA03', 'C09DB01'],
    misses: ['C03XA01', 'C01DA02', 'C04AD', 'G04CA02', 'N05AX08'],
  },
  {
    word: 'антигипертензивные',
    codes: ANTIHYPERTENSIVE,
    reaches: ['C02KX', 'C03BA11', 'C07AA05', 'C08DA01', 'C09CA01'],
    misses: ['C03XA01', 'C01DA02'],
  },
];

describe('ATC4c: class words that name one part of a group', () => {
  for (const narrowing of NARROWINGS) {
    describe(`«${narrowing.word}»`, () => {
      it('is an alias for exactly the decided subgroups, all in the НСИ dictionary', () => {
        const phrase = phraseOf(narrowing.word);
        expect(phrase?.origin).toBe('alias');
        expect([...(phrase?.codes ?? [])].toSorted()).toEqual([...narrowing.codes].toSorted());
        for (const code of narrowing.codes) expect(atcNames[code], code).toBeDefined();
        const alias = CLASS_ALIASES.find((item) => item.text === narrowing.word);
        expect(alias?.basis.length, 'the basis is recorded').toBeGreaterThan(40);
      });

      it('reaches the drugs it is about and not the rest of the group', () => {
        for (const code of narrowing.reaches) {
          expect(covers(narrowing.word, code), `${narrowing.word} ← ${code}`).toBe(true);
        }
        for (const code of narrowing.misses) {
          expect(covers(narrowing.word, code), `${narrowing.word} ← ${code}`).toBe(false);
        }
      });
    });
  }

  it('leaves the broad group targets out of the index and puts the narrow ones in', () => {
    for (const gone of ['c:J01F', 'c:N06B', 'c:A07', 'c:R01A', 'c:B05']) {
      expect(asset.targets, gone).not.toContain(gone);
    }
    for (const present of [
      'c:J01FA',
      'c:J01FF',
      'c:J01FG',
      'c:L01A',
      'c:L01XX',
      'c:N06BA',
      'c:N05CF',
      'c:A07B',
      'c:A07D',
      'c:A07X',
      'c:N02A',
      'c:N02B',
      'c:R01AA',
      'c:R01BA',
      'c:B05A',
      'c:C03A',
      'c:C08',
    ]) {
      expect(asset.targets, present).toContain(present);
    }
    // the word «противоопухолевые» keeps the whole of L01
    expect(asset.targets).toContain('c:L01');
  });

  it('keeps the other words on their groups: «седативные» still stands for all of N05C', () => {
    const sedative = phraseOf('седативные');
    expect(sedative?.origin).toBe('atc-name');
    expect(sedative?.codes).toEqual(['N05C']);
    expect(covers('седативные', 'N05CM09')).toBe(true);
  });

  describe('as the committed index shows it', () => {
    const hit = (slug: string, target: string): boolean => targetsOf(slug).has(target);

    it('macrolides, lincosamides and streptogramins are told apart', () => {
      expect(hit('кларитромицин', 'c:J01FA')).toBe(true);
      expect(hit('кларитромицин', 'c:J01FF')).toBe(false);
      expect(hit('клиндамицин', 'c:J01FF')).toBe(true);
      expect(hit('клиндамицин', 'c:J01FA')).toBe(false);
      expect(hit('линкомицин', 'c:J01FA')).toBe(false);
      for (const slug of ['азитромицин', 'эритромицин', 'спирамицин']) {
        expect(hit(slug, 'c:J01FA'), slug).toBe(true);
      }
      // no streptogramin among the cards: the word reaches nobody
      expect(asset.cards.some((card) => card[1].some((code) => code.startsWith('J01FG')))).toBe(
        false,
      );
    });

    it('cytostatics are the cytotoxic agents, not the kinase inhibitors or the antibodies', () => {
      const cytotoxic = ['L01A', 'L01B', 'L01C', 'L01D', 'L01XA', 'L01XB', 'L01XX'].map(
        (code) => `c:${code}`,
      );
      const isCytostatic = (slug: string): boolean => cytotoxic.some((target) => hit(slug, target));
      for (const slug of [
        'циклофосфамид',
        'метотрексат',
        'цисплатин',
        'доксорубицин',
        'гидроксикарбамид',
        'мышьяка-триоксид',
        'эрибулин',
      ]) {
        expect(isCytostatic(slug), slug).toBe(true);
      }
      for (const slug of ['иматиниб', 'сорафениб', 'ритуксимаб', 'бортезомиб', 'эрлотиниб']) {
        expect(isCytostatic(slug), slug).toBe(false);
        // but they are antineoplastic: the word «противоопухолевые» still reaches them
        expect(hit(slug, 'c:L01'), slug).toBe(true);
      }
    });

    it('probiotics are not antidiarrhoeals, adsorbents and loperamide are', () => {
      const antidiarrhoeal = ['c:A07B', 'c:A07D', 'c:A07X'];
      const is = (slug: string): boolean => antidiarrhoeal.some((target) => hit(slug, target));
      for (const slug of [
        'лоперамид',
        'активированный-уголь',
        'смектит-диоктаэдрический',
        'рацекадотрил',
      ]) {
        expect(is(slug), slug).toBe(true);
      }
      for (const slug of ['сахаромицеты-буларди', 'бифидобактерии-бифидум', 'месалазин']) {
        expect(is(slug), slug).toBe(false);
      }
    });

    it('hypnotics are not herbal sedatives, but sedatives still are', () => {
      expect(hit('золпидем', 'c:N05CF')).toBe(true);
      expect(hit('мелатонин', 'c:N05CH')).toBe(true);
      expect(hit('валерианы-лекарственной-корневищ-с-корнями-экстракт', 'c:N05CF')).toBe(false);
      for (const target of [
        'c:N05CA',
        'c:N05CB',
        'c:N05CD',
        'c:N05CF',
        'c:N05CH',
        'c:N05CJ',
        'c:N05CX',
      ]) {
        expect(hit('валерианы-лекарственной-корневищ-с-корнями-экстракт', target), target).toBe(
          false,
        );
      }
      expect(hit('валерианы-лекарственной-корневищ-с-корнями-экстракт', 'c:N05C')).toBe(true);
    });

    it('psychostimulants are not nootropics; analgesics are not migraine drugs', () => {
      expect(hit('кофеин', 'c:N06BC')).toBe(true);
      expect(hit('атомоксетин', 'c:N06BA')).toBe(true);
      expect(hit('пирацетам', 'c:N06BA')).toBe(false);
      expect(hit('пирацетам', 'c:N06BC')).toBe(false);
      for (const slug of ['парацетамол', 'морфин', 'трамадол']) {
        expect(hit(slug, 'c:N02A') || hit(slug, 'c:N02B'), slug).toBe(true);
      }
      for (const slug of ['суматриптан', 'ризатриптан']) {
        expect(hit(slug, 'c:N02A') || hit(slug, 'c:N02B'), slug).toBe(false);
      }
    });

    it('decongestants are the sympathomimetics; blood substitutes are the colloids', () => {
      expect(hit('ксилометазолин', 'c:R01AA')).toBe(true);
      expect(hit('мометазон', 'c:R01AA')).toBe(false);
      expect(hit('мометазон', 'c:R01AB')).toBe(false);
      for (const slug of ['гидроксиэтилкрахмал', 'альбумин-человека', 'желатин']) {
        expect(hit(slug, 'c:B05A'), slug).toBe(true);
      }
      for (const slug of ['декстроза', 'натрия-хлорид']) {
        expect(hit(slug, 'c:B05A'), slug).toBe(false);
      }
    });

    it('antihypertensives of every class are reached by «гипотензивные»', () => {
      const targets = ANTIHYPERTENSIVE.map((code) => `c:${code}`);
      const is = (slug: string): boolean => targets.some((target) => hit(slug, target));
      for (const slug of [
        'амлодипин',
        'лизиноприл',
        'бисопролол',
        'гидрохлоротиазид',
        'фуросемид',
        'лозартан',
        'клонидин',
        'индапамид',
        'спиронолактон',
        'верапамил',
        'валсартан-сакубитрил',
      ]) {
        expect(is(slug), slug).toBe(true);
      }
      for (const slug of ['метформин', 'диклофенак', 'парацетамол', 'амитриптилин']) {
        expect(is(slug), slug).toBe(false);
      }
    });
  });
});

describe('ATC4c: the review record agrees with the table and the index', () => {
  it('has one record per narrowed word, with the aliases of the table', () => {
    expect(decisionWords.map((item) => item.id)).toEqual(
      Array.from({ length: NARROWINGS.length - 1 }, (_value, position) => `OD4-${position + 1}`),
    );
    for (const record of decisionWords) {
      const wanted = NARROWINGS.find(
        (item) => item.word === record.word.replace(' / антигипертензивные', ''),
      );
      expect(wanted, record.word).toBeDefined();
      expect([...record.after.codes].toSorted(), record.word).toEqual(
        [...(wanted?.codes ?? [])].toSorted(),
      );
      expect(record.applied, record.word).toBe(true);
      expect(['better', 'neutral', 'worse'], record.word).toContain(record.userVerdict);
      // a narrowing that is worse for the doctor is not applied
      if (record.userVerdict === 'worse') expect(record.applied).toBe(false);
      expect(record.userVerdictWhy.length, record.word).toBeGreaterThan(60);
    }
  });

  it('counts the cards that lose and gain a word as the cards of the index do', () => {
    const matches = (codes: readonly string[], prefixes: readonly string[]): boolean =>
      codes.some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
    for (const record of decisionWords) {
      const oldCodes = record.oldCodesForMeasure.split(',');
      const newCodes = record.after.codes;
      const members = asset.cards.filter((card) => matches(card[1], newCodes)).map((c) => c[0]);
      expect(members.length, `${record.word} after`).toBe(record.effect.cardsAfter);
      // the cards that lost the word by their code are the cards on the record's list
      const lostByCode = asset.cards
        .filter((card) => matches(card[1], oldCodes) && !matches(card[1], newCodes))
        .map((card) => card[0])
        .toSorted();
      // a declared class addition may bring a card back (the phenylephrine spray), so the record
      // counts what the index shows now
      expect(lostByCode, record.word).toEqual(
        record.effect.lostByDrug.map((item) => item.card).toSorted(),
      );
      expect(record.effect.cardsLosingTheClass, record.word).toBe(lostByCode.length);
      const gainedByCode = asset.cards
        .filter((card) => matches(card[1], newCodes) && !matches(card[1], oldCodes))
        .map((card) => card[0])
        .toSorted();
      expect(gainedByDrug(record), record.word).toEqual(gainedByCode);
      expect(record.effect.cardsBefore + record.effect.cardsGainingTheClass, record.word).toBe(
        record.effect.cardsAfter + record.effect.cardsLosingTheClass,
      );
    }
  });

  it('states what a pair gains or loses, per drug and in total', () => {
    for (const record of decisionWords) {
      const { pairsLost, pairsGained } = record.effect;
      expect(pairsLost.sentence).toBeGreaterThanOrEqual(pairsLost.document);
      expect(pairsGained.sentence).toBeGreaterThanOrEqual(pairsGained.document);
    }
    const hypotensive = decisionWords.find((item) => item.word.startsWith('гипотензивные'));
    expect(hypotensive?.effect.cardsGainingTheClass).toBe(97);
    expect(hypotensive?.effect.pairsGained.document).toBeGreaterThan(20_000);
    const cytostatics = decisionWords.find((item) => item.word === 'цитостатики');
    expect(cytostatics?.effect.cardsLosingTheClass).toBe(109);
  });

  it('judged the user’s side with scenarios, none of them worse', () => {
    const { summary, scenarios } = review.userPerspective;
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
    expect(summary.worse).toBe(0);
    expect(summary.better + summary.neutral).toBe(scenarios.length);
    expect(scenarios.filter((item) => item.verdict === 'better')).toHaveLength(summary.better);
    for (const scenario of scenarios) {
      expect(['better', 'neutral', 'worse'], scenario.id).toContain(scenario.verdict);
      expect(scenario.why.length, scenario.id).toBeGreaterThan(20);
    }
    // every narrowed word has at least two scenarios, except the one nobody carries
    for (const record of decisionWords) {
      if (record.word === 'стрептограмины') continue;
      expect(record.scenarios.length, record.word).toBeGreaterThanOrEqual(2);
      for (const id of record.scenarios) {
        expect(
          scenarios.some((item) => item.id === id),
          `${record.word} ${id}`,
        ).toBe(true);
      }
    }
    expect(review.userPerspective.comparing['drugComparison']).toContain('Not affected');
    expect(review.userPerspective.search['doClassWordsFeedMainSearch']).toMatch(/^No/u);
  });
});

function gainedByDrug(record: WordRecord): readonly string[] {
  return record.effect.gainedByDrug.map((item) => item.card).toSorted();
}

describe('ATC4c: class additions (addClasses)', () => {
  it('are valid declarations of cards that exist, each with its instruction in the index', () => {
    expect(additions.length).toBeGreaterThanOrEqual(2);
    for (const addition of additions) {
      const slug = addition.card.replace(/^esklp\.mnn\./u, '');
      const card = cardIndex(slug);
      expect(addition.review).toBe('docs/research/atc-index-review-2026-10-14.json');
      for (const code of addition.classes) {
        expect(atcNames[code], code).toBeDefined();
        // the index carries the declared class on the card, and the class rule hits it
        expect(asset.cards[card]?.[1], slug).toContain(code);
        const target = asset.targets.indexOf(`c:${code}`);
        if (target >= 0) expect(drugTargetSet(index, card).has(target), slug).toBe(true);
      }
      // the instruction that is quoted is one of the card’s indexed documents
      const document = asset.documents[addition.evidence.document];
      expect(document, addition.evidence.document).toBeDefined();
      expect(document?.c, addition.evidence.document).toContain(card);
    }
  });

  it('bring the dextromethorphan cold remedy back into the cough suppressants', () => {
    const slug = 'декстрометорфан-парацетамол-псевдоэфедрин-аскорбиновая-кислота';
    expect(asset.cards[cardIndex(slug)]?.[1]).toEqual(['R05D', 'R05X']);
    expect(targetsOf(slug).has('c:R05D')).toBe(true);
    // the expectorant instructions that say «не назначают одновременно с противокашлевыми»
    expect(phraseOf('противокашлевые')?.codes).toEqual(['R05D', 'R05F']);
    // an expectorant is still not a cough suppressant
    expect(targetsOf('бромгексин').has('c:R05D')).toBe(false);
  });

  it('keep the phenylephrine nasal spray among the decongestants after the narrowing', () => {
    const slug = 'дексаметазон-неомицин-полимиксин-b-фенилэфрин';
    expect(asset.cards[cardIndex(slug)]?.[1]).toEqual(['R01AA', 'R01AD53']);
    expect(targetsOf(slug).has('c:R01AA')).toBe(true);
    expect(covers('деконгестанты', 'R01AA')).toBe(true);
  });

  it('are on the record, with the products that could not be declared and why', () => {
    const decision = review.ownerDecisions.find((item) => item.id === 'OD5');
    expect((decision?.additions ?? []).map((item) => item.card).toSorted()).toEqual(
      additions.map((item) => item.card).toSorted(),
    );
    const declared = new Set(additions.map((item) => item.card));
    expect(decision?.notApplied?.length).toBeGreaterThanOrEqual(3);
    for (const item of decision?.notApplied ?? []) {
      expect(declared.has(item.card), item.card).toBe(false);
      // a card without an instruction in the product has no evidence, so it is not declared
      const card = index.cardBySlug.get(item.card.replace(/^esklp\.mnn\./u, ''));
      expect(card, item.card).toBeDefined();
      expect(index.documentsOfCard.get(card ?? -1) ?? [], item.card).toEqual([]);
    }
  });

  it('keep the exception file valid as a whole', () => {
    expect(parseAtcCodeExceptions(declarations).length).toBeGreaterThanOrEqual(1);
  });
});
