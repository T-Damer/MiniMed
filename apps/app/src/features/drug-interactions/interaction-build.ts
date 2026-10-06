/**
 * Assembles the drug-interaction index (INT1). Pure: `scripts/build-drug-interactions.ts` reads the
 * released modules and the ЕСКЛП cards and feeds them in module by module.
 */
import { type ClassAlias, classPatterns, deriveClassPhrases } from './class-phrases';
import { type ExtractSection, extractDocumentSpans } from './interaction-extract';
import {
  type AssetCard,
  type AssetDocument,
  compareRankedDocuments,
  DOCUMENTS_PER_CARD,
  INSTRUCTION_KINDS,
  INTERACTION_INDEX_SCHEMA_VERSION,
  type InteractionIndexAsset,
  SECTION_CHECKSUM_LENGTH,
  SECTION_ID_PREFIX,
} from './interaction-index';
import { CombinedMentionFinder, MentionMatcher } from './mention-matcher';
import {
  cardSubstanceKeys,
  type InteractionCard,
  substanceKey,
  substancePatterns,
} from './substance-names';

export interface BuildInputSection {
  readonly id: string;
  readonly type: string | null;
  readonly title: string;
  /** Read only for the sections that are searched. */
  readonly chunks: () => readonly string[];
}

export interface BuildInputDocument {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly sourceClass: 'grls' | 'manufacturer-site';
  readonly tradeName: string | null;
  readonly inn: string | null;
  /** Registration numbers the document serves, normalised (`normalizeRegistrationKey`). */
  readonly registrationKeys: readonly string[];
  readonly sections: readonly BuildInputSection[];
}

export interface BuildInputModule {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
}

export interface BuildCard extends InteractionCard {
  /** Normalised registration numbers of the card's products. */
  readonly registrationKeys: readonly string[];
}

export interface InteractionBuildReport {
  readonly summary: Readonly<Record<string, number | string>>;
  readonly classPhrases: {
    readonly total: number;
    readonly fromNames: number;
    readonly fromAliases: number;
    readonly manyBranches: readonly string[];
    readonly containerWords: readonly string[];
  };
  readonly topTargets: readonly { readonly target: string; readonly sentences: number }[];
  readonly documentsWithoutCard: readonly string[];
}

const SPAN_LIMIT_PER_DOCUMENT = 4_000;

export function createInteractionBuilder(input: {
  readonly cards: readonly BuildCard[];
  readonly atcNames: Readonly<Record<string, string>>;
  readonly atcBasis: { readonly version: string; readonly publishDate: string };
  /** The class-name aliases; the committed table unless a test brings its own. */
  readonly classAliases?: readonly ClassAlias[];
  /** Audit hook: every kept sentence with its document. Not part of the asset. */
  readonly onSentence?: (
    document: BuildInputDocument,
    sentence: {
      readonly flags: number;
      readonly sectionTitle: string;
      readonly text: string;
      readonly targets: readonly string[];
      readonly surfaces: readonly string[];
    },
  ) => void;
}) {
  const { phrases, report: classReport } = deriveClassPhrases(input.atcNames, input.classAliases);
  const substanceMatcherPatterns = substancePatterns(input.cards);
  const matcher = new MentionMatcher([...substanceMatcherPatterns], { minSingleStem: 4 });
  const classMatcher = new MentionMatcher(classPatterns(phrases), { minSingleStem: 3 });
  const combined = new CombinedMentionFinder([matcher, classMatcher]);

  const cardsByRegistration = new Map<string, number[]>();
  const cardsByKeySet = new Map<string, number[]>();
  input.cards.forEach((card, index) => {
    for (const key of card.registrationKeys) {
      const list = cardsByRegistration.get(key);
      if (list) list.push(index);
      else cardsByRegistration.set(key, [index]);
    }
    const keySet = [...cardSubstanceKeys(card)].toSorted().join('|');
    const list = cardsByKeySet.get(keySet);
    if (list) list.push(index);
    else cardsByKeySet.set(keySet, [index]);
  });

  interface RawDocument {
    readonly id: string;
    readonly cardIndexes: readonly number[];
    readonly module: number;
    readonly tradeName: string | null;
    readonly kind: number;
    readonly sourceClass: 0 | 1;
    readonly hasInteractionSection: 0 | 1;
    readonly sections: readonly { id: string; checksum: string }[];
    readonly spans: readonly {
      section: number;
      start: number;
      end: number;
      flags: number;
      targets: readonly string[];
    }[];
  }
  const moduleIds: string[] = [];
  const moduleBasis: BuildInputModule[] = [];
  let raw: RawDocument[] = [];
  const withoutCard: string[] = [];
  let documentsSeen = 0;
  let documentsMatchedByInn = 0;

  function cardsOfDocument(document: BuildInputDocument): readonly number[] {
    const found = new Set<number>();
    for (const key of document.registrationKeys) {
      for (const card of cardsByRegistration.get(key) ?? []) found.add(card);
    }
    if (found.size > 0) return [...found].toSorted((a, b) => a - b);
    // No registration of the document is in the ЕСКЛП cards: use the МНН the registry names for it.
    if (document.inn) {
      const keys = document.inn
        .split('+')
        .map(substanceKey)
        .filter((key) => key !== '')
        .toSorted();
      const matched = cardsByKeySet.get(keys.join('|'));
      if (matched) {
        documentsMatchedByInn += 1;
        return matched;
      }
    }
    return [];
  }

  return {
    addModule(module: BuildInputModule, documents: Iterable<BuildInputDocument>): void {
      const moduleIndex = moduleIds.length;
      moduleIds.push(module.id);
      moduleBasis.push(module);
      for (const document of documents) {
        documentsSeen += 1;
        const cardIndexes = cardsOfDocument(document);
        if (cardIndexes.length === 0) withoutCard.push(document.id);
        const ownKeys = new Set(
          cardIndexes.flatMap((index) => {
            const card = input.cards[index];
            return card ? cardSubstanceKeys(card) : [];
          }),
        );
        if (cardIndexes.length === 0 && document.inn) {
          for (const part of document.inn.split('+')) ownKeys.add(substanceKey(part));
        }
        const sections: ExtractSection[] = document.sections.map((section) => ({
          id: section.id,
          type: section.type,
          title: section.title,
          chunks: [],
        }));
        // Chunks are read lazily, only for the sections the extractor will look at.
        const needed = document.sections.map(
          (section) =>
            section.type === 'interactions' ||
            section.type === 'special-instructions' ||
            section.type === 'contraindications' ||
            section.type === 'caution' ||
            (document.kind === 'leaflet' && section.type === 'other'),
        );
        const loaded = sections.map((section, index) =>
          needed[index]
            ? { ...section, chunks: document.sections[index]?.chunks() ?? [] }
            : section,
        );
        const extracted = extractDocumentSpans(loaded, combined, {
          isLeaflet: document.kind === 'leaflet',
          ownKeys,
          ownAtcCodes: cardIndexes.flatMap((index) => input.cards[index]?.atcCodes ?? []),
          ...(input.onSentence
            ? {
                onSentence: (sentence) =>
                  input.onSentence?.(document, {
                    flags: sentence.flags,
                    sectionTitle: sentence.section.title,
                    text: sentence.text,
                    targets: sentence.targets,
                    surfaces: sentence.surfaces,
                  }),
              }
            : {}),
        });
        const kind = INSTRUCTION_KINDS.indexOf(document.kind as (typeof INSTRUCTION_KINDS)[number]);
        raw.push({
          id: document.id,
          cardIndexes,
          module: moduleIndex,
          tradeName: document.tradeName,
          kind: kind < 0 ? INSTRUCTION_KINDS.indexOf('unknown') : kind,
          sourceClass: document.sourceClass === 'manufacturer-site' ? 1 : 0,
          hasInteractionSection: extracted.hasInteractionSection ? 1 : 0,
          sections: extracted.sections,
          spans: extracted.spans.slice(0, SPAN_LIMIT_PER_DOCUMENT),
        });
      }
    },

    finish(): { asset: InteractionIndexAsset; report: InteractionBuildReport } {
      // Only the best instructions of each card are indexed: generics repeat each other's text.
      const ranked = new Map<number, RawDocument[]>();
      for (const document of raw) {
        for (const card of document.cardIndexes) {
          const list = ranked.get(card);
          if (list) list.push(document);
          else ranked.set(card, [document]);
        }
      }
      const kept = new Set<string>();
      for (const list of ranked.values()) {
        list.sort((left, right) =>
          compareRankedDocuments(
            { id: left.id, x: left.hasInteractionSection, s: left.sourceClass, k: left.kind },
            { id: right.id, x: right.hasInteractionSection, s: right.sourceClass, k: right.kind },
          ),
        );
        for (const document of list.slice(0, DOCUMENTS_PER_CARD)) kept.add(document.id);
      }
      const allDocuments = raw;
      raw = raw.filter((document) => kept.has(document.id));
      raw.sort((a, b) => a.id.localeCompare(b.id));
      const targetNames = new Set<string>();
      for (const document of raw) {
        for (const span of document.spans)
          for (const target of span.targets) targetNames.add(target);
      }
      // Substances of every card are targets too: a drug can be named by a text without having one.
      for (const card of input.cards) {
        for (const key of cardSubstanceKeys(card)) targetNames.add(`s:${key}`);
      }
      const targets = [...targetNames].toSorted();
      const targetIndex = new Map(targets.map((target, index) => [target, index]));
      const usedTargets = new Map<string, number>();

      const cards: AssetCard[] = input.cards.map((card) => [
        card.id.replace(/^esklp\.mnn\./u, ''),
        [...card.atcCodes],
        cardSubstanceKeys(card).map((key) => targetIndex.get(`s:${key}`) ?? -1),
      ]);

      const documents: Record<string, AssetDocument> = {};
      let spanCount = 0;
      const flagCounts = new Map<number, number>();
      for (const document of raw) {
        const spans = document.spans.map((span) => {
          for (const target of span.targets)
            usedTargets.set(target, (usedTargets.get(target) ?? 0) + 1);
          flagCounts.set(span.flags, (flagCounts.get(span.flags) ?? 0) + 1);
          return [
            span.section,
            span.start,
            span.end,
            span.flags,
            ...span.targets.map((target) => targetIndex.get(target) ?? -1),
          ];
        });
        spanCount += spans.length;
        documents[document.id] = {
          c: document.cardIndexes,
          m: document.module,
          t: document.tradeName,
          k: document.kind,
          s: document.sourceClass,
          x: document.hasInteractionSection,
          sec: document.sections.map((section) => {
            if (!section.id.startsWith(SECTION_ID_PREFIX)) {
              throw new Error(`Unexpected section id ${section.id} in ${document.id}`);
            }
            return [
              section.id.slice(SECTION_ID_PREFIX.length),
              section.checksum.slice(0, SECTION_CHECKSUM_LENGTH),
            ] as const;
          }),
          sp: spans,
        };
      }

      const asset: InteractionIndexAsset = {
        schemaVersion: INTERACTION_INDEX_SCHEMA_VERSION,
        basis: {
          atc: input.atcBasis,
          modules: moduleBasis.map((module) => ({
            id: module.id,
            version: module.version,
            sha256: module.sha256,
          })),
        },
        targets,
        cards,
        modules: moduleIds,
        documents,
      };
      const documentsWithSentences = allDocuments.filter(
        (document) => document.spans.length > 0,
      ).length;
      const cardsWithDocument = new Set(allDocuments.flatMap((document) => document.cardIndexes));
      const cardsWithInteractionSection = new Set(
        allDocuments
          .filter((document) => document.hasInteractionSection)
          .flatMap((document) => document.cardIndexes),
      );
      const cardsWithSentences = new Set(
        allDocuments
          .filter((document) => document.spans.length > 0)
          .flatMap((document) => document.cardIndexes),
      );
      return {
        asset,
        report: {
          summary: {
            documents: documentsSeen,
            documentsIndexed: raw.length,
            documentsWithoutCard: withoutCard.length,
            documentsMatchedByInn,
            documentsWithInteractionSection: allDocuments.filter(
              (document) => document.hasInteractionSection,
            ).length,
            documentsWithSentences,
            sentences: spanCount,
            interactionSectionSentences: flagCounts.get(1) ?? 0,
            specialSectionSentences: flagCounts.get(2) ?? 0,
            contraindicationSentences: flagCounts.get(4) ?? 0,
            cautionSentences: flagCounts.get(8) ?? 0,
            leafletBodySentences: flagCounts.get(16) ?? 0,
            targets: targets.length,
            targetsNamedByText: usedTargets.size,
            cards: input.cards.length,
            cardsWithDocument: cardsWithDocument.size,
            cardsWithInteractionSection: cardsWithInteractionSection.size,
            cardsWithSentences: cardsWithSentences.size,
          },
          classPhrases: {
            total: classReport.phrases,
            fromNames: classReport.fromNames,
            fromAliases: classReport.fromAliases,
            manyBranches: classReport.manyBranches,
            containerWords: classReport.containerWords,
          },
          topTargets: [...usedTargets]
            .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 80)
            .map(([target, sentences]) => ({ target, sentences })),
          documentsWithoutCard: withoutCard.toSorted(),
        },
      };
    },
  };
}
