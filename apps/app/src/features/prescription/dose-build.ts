/**
 * Assembles the dose-rule index (RX1). Pure: `scripts/build-dose-rules.ts` reads the released
 * instruction modules and the ЕСКЛП cards and feeds them in module by module; the unit tests feed it
 * small documents.
 */
import {
  DOSE_RULES_SCHEMA_VERSION,
  type DoseRule,
  type DoseRuleIndexAsset,
  type PackUnit,
  RULE_CAP,
  RULE_DOSE,
  RULE_DURATION,
} from '@localmed/contracts';

import {
  INSTRUCTION_KINDS,
  SECTION_ID_PREFIX,
} from '@/features/drug-interactions/interaction-index';
import {
  cardSubstanceKeys,
  type InteractionCard,
  substanceKey,
} from '@/features/drug-interactions/substance-names';
import { compareDoseDocuments, DOSE_DOCUMENTS_PER_CARD, formClassOf } from './dose-index';
import { extractDoseRules } from './dose-parse';

export interface DoseBuildSection {
  readonly id: string;
  readonly type: string | null;
  readonly title: string;
  /** Read only for the sections that hold doses. */
  readonly chunks: () => readonly string[];
}

export interface DoseBuildDocument {
  readonly id: string;
  readonly kind: string;
  readonly sourceClass: 'grls' | 'manufacturer-site';
  readonly tradeName: string | null;
  readonly inn: string | null;
  readonly dosageForm: string | null;
  /** Registration numbers the document serves, normalised. */
  readonly registrationKeys: readonly string[];
  readonly sections: readonly DoseBuildSection[];
}

export interface DoseBuildRow {
  readonly form: string;
  readonly strength: string;
  readonly unit: PackUnit;
  readonly packs: readonly number[];
  /** Normalised registration numbers of the registry positions that make up the row (not stored in the index). */
  readonly registrations: readonly string[];
}

export interface DoseBuildCard extends InteractionCard {
  readonly registrationKeys: readonly string[];
  readonly rows: readonly DoseBuildRow[];
  readonly trades: readonly string[];
  readonly dispensing: readonly [number, number, number, number] | null;
  readonly essential: boolean;
  /** Latin name of the substance in the nominative, when a reference states it. */
  readonly latin?: string;
}

export interface DoseBuildReport {
  readonly summary: Readonly<Record<string, number>>;
  readonly documentsWithoutCard: readonly string[];
  /** Essential (ЖНВЛП) cards without a single dose rule, for the coverage note. */
  readonly essentialWithoutRules: readonly string[];
}

/** Section types of the modules that hold doses (see `extractDoseRules`). */
const DOSE_SECTION_TYPES = new Set(['dosage', 'other', 'treatment']);
const DOSE_TITLE =
  /способ|режим дозиров|дозиров|рекомендуем\p{L}* доз|прием препарата|приём препарата|применение препарата|как принимать/iu;

function isDoseSection(section: DoseBuildSection): boolean {
  if (section.type === 'dosage') return true;
  return (
    section.type !== null &&
    DOSE_SECTION_TYPES.has(section.type) &&
    DOSE_TITLE.test(section.title) &&
    section.title.length < 80
  );
}

export function createDoseBuilder(input: { readonly cards: readonly DoseBuildCard[] }) {
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
    readonly document: DoseRuleIndexAsset['documents'][string];
    /** The registry rows (dosage form, strength) of the instruction's own registrations. */
    readonly productRows: readonly { readonly form: string; readonly strength: string }[];
  }
  const moduleIds: string[] = [];
  const moduleBasis: { id: string; version: string; sha256: string }[] = [];
  let raw: Raw[] = [];
  const withoutCard: string[] = [];
  let documentsSeen = 0;
  let matchedByInn = 0;
  let documentsWithDosage = 0;
  const counters = { clauses: 0, skippedAmounts: 0 };

  function cardsOfDocument(document: DoseBuildDocument): readonly number[] {
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
      documents: Iterable<DoseBuildDocument>,
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
        const doseSections = document.sections.filter(isDoseSection);
        if (doseSections.length === 0) continue;
        documentsWithDosage += 1;
        const extracted = extractDoseRules(
          doseSections.map((section) => ({
            id: section.id,
            type: section.type,
            title: section.title,
            chunks: section.chunks(),
          })),
          { subject: [document.inn, document.tradeName], dosageForm: document.dosageForm },
        );
        counters.clauses += extracted.stats.clauses;
        counters.skippedAmounts += extracted.stats.skippedAmounts;
        const kind = INSTRUCTION_KINDS.indexOf(document.kind as (typeof INSTRUCTION_KINDS)[number]);
        // Counts of pieces and millilitres in the instruction are valid for the registry rows of its own
        // registrations only; an instruction matched to the card by its substance has none.
        const own = new Set(document.registrationKeys);
        const productRows: { form: string; strength: string }[] = [];
        for (const cardIndex of cardIndexes) {
          for (const row of input.cards[cardIndex]?.rows ?? []) {
            if (!row.registrations.some((key) => own.has(key))) continue;
            if (
              !productRows.some((item) => item.form === row.form && item.strength === row.strength)
            ) {
              productRows.push({ form: row.form, strength: row.strength });
            }
          }
        }
        raw.push({
          id: document.id,
          productRows,
          document: {
            c: [...cardIndexes],
            m: moduleIndex,
            t: document.tradeName,
            k: kind < 0 ? INSTRUCTION_KINDS.indexOf('unknown') : kind,
            s: document.sourceClass === 'manufacturer-site' ? 1 : 0,
            f: document.dosageForm,
            v: extracted.divisible ? 1 : 0,
            sec: extracted.sections.map((section) => {
              if (!section.id.startsWith(SECTION_ID_PREFIX)) {
                throw new Error(`Unexpected section id ${section.id} in ${document.id}`);
              }
              return [section.id.slice(SECTION_ID_PREFIX.length), section.checksum] as [
                string,
                string,
              ];
            }),
            rules: [...extracted.rules],
          },
        });
      }
    },

    finish(): { asset: DoseRuleIndexAsset; report: DoseBuildReport } {
      const all = raw;
      // Only the best instruction of each of the card's most common dosage forms is kept: generics
      // repeat each other's text, but a tablet and a suspension do not.
      const ranked = new Map<number, Raw[]>();
      for (const item of raw) {
        for (const card of item.document.c) {
          const list = ranked.get(card);
          if (list) list.push(item);
          else ranked.set(card, [item]);
        }
      }
      const kept = new Set<string>();
      for (const list of ranked.values()) {
        const byForm = new Map<string, Raw[]>();
        for (const item of list) {
          const key = formClassOf(item.document.f);
          const group = byForm.get(key);
          if (group) group.push(item);
          else byForm.set(key, [item]);
        }
        const bests = [...byForm.values()].map((group) => {
          group.sort((left, right) => compareDoseDocuments(left, right));
          return { best: group[0] as Raw, size: group.length };
        });
        bests.sort(
          (left, right) => right.size - left.size || compareDoseDocuments(left.best, right.best),
        );
        for (const { best } of bests.slice(0, DOSE_DOCUMENTS_PER_CARD)) kept.add(best.id);
      }
      raw = raw.filter((item) => kept.has(item.id)).toSorted((a, b) => a.id.localeCompare(b.id));
      const documents: DoseRuleIndexAsset['documents'] = {};

      const forms: string[] = [];
      const formIndex = new Map<string, number>();
      const indexOfForm = (form: string): number => {
        const key = form.toLocaleLowerCase('ru-RU');
        const found = formIndex.get(key);
        if (found !== undefined) return found;
        formIndex.set(key, forms.length);
        forms.push(key);
        return forms.length - 1;
      };
      for (const item of raw) {
        documents[item.id] = {
          ...item.document,
          ...(item.productRows.length === 0
            ? {}
            : {
                ps: item.productRows.map(
                  (row) => [indexOfForm(row.form), row.strength] as [number, string],
                ),
              }),
        };
      }
      const unitOrder: readonly PackUnit[] = ['piece', 'ml', 'g', 'other'];
      const cards = input.cards.map((card) => ({
        s: card.id.replace(/^esklp\.mnn\./u, ''),
        n: card.name,
        r: card.rows.map(
          (row) =>
            [indexOfForm(row.form), row.strength, unitOrder.indexOf(row.unit), [...row.packs]] as [
              number,
              string,
              number,
              number[],
            ],
        ),
        ...(card.latin ? { l: card.latin } : {}),
        t: [...card.trades],
        a: [...card.atcCodes],
        x: card.dispensing ? ([...card.dispensing] as [number, number, number, number]) : null,
        e: (card.essential ? 1 : 0) as 0 | 1,
      }));
      const asset: DoseRuleIndexAsset = {
        schemaVersion: DOSE_RULES_SCHEMA_VERSION,
        basis: { esklpEdition: '', modules: moduleBasis.map((module) => ({ ...module })) },
        modules: moduleIds,
        forms,
        cards,
        documents,
      };

      const cardRules = (predicate: (rule: DoseRule) => boolean): Set<number> => {
        const set = new Set<number>();
        for (const item of all) {
          if (!item.document.rules.some(predicate)) continue;
          for (const card of item.document.c) set.add(card);
        }
        return set;
      };
      const isAdult = (rule: DoseRule): boolean =>
        rule.k === RULE_DOSE && (rule.p0 === undefined || rule.p0 >= 6000) && rule.c === undefined;
      const isChild = (rule: DoseRule): boolean =>
        rule.k === RULE_DOSE &&
        rule.c === undefined &&
        (rule.p1 !== undefined || rule.w1 !== undefined || (rule.g ?? 0) % 4 >= 2);
      const withDose = cardRules((rule) => rule.k === RULE_DOSE);
      const essentialIndexes = input.cards
        .map((card, index) => (card.essential ? index : -1))
        .filter((index) => index >= 0);
      const essentialWithDocument = new Set<number>();
      for (const item of all) for (const card of item.document.c) essentialWithDocument.add(card);
      const countOf = (set: Set<number>, among: readonly number[]): number =>
        among.filter((index) => set.has(index)).length;
      const allCards = input.cards.map((_, index) => index);
      const ruleTotals = (kind: 0 | 1 | 2): number =>
        all.reduce(
          (sum, item) => sum + item.document.rules.filter((rule) => rule.k === kind).length,
          0,
        );
      return {
        asset,
        report: {
          summary: {
            documents: documentsSeen,
            documentsWithoutCard: withoutCard.length,
            documentsMatchedByInn: matchedByInn,
            documentsWithDosageSection: documentsWithDosage,
            documentsIndexed: raw.length,
            documentsIndexedWithDoseRule: raw.filter((item) =>
              item.document.rules.some((rule) => rule.k === RULE_DOSE),
            ).length,
            cards: input.cards.length,
            cardsWithDocument: essentialWithDocumentCount(all, allCards),
            cardsWithDoseRule: countOf(withDose, allCards),
            cardsWithAdultDoseRule: countOf(cardRules(isAdult), allCards),
            cardsWithChildDoseRule: countOf(cardRules(isChild), allCards),
            essentialCards: essentialIndexes.length,
            essentialCardsWithDocument: countOf(essentialWithDocument, essentialIndexes),
            essentialCardsWithDoseRule: countOf(withDose, essentialIndexes),
            essentialCardsWithAdultDoseRule: countOf(cardRules(isAdult), essentialIndexes),
            essentialCardsWithChildDoseRule: countOf(cardRules(isChild), essentialIndexes),
            essentialCardsWithCap: countOf(
              cardRules((rule) => rule.k === RULE_CAP),
              essentialIndexes,
            ),
            essentialCardsWithDuration: countOf(
              cardRules((rule) => rule.k === RULE_DURATION || rule.t0 !== undefined),
              essentialIndexes,
            ),
            doseRules: ruleTotals(RULE_DOSE),
            capRules: ruleTotals(RULE_CAP),
            durationRules: ruleTotals(RULE_DURATION),
            ...counters,
          },
          documentsWithoutCard: withoutCard.toSorted(),
          essentialWithoutRules: essentialIndexes
            .filter((index) => !withDose.has(index))
            .map((index) => input.cards[index]?.name ?? ''),
        },
      };
    },
  };
}

function essentialWithDocumentCount(
  all: readonly { readonly document: { readonly c: readonly number[] } }[],
  among: readonly number[],
): number {
  const set = new Set<number>();
  for (const item of all) for (const card of item.document.c) set.add(card);
  return among.filter((index) => set.has(index)).length;
}
