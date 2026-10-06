/**
 * Assembles the pregnancy / lactation / age-limit index (SAFE1). Pure:
 * `scripts/build-medication-safety.ts` reads the released modules and the ЕСКЛП cards and feeds them
 * in module by module.
 */
import {
  INSTRUCTION_KINDS,
  SECTION_CHECKSUM_LENGTH,
  SECTION_ID_PREFIX,
} from '@/features/drug-interactions/interaction-index';
import {
  cardSubstanceKeys,
  type InteractionCard,
  substanceKey,
} from '@/features/drug-interactions/substance-names';
import { TOPIC_LACTATION, TOPIC_PREGNANCY } from './pregnancy-words';
import { extractSafety, type SafetySectionInput } from './safety-extract';
import {
  compareSafetyDocuments,
  flagsOrigin,
  flagsTopic,
  LIMIT_AGE_BELOW,
  LIMIT_AGE_FROM,
  LIMIT_AGE_RANGE,
  LIMIT_CATEGORY,
  LIMIT_WIDTH,
  ORIGIN_CAUTION,
  ORIGIN_CONTRAINDICATIONS,
  ORIGIN_SPECIAL,
  SAFETY_DOCUMENTS_PER_CARD,
  SAFETY_INDEX_SCHEMA_VERSION,
  type SafetyDocument,
  type SafetyIndexAsset,
} from './safety-index';

export interface SafetyBuildSection extends Omit<SafetySectionInput, 'chunks'> {
  /** Read only for the sections that are searched. */
  readonly chunks: () => readonly string[];
}

export interface SafetyBuildDocument {
  readonly id: string;
  readonly kind: string;
  readonly sourceClass: 'grls' | 'manufacturer-site';
  readonly tradeName: string | null;
  readonly inn: string | null;
  readonly dosageForm: string | null;
  /** Registration numbers the document serves, normalised. */
  readonly registrationKeys: readonly string[];
  readonly sections: readonly SafetyBuildSection[];
}

export interface SafetyBuildCard extends InteractionCard {
  /** Normalised registration numbers of the card's products. */
  readonly registrationKeys: readonly string[];
}

export interface SafetyBuildReport {
  readonly summary: Readonly<Record<string, number>>;
  readonly documentsWithoutCard: readonly string[];
}

/** Section types of the modules that the extractor reads. */
const SEARCHED_TYPES = new Set([
  'pregnancy',
  'contraindications',
  'caution',
  'special-instructions',
  'dosage',
  'indications',
  'other',
  'treatment',
]);

/** The dosage form's first word («таблетки, покрытые оболочкой» → «таблетки»): its class. */
export function formClassOf(dosageForm: string | null): string {
  const first = dosageForm?.toLocaleLowerCase('ru-RU').match(/[а-яёa-z]+/u)?.[0];
  return first ?? '';
}

const WARNING_ORIGINS: ReadonlySet<number> = new Set([
  ORIGIN_CONTRAINDICATIONS,
  ORIGIN_CAUTION,
  ORIGIN_SPECIAL,
]);
const ANY_ORIGIN: ReadonlySet<number> | null = null;

/** The limit codes of an age entry (`[section, start, end, flags, (start, end, code, lo, hi)+]`). */
function limitCodesOf(entry: readonly number[]): readonly number[] {
  const codes: number[] = [];
  for (let at = 4; at + 2 < entry.length; at += LIMIT_WIDTH) codes.push(entry[at + 2] ?? -1);
  return codes;
}

function hasLimitCode(entry: readonly number[], wanted: readonly number[]): boolean {
  return limitCodesOf(entry).some((code) => wanted.includes(code));
}

/** A numeric age limit (or, with `categoryOnly`, an unnumbered age group) in the given sections. */
function hasAgeLimit(
  document: SafetyDocument,
  origins: ReadonlySet<number> | null,
  categoryOnly: boolean,
): boolean {
  return document.ag.some(
    (entry) =>
      (origins === null || origins.has(flagsOrigin(entry[3] ?? 0))) &&
      hasLimitCode(
        entry,
        categoryOnly ? [LIMIT_CATEGORY] : [LIMIT_AGE_BELOW, LIMIT_AGE_FROM, LIMIT_AGE_RANGE],
      ),
  );
}

function hasTopic(document: SafetyDocument, topic: number): boolean {
  return document.pl.some((entry) => (flagsTopic(entry[3] ?? 0) & topic) !== 0);
}

export function createSafetyBuilder(input: { readonly cards: readonly SafetyBuildCard[] }) {
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

  interface Raw {
    readonly id: string;
    readonly document: SafetyDocument;
  }
  const moduleIds: string[] = [];
  const moduleBasis: { id: string; version: string; sha256: string }[] = [];
  let raw: Raw[] = [];
  const withoutCard: string[] = [];
  let documentsSeen = 0;
  let matchedByInn = 0;
  const counters = {
    pregnancySentences: 0,
    lactationSentences: 0,
    contraindicationMentions: 0,
    ageEntries: 0,
    categoryEntries: 0,
  };

  function cardsOfDocument(document: SafetyBuildDocument): readonly number[] {
    const found = new Set<number>();
    for (const key of document.registrationKeys) {
      for (const card of cardsByRegistration.get(key) ?? []) found.add(card);
    }
    if (found.size > 0) return [...found].toSorted((a, b) => a - b);
    if (document.inn) {
      const keys = document.inn
        .split('+')
        .map(substanceKey)
        .filter((key) => key !== '')
        .toSorted();
      const matched = cardsByKeySet.get(keys.join('|'));
      if (matched) {
        matchedByInn += 1;
        return matched;
      }
    }
    return [];
  }

  return {
    addModule(
      module: { id: string; version: string; sha256: string },
      documents: Iterable<SafetyBuildDocument>,
    ): void {
      const moduleIndex = moduleIds.length;
      moduleIds.push(module.id);
      moduleBasis.push(module);
      for (const document of documents) {
        documentsSeen += 1;
        const cardIndexes = cardsOfDocument(document);
        if (cardIndexes.length === 0) {
          withoutCard.push(document.id);
          continue;
        }
        const sections: SafetySectionInput[] = document.sections.map((section) => ({
          id: section.id,
          type: section.type,
          title: section.title,
          chunks: section.type !== null && SEARCHED_TYPES.has(section.type) ? section.chunks() : [],
        }));
        const extracted = extractSafety(sections);
        for (const entry of extracted.pl) {
          const flags = entry[3] ?? 0;
          if (flagsOrigin(flags) === 0) {
            if (flagsTopic(flags) & TOPIC_PREGNANCY) counters.pregnancySentences += 1;
            if (flagsTopic(flags) & TOPIC_LACTATION) counters.lactationSentences += 1;
          } else counters.contraindicationMentions += 1;
        }
        for (const entry of extracted.ag) {
          const code = entry[6];
          if (code === LIMIT_CATEGORY) counters.categoryEntries += 1;
          else counters.ageEntries += 1;
        }
        const kind = INSTRUCTION_KINDS.indexOf(document.kind as (typeof INSTRUCTION_KINDS)[number]);
        raw.push({
          id: document.id,
          document: {
            c: cardIndexes,
            m: moduleIndex,
            t: document.tradeName,
            k: kind < 0 ? INSTRUCTION_KINDS.indexOf('unknown') : kind,
            s: document.sourceClass === 'manufacturer-site' ? 1 : 0,
            f: document.dosageForm,
            p: extracted.hasPregnancySection ? 1 : 0,
            a: extracted.ag.length > 0 ? 1 : 0,
            n: 1,
            sec: extracted.sections.map((section) => {
              if (!section.id.startsWith(SECTION_ID_PREFIX)) {
                throw new Error(`Unexpected section id ${section.id} in ${document.id}`);
              }
              return [
                section.id.slice(SECTION_ID_PREFIX.length),
                section.checksum.slice(0, SECTION_CHECKSUM_LENGTH),
              ] as const;
            }),
            pl: extracted.pl,
            ag: extracted.ag,
          },
        });
      }
    },

    finish(): { asset: SafetyIndexAsset; report: SafetyBuildReport } {
      const all = raw;
      // Only the best instruction of each of the card's most common dosage forms is indexed:
      // generics repeat each other's text, but a tablet and an eye ointment do not.
      const ranked = new Map<number, Raw[]>();
      for (const item of raw) {
        for (const card of item.document.c) {
          const list = ranked.get(card);
          if (list) list.push(item);
          else ranked.set(card, [item]);
        }
      }
      const kept = new Set<string>();
      const popularity = new Map<string, number>();
      for (const list of ranked.values()) {
        const byForm = new Map<string, Raw[]>();
        for (const item of list) {
          const key = formClassOf(item.document.f);
          const group = byForm.get(key);
          if (group) group.push(item);
          else byForm.set(key, [item]);
        }
        const bests = [...byForm.values()].map((group) => {
          group.sort((left, right) =>
            compareSafetyDocuments(
              { id: left.id, ...left.document },
              { id: right.id, ...right.document },
            ),
          );
          return { best: group[0] as Raw, size: group.length };
        });
        bests.sort(
          (left, right) =>
            right.size - left.size ||
            compareSafetyDocuments(
              { id: left.best.id, ...left.best.document },
              { id: right.best.id, ...right.best.document },
            ),
        );
        for (const { best, size } of bests.slice(0, SAFETY_DOCUMENTS_PER_CARD)) {
          kept.add(best.id);
          popularity.set(best.id, Math.max(popularity.get(best.id) ?? 1, size));
        }
      }
      raw = raw.filter((item) => kept.has(item.id)).toSorted((a, b) => a.id.localeCompare(b.id));
      const documents: Record<string, SafetyDocument> = {};
      for (const item of raw) {
        documents[item.id] = { ...item.document, n: Math.min(popularity.get(item.id) ?? 1, 999) };
      }
      const asset: SafetyIndexAsset = {
        schemaVersion: SAFETY_INDEX_SCHEMA_VERSION,
        basis: { modules: moduleBasis.map((module) => ({ ...module })) },
        modules: moduleIds,
        cards: input.cards.map((card) => card.id.replace(/^esklp\.mnn\./u, '')),
        documents,
      };
      const cardsWith = (predicate: (document: SafetyDocument) => boolean): number => {
        const set = new Set<number>();
        for (const item of all)
          if (predicate(item.document)) for (const card of item.document.c) set.add(card);
        return set.size;
      };
      return {
        asset,
        report: {
          summary: {
            documents: documentsSeen,
            documentsWithoutCard: withoutCard.length,
            documentsMatchedByInn: matchedByInn,
            documentsIndexed: raw.length,
            documentsWithPregnancySection: all.filter((item) => item.document.p === 1).length,
            documentsWithAgeLimit: all.filter((item) => item.document.a === 1).length,
            cards: input.cards.length,
            cardsWithDocument: cardsWith(() => true),
            cardsWithPregnancySection: cardsWith((document) => document.p === 1),
            cardsWithAgeLimit: cardsWith((document) => document.a === 1),
            cardsWithPregnancyOrContraindicationMention: cardsWith(
              (document) => document.pl.length > 0,
            ),
            cardsWithPregnancySentence: cardsWith((document) =>
              hasTopic(document, TOPIC_PREGNANCY),
            ),
            cardsWithLactationSentence: cardsWith((document) =>
              hasTopic(document, TOPIC_LACTATION),
            ),
            cardsWithAgeLimitInWarnings: cardsWith((document) =>
              hasAgeLimit(document, WARNING_ORIGINS, false),
            ),
            cardsWithNumericAgeLimit: cardsWith((document) =>
              hasAgeLimit(document, ANY_ORIGIN, false),
            ),
            cardsWithOnlyUnnumberedAgeGroup: cardsWith(
              (document) =>
                hasAgeLimit(document, ANY_ORIGIN, true) &&
                !hasAgeLimit(document, ANY_ORIGIN, false),
            ),
            cardsWithWeightLimit: cardsWith((document) =>
              document.ag.some((entry) => hasLimitCode(entry, [3, 4, 5])),
            ),
            ...counters,
          },
          documentsWithoutCard: withoutCard.toSorted(),
        },
      };
    },
  };
}
