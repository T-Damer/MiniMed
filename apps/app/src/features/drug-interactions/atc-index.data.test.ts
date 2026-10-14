/**
 * The committed interaction index against the ATC4 review (docs/research/atc-index-review-*.json):
 * every class membership the ATC fill changed was judged, the wrong ones are kept out by a
 * declared exception, no conflicting or unconfirmed candidate code reached a card.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseAtcCodeExceptions } from './atc-codes';
import { CLASS_ALIASES, classPatterns, deriveClassPhrases } from './class-phrases';
import {
  createInteractionIndex,
  drugTargetSet,
  type InteractionIndexAsset,
  parseInteractionIndex,
} from './interaction-index';

const ROOT = resolve(import.meta.dirname, '../../../../..');
const read = (path: string): unknown => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

const asset = parseInteractionIndex(
  read('apps/app/src/features/drug-interactions/data/interaction-index.json'),
) as InteractionIndexAsset;
const index = createInteractionIndex(asset);
const atcNames = (
  read('apps/app/src/features/medications/atc-names.json') as {
    names: Record<string, string>;
  }
).names;
const exceptions = parseAtcCodeExceptions(
  read('apps/app/src/features/drug-interactions/data/atc-code-exceptions.json'),
);

interface Decision {
  readonly id: string;
  readonly change: 'gained' | 'lost';
  readonly card: string;
  readonly class: { readonly code: string };
  readonly code: string;
  readonly codeSources: readonly string[];
  readonly verdict: 'plausible' | 'unsure' | 'wrong';
  readonly action: 'ship' | 'exclude' | 'withdrawn';
  readonly ownerDecision?: string;
  readonly reason: string;
  readonly evidence: { readonly pharmacology: string | null; readonly readerSentences: unknown[] };
}
interface Suppression {
  readonly id: string;
  readonly document: string;
  readonly lostTargets: readonly string[];
  readonly span: readonly [number, number, number];
  readonly verdict: string;
  readonly action: string;
}
interface OwnerDecision {
  readonly id: string;
  readonly owner: string;
  readonly supersedes?: readonly string[];
  readonly outcome?: string;
  readonly cards?: readonly {
    readonly card: string;
    readonly instruction: string;
    readonly quotes: readonly { readonly section: string; readonly text: string }[];
  }[];
  readonly effect?: {
    readonly cardsLosingTheClass?: number;
    readonly cardsKeepingTheClass?: number;
    readonly lostByDrug?: readonly { readonly card: string; readonly atc: readonly string[] }[];
    readonly keptByDrug?: readonly { readonly card: string; readonly atc: readonly string[] }[];
    readonly gainedPairs?: { readonly cardDocument: number };
  };
}
const review = read('docs/research/atc-index-review-2026-10-14.json') as {
  totals: {
    classMembershipsGained: number;
    verdicts: Record<string, Record<string, number>>;
    shipped: {
      classMemberships: number;
      excludedByException: number;
      withdrawnByOwnerDecision: number;
    };
  };
  decisions: readonly Decision[];
  suppressions: readonly Suppression[];
  ownerDecisions: readonly OwnerDecision[];
};
const audit = read('docs/research/atc-index-selection-audit-2026-10-14.json') as {
  flaggedNodes: Record<string, number>;
  consensusCodesUsed: readonly (readonly [string, string])[];
  ignoredCandidates: readonly (readonly [string, string, string])[];
};

const cardIndex = (id: string): number =>
  index.cardBySlug.get(id.replace(/^esklp\.mnn\./u, '')) ?? -1;
const classTarget = (code: string): number => asset.targets.indexOf(`c:${code}`);

describe('the ATC codes in the interaction index', () => {
  it('are well formed, sorted and never the «~» placeholder', () => {
    for (const card of asset.cards) {
      for (const code of card[1]) {
        expect(code, card[0]).toMatch(/^[A-Z](?:\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?)?$/u);
      }
      expect([...card[1]]).toEqual([...card[1]].toSorted());
    }
  });

  it('give every class rule a code of the НСИ dictionary', () => {
    const classes = asset.targets.filter((target) => target.startsWith('c:'));
    expect(classes.length).toBeGreaterThan(300);
    for (const target of classes) expect(atcNames[target.slice(2)], target).toBeDefined();
  });
});

describe('the ATC4 review of the changed class memberships', () => {
  it('judged every membership the fill added, with a reason and evidence from the product', () => {
    expect(review.decisions).toHaveLength(review.totals.classMembershipsGained);
    expect(new Set(review.decisions.map((item) => item.id)).size).toBe(review.decisions.length);
    for (const decision of review.decisions) {
      expect(decision.change, decision.id).toBe('gained');
      expect(decision.reason.length, decision.id).toBeGreaterThan(40);
      expect(['plausible', 'unsure', 'wrong']).toContain(decision.verdict);
      expect(decision.evidence.readerSentences.length, decision.id).toBeGreaterThan(0);
    }
  });

  it('counts its verdicts as the decisions say', () => {
    for (const verdict of ['plausible', 'unsure', 'wrong'] as const) {
      expect(review.totals.verdicts['class-membership']?.[verdict]).toBe(
        review.decisions.filter((item) => item.verdict === verdict).length,
      );
    }
    expect(review.totals.shipped.classMemberships).toBe(
      review.decisions.filter((item) => item.action === 'ship').length,
    );
    expect(review.totals.shipped.excludedByException).toBe(
      review.decisions.filter((item) => item.action === 'exclude').length,
    );
    expect(review.totals.shipped.withdrawnByOwnerDecision).toBe(
      review.decisions.filter((item) => item.action === 'withdrawn').length,
    );
  });

  it('ships a membership only if the card carries the code and the class rule hits it', () => {
    const shipped = review.decisions.filter((item) => item.action === 'ship');
    expect(shipped.length).toBeGreaterThan(10);
    for (const decision of shipped) {
      const card = cardIndex(decision.card);
      expect(card, decision.card).toBeGreaterThanOrEqual(0);
      expect(asset.cards[card]?.[1], decision.id).toContain(decision.code);
      const target = classTarget(decision.class.code);
      expect(target, decision.id).toBeGreaterThanOrEqual(0);
      expect(drugTargetSet(index, card).has(target), decision.id).toBe(true);
      // The code and its class are in the official dictionary.
      expect(atcNames[decision.code.slice(0, 5)], decision.id).toBeDefined();
      expect(atcNames[decision.class.code], decision.id).toBeDefined();
    }
  });

  it('keeps a membership out of the index when the review excluded it, and only then', () => {
    const excluded = review.decisions.filter((item) => item.action === 'exclude');
    expect(excluded.length).toBeGreaterThan(0);
    for (const decision of excluded) {
      expect(['wrong', 'unsure']).toContain(decision.verdict);
      const card = cardIndex(decision.card);
      expect(card, decision.card).toBeGreaterThanOrEqual(0);
      expect(asset.cards[card]?.[1], decision.id).not.toContain(decision.code);
      expect(drugTargetSet(index, card).has(classTarget(decision.class.code)), decision.id).toBe(
        false,
      );
    }
    // a verdict of «wrong» is never shipped
    for (const decision of review.decisions.filter((item) => item.verdict === 'wrong')) {
      expect(decision.action, decision.id).toBe('exclude');
    }
  });

  it('declares every exclusion as a data exception with its decision in the review', () => {
    const excluded = review.decisions.filter((item) => item.action === 'exclude');
    const declared = new Set(exceptions.map((item) => `${item.card}|${item.code}`));
    expect(new Set(excluded.map((item) => `${item.card}|${item.code}`))).toEqual(declared);
    expect(exceptions.length).toBeGreaterThan(0);
    for (const exception of exceptions) {
      expect(exception.review).toBe('docs/research/atc-index-review-2026-10-14.json');
      const card = cardIndex(exception.card);
      expect(card, exception.card).toBeGreaterThanOrEqual(0);
      expect(asset.cards[card]?.[1], exception.card).not.toContain(exception.code);
    }
  });

  it('shows a suppressed class mention only where the drug now belongs to that class itself', () => {
    expect(review.suppressions.length).toBeGreaterThan(0);
    for (const item of review.suppressions) {
      const document = asset.documents[item.document];
      expect(document, item.id).toBeDefined();
      for (const target of item.lostTargets) {
        const code = target.slice(2);
        const own = (document?.c ?? []).flatMap((card) => asset.cards[card]?.[1] ?? []);
        expect(
          own.some((atc) => atc.startsWith(code)),
          `${item.id} ${target}`,
        ).toBe(true);
        // and the sentence no longer names it
        const [section, start, end] = item.span;
        const sentence = (document?.sp ?? []).find(
          (span) => span[0] === section && span[1] === start && span[2] === end,
        );
        expect(sentence, `${item.id} stays a sentence of the index`).toBeDefined();
        expect(sentence?.slice(4), `${item.id} ${target}`).not.toContain(classTarget(code));
      }
    }
  });
});

describe('conflicting and unconfirmed codes', () => {
  it('never reach a card: no ignored candidate is among the codes of its card', () => {
    expect(audit.flaggedNodes['conflict']).toBeGreaterThan(600);
    expect(audit.flaggedNodes['unconfirmed']).toBeGreaterThan(0);
    expect(audit.ignoredCandidates.length).toBeGreaterThan(100);
    for (const [slug, code, flag] of audit.ignoredCandidates) {
      expect(['conflict', 'unconfirmed']).toContain(flag);
      const card = index.cardBySlug.get(slug);
      expect(card, slug).toBeDefined();
      expect(asset.cards[card ?? -1]?.[1], `${slug} ${code}`).not.toContain(code);
    }
  });

  it('give a stub conflict its agreed code beside the registry code', () => {
    expect(audit.consensusCodesUsed).toHaveLength(13);
    for (const [slug, code] of audit.consensusCodesUsed) {
      expect(asset.cards[index.cardBySlug.get(slug) ?? -1]?.[1], slug).toContain(code);
    }
  });
});

describe('the medication-safety index', () => {
  it('uses no ATC code, so the ATC fill cannot change it', () => {
    const safety = read('apps/app/src/features/medication-safety/data/safety-index.json') as Record<
      string,
      unknown
    >;
    expect(Object.keys(safety).filter((key) => /atc/iu.test(key))).toEqual([]);
    const source = readFileSync(
      resolve(ROOT, 'apps/app/src/features/medication-safety/safety-build.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\batc/iu);
  });
});

describe('the owner decisions of 2026-10-14 on the ATC review', () => {
  const targetsOfCard = (slug: string): ReadonlySet<string> => {
    const card = cardIndex(`esklp.mnn.${slug}`);
    expect(card, slug).toBeGreaterThanOrEqual(0);
    return new Set([...drugTargetSet(index, card)].map((target) => asset.targets[target] ?? ''));
  };

  describe('«противокашлевые» stands for the cough suppressants, not the whole of R05', () => {
    const { phrases } = deriveClassPhrases(atcNames, CLASS_ALIASES);
    const antitussive = phrases.filter((phrase) => phrase.stems.includes('противокашл'));

    it('maps the class word to R05D and R05F only, from the alias table', () => {
      expect(antitussive).toHaveLength(1);
      expect(antitussive[0]?.origin).toBe('alias');
      expect([...(antitussive[0]?.codes ?? [])].toSorted()).toEqual(['R05D', 'R05F']);
      const covered = (code: string): boolean =>
        classPatterns(antitussive).some((pattern) => code.startsWith(pattern.target.slice(2)));
      // suppressants and their combinations are covered …
      for (const code of ['R05DA04', 'R05DB13', 'R05FA02', 'R05FB02']) {
        expect(covered(code), code).toBe(true);
      }
      // … expectorants, mucolytics and other cold remedies are not
      for (const code of ['R05CA10', 'R05CB06', 'R05CB01', 'R05X']) {
        expect(covered(code), code).toBe(false);
      }
    });

    it('keeps the whole-R05 target out of the index and the suppressant targets in it', () => {
      expect(asset.targets).not.toContain('c:R05');
      expect(asset.targets).toContain('c:R05D');
      expect(asset.targets).toContain('c:R05F');
    });

    it('hits suppressants and suppressant combinations, not expectorants or mucolytics', () => {
      for (const slug of [
        'бутамират',
        'леводропропизин',
        'кодеин-натрия-гидрокарбонат-терпингидрат',
      ]) {
        const targets = targetsOfCard(slug);
        expect(targets.has('c:R05D') || targets.has('c:R05F'), slug).toBe(true);
      }
      for (const slug of ['амброксол', 'бромгексин', 'ацетилцистеин', 'гвайфенезин']) {
        const targets = targetsOfCard(slug);
        expect(targets.has('c:R05D'), slug).toBe(false);
        expect(targets.has('c:R05F'), slug).toBe(false);
        // the expectorant class word still reaches them
        expect(targets.has('c:R05C'), slug).toBe(true);
      }
    });

    it('records the cards that lost and kept the class, from the committed index', () => {
      const decision = review.ownerDecisions.find((item) => item.id === 'OD1');
      expect(decision?.owner).toContain('2026-10-14');
      expect(decision?.effect?.cardsLosingTheClass).toBe(78);
      expect(decision?.effect?.cardsKeepingTheClass).toBe(15);
      expect(decision?.effect?.lostByDrug).toHaveLength(78);
      expect(decision?.effect?.keptByDrug).toHaveLength(15);
      for (const lost of decision?.effect?.lostByDrug ?? []) {
        expect(
          lost.atc.some((code) => /^R05[CX]/u.test(code)),
          lost.card,
        ).toBe(true);
        expect(
          lost.atc.some((code) => /^R05[DF]/u.test(code)),
          lost.card,
        ).toBe(false);
      }
      for (const kept of decision?.effect?.keptByDrug ?? []) {
        expect(
          kept.atc.some((code) => /^R05[DF]/u.test(code)),
          kept.card,
        ).toBe(true);
      }
    });

    it('withdrew the two R05 memberships of the first review, which the class word no longer gives', () => {
      const withdrawn = review.decisions.filter((item) => item.action === 'withdrawn');
      expect(withdrawn.map((item) => item.id).toSorted()).toEqual(['H01', 'H18']);
      for (const decision of withdrawn) {
        expect(decision.ownerDecision).toBe('OD1');
        expect(decision.class.code).toBe('R05');
        expect(targetsOfCard(decision.card.replace(/^esklp\.mnn\./u, '')).has('c:R05')).toBe(false);
      }
    });
  });

  describe('the two older topical interferon cards stay in L03AB', () => {
    const cards = ['бензокаин-интерферон-альфа-2b-таурин', 'интерферон-альфа-2b-таурин'];

    it('are not excepted, because their evidence does not show a topical-only product', () => {
      expect(exceptions.map((item) => item.card)).toEqual([
        'esklp.mnn.интерферон-альфа-2b-лоратадин',
      ]);
      for (const slug of cards) {
        expect(asset.cards[cardIndex(`esklp.mnn.${slug}`)]?.[1], slug).toContain('L03AB05');
        expect(targetsOfCard(slug).has('c:L03AB'), slug).toBe(true);
      }
    });

    it('records the evidence it was decided on', () => {
      const decision = review.ownerDecisions.find((item) => item.id === 'OD2');
      expect(decision?.outcome).toMatch(/^kept/u);
      expect((decision?.cards ?? []).map((item) => item.card)).toEqual(
        cards.map((slug) => `esklp.mnn.${slug}`),
      );
      const [withInstruction, withoutInstruction] = decision?.cards ?? [];
      expect(withInstruction?.instruction).toContain('drug.rf.15a7cbb6003585558ca4.instruction');
      expect(withInstruction?.quotes.length).toBeGreaterThanOrEqual(3);
      expect(withoutInstruction?.quotes).toHaveLength(0);
      expect(withoutInstruction?.instruction).toMatch(/^none/u);
    });
  });

  describe('льна посевного семена belongs to the laxative class', () => {
    it('carries A06AC05 and is hit by the class «Слабительные средства»', () => {
      expect(asset.cards[cardIndex('esklp.mnn.льна-посевного-семена')]?.[1]).toContain('A06AC05');
      expect(targetsOfCard('льна-посевного-семена').has('c:A06')).toBe(true);
    });

    it('has no exception left and is a shipped membership with the owner as its basis', () => {
      expect(exceptions.map((item) => item.card)).not.toContain('esklp.mnn.льна-посевного-семена');
      const decision = review.decisions.find(
        (item) => item.card === 'esklp.mnn.льна-посевного-семена',
      );
      expect(decision?.action).toBe('ship');
      expect(decision?.ownerDecision).toBe('OD3');
      const gained = review.ownerDecisions.find((item) => item.id === 'OD3')?.effect?.gainedPairs;
      expect(gained?.cardDocument).toBeGreaterThan(90);
    });
  });
});
