/**
 * Assembles the drug-comparison index (CMP1). Pure: `scripts/build-drug-comparison.ts` reads the
 * released instruction modules, the ЕСКЛП cards and the ГРЛС register and feeds them in.
 */
import {
  INSTRUCTION_KINDS,
  type IndexedInstructionKind,
} from '@/features/drug-interactions/interaction-index';
import {
  cardSubstanceKeys,
  type InteractionCard,
  substanceKey,
} from '@/features/drug-interactions/substance-names';
import {
  type AssetCard,
  type AssetDocument,
  type AssetForm,
  COMPARISON_INDEX_SCHEMA_VERSION,
  type ComparisonIndexAsset,
  createComparisonIndex,
  ESSENTIAL_LISTED,
  ESSENTIAL_NOT_LISTED,
  ROW_MASK,
  SECTION_BITS,
} from './comparison-index';
import { QUOTE_ROWS, SECTION_ROWS } from './comparison-sections';

/** What the register says about a registration: its conditions of dispensing. */
export type Dispensing = 'rx' | 'otc' | 'mixed' | 'unknown';

export interface ComparisonBuildSection {
  readonly type: string | null;
  readonly title: string;
  /** The section holds text (at least one non-empty chunk). */
  readonly hasText: boolean;
}

export interface ComparisonBuildDocument {
  readonly id: string;
  readonly kind: string;
  readonly sourceClass: 'grls' | 'manufacturer-site';
  readonly tradeName: string | null;
  readonly inn: string | null;
  readonly dosageForm: string | null;
  /** Registration numbers the document serves, normalised. */
  readonly registrationKeys: readonly string[];
  readonly sections: readonly ComparisonBuildSection[];
}

export interface RegistryFacts {
  /** Dosage form (lower case) → strengths and ЖНВЛП flags. */
  readonly forms: ReadonlyMap<string, { strengths: Set<string>; essential: number }>;
  readonly registrations: ReadonlySet<string>;
  readonly tradeNames: ReadonlySet<string>;
  readonly manufacturers: ReadonlySet<string>;
  readonly holders: ReadonlySet<string>;
  readonly groups: ReadonlySet<string>;
}

export interface ComparisonBuildCard extends InteractionCard {
  readonly registrationKeys: readonly string[];
  readonly facts: RegistryFacts;
}

/** «1.0мг/мл» → «1 мг/мл», «0.5мг» → «0,5 мг»: the registry's spellings of one strength meet. */
export function normalizeStrength(raw: string): string | null {
  const text = raw.trim().toLocaleLowerCase('ru-RU');
  if (text === '' || text === '~' || text === 'не указано') return null;
  return text
    .replace(/(\d)\.0+(?!\d)/gu, '$1')
    .replace(/(\d)\.(\d)/gu, '$1,$2')
    .replace(/(\d)([а-яёa-zµ%])/gu, '$1 $2')
    .replace(/\s+/gu, ' ')
    .replace(/\s*\+\s*/gu, ' + ');
}

const LEGAL_FORMS = new Set([
  'ооо',
  'ао',
  'зао',
  'пао',
  'оао',
  'ип',
  'фгуп',
  'фгбу',
  'ltd',
  'gmbh',
  'inc',
  'ag',
  'sa',
  'llc',
  'co',
  'ltd.',
  'ооо.',
  'plc',
  'bv',
  'nv',
  'srl',
  'spa',
  'sl',
]);

/** A company as one comparable key: case, quotes and legal forms («ООО», «Ltd.») do not matter. */
export function companyKey(raw: string): string {
  const words = raw
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[«»"“”„'.,()]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '' && !LEGAL_FORMS.has(word));
  return words.join(' ');
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '~'
    ? value.trim()
    : null;
}

function recordsOf(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value.filter((item) => typeof item === 'object' && item !== null) as readonly Record<
        string,
        unknown
      >[])
    : [];
}

/** The registry facts of one ЕСКЛП МНН card, from its metadata. */
export function registryFacts(
  metadata: Readonly<Record<string, unknown>>,
  normalizeRegistration: (value: string) => string,
): RegistryFacts {
  const forms = new Map<string, { strengths: Set<string>; essential: number }>();
  const registrations = new Set<string>();
  const tradeNames = new Set<string>();
  const manufacturers = new Set<string>();
  const holders = new Set<string>();
  const groups = new Set<string>();
  for (const node of recordsOf(metadata['smnnNodes'])) {
    const form = textOf(node['dosageForm'])?.toLocaleLowerCase('ru-RU') ?? '';
    const entry = forms.get(form) ?? { strengths: new Set<string>(), essential: 0 };
    const strength = textOf(node['strength']);
    const normalized = strength ? normalizeStrength(strength) : null;
    if (normalized) entry.strengths.add(normalized);
    if (node['essentialDrug'] === true) entry.essential |= ESSENTIAL_LISTED;
    else if (node['essentialDrug'] === false) entry.essential |= ESSENTIAL_NOT_LISTED;
    forms.set(form, entry);
    const group = textOf(node['pharmacotherapeuticGroup']);
    if (group) groups.add(group);
    for (const list of [node['tradeNames'], node['klpPositions']]) {
      for (const item of recordsOf(list)) {
        const registration = textOf(item['registrationNumber']);
        if (registration) registrations.add(normalizeRegistration(registration));
        const name = textOf(item['tradeName']);
        if (name) tradeNames.add(companyKey(name.replaceAll('®', '')));
        const manufacturer = textOf(item['manufacturer']);
        if (manufacturer) manufacturers.add(companyKey(manufacturer));
        const holder = textOf(item['holder']);
        if (holder) holders.add(companyKey(holder));
      }
    }
  }
  forms.delete('');
  return { forms, registrations, tradeNames, manufacturers, holders, groups };
}

export interface ComparisonBuildReport {
  readonly summary: Readonly<Record<string, number>>;
  readonly documentsWithoutCard: readonly string[];
  /**
   * The 200 most common substances, as INT1 defines them (single-substance ЕСКЛП cards with the
   * most registrations), and how many have every quoted row in the instruction the tool reads first.
   */
  readonly top200: {
    readonly definition: string;
    readonly slugs: readonly string[];
    readonly withInstruction: number;
    readonly allSixRowsInBestInstruction: number;
    readonly allSixRowsInSomeInstruction: number;
    readonly rowShare: Readonly<Record<string, number>>;
    readonly withGroupLine: number;
    readonly withDispensingLine: number;
  };
}

/** The section mask of an instruction: which quoted rows it has text for. */
export function sectionMask(sections: readonly ComparisonBuildSection[]): number {
  let mask = 0;
  for (const spec of SECTION_ROWS) {
    const bit = SECTION_BITS[spec.id as keyof typeof SECTION_BITS];
    if (
      sections.some(
        (section) => section.hasText && section.type !== null && spec.types.includes(section.type),
      )
    ) {
      mask |= bit;
    }
  }
  for (const spec of QUOTE_ROWS) {
    const bit = SECTION_BITS[spec.id as keyof typeof SECTION_BITS];
    if (
      sections.some(
        (section) =>
          section.hasText &&
          section.type === spec.type &&
          (!spec.titlePattern || spec.titlePattern.test(section.title)),
      )
    ) {
      mask |= bit;
    }
  }
  return mask;
}

function dispensingCounts(
  keys: readonly string[],
  register: ReadonlyMap<string, Dispensing>,
): AssetCard['x'] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  let seen = 0;
  for (const key of new Set(keys)) {
    const value = register.get(key);
    if (!value) continue;
    seen += 1;
    counts[value === 'rx' ? 0 : value === 'otc' ? 1 : value === 'mixed' ? 2 : 3] += 1;
  }
  return seen === 0 ? null : counts;
}

function cardRow(
  card: ComparisonBuildCard,
  forms: string[],
  formIndex: Map<string, number>,
  register: ReadonlyMap<string, Dispensing>,
): AssetCard {
  const indexOf = (form: string): number => {
    const known = formIndex.get(form);
    if (known !== undefined) return known;
    formIndex.set(form, forms.length);
    forms.push(form);
    return forms.length - 1;
  };
  const cardForms: AssetForm[] = [...card.facts.forms.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right, 'ru'))
    .map(([form, entry]) => [
      indexOf(form),
      [...entry.strengths].toSorted((left, right) =>
        left.localeCompare(right, 'ru', { numeric: true }),
      ),
      entry.essential,
    ]);
  return {
    s: card.id.replace(/^esklp\.mnn\./u, ''),
    n: card.name,
    a: [...new Set(card.atcCodes)].toSorted(),
    g: [...card.facts.groups].toSorted((left, right) => left.localeCompare(right, 'ru')),
    f: cardForms,
    r: card.facts.registrations.size,
    t: card.facts.tradeNames.size,
    m: card.facts.manufacturers.size,
    h: card.facts.holders.size,
    x: dispensingCounts(card.registrationKeys, register),
  };
}

export function createComparisonBuilder(input: {
  readonly cards: readonly ComparisonBuildCard[];
  /** Valid ГРЛС registrations (normalised number) with their conditions of dispensing. */
  readonly register: ReadonlyMap<string, Dispensing>;
  readonly editions: { readonly esklp: string; readonly grls: string };
}) {
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

  const forms: string[] = [];
  const formIndex = new Map<string, number>();
  const moduleIds: string[] = [];
  const moduleBasis: { id: string; version: string; sha256: string }[] = [];
  const documents: Record<string, AssetDocument> = {};
  const withoutCard: string[] = [];
  let documentsSeen = 0;
  let matchedByInn = 0;

  function cardsOfDocument(document: ComparisonBuildDocument): readonly number[] {
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

  function formOf(value: string | null): number {
    const text = value?.trim().toLocaleLowerCase('ru-RU');
    if (!text) return -1;
    const known = formIndex.get(text);
    if (known !== undefined) return known;
    formIndex.set(text, forms.length);
    forms.push(text);
    return forms.length - 1;
  }

  return {
    addModule(
      module: { id: string; version: string; sha256: string },
      docs: Iterable<ComparisonBuildDocument>,
    ): void {
      const moduleIndex = moduleIds.length;
      moduleIds.push(module.id);
      moduleBasis.push(module);
      for (const document of docs) {
        documentsSeen += 1;
        const cards = cardsOfDocument(document);
        if (cards.length === 0) {
          withoutCard.push(document.id);
          continue;
        }
        const kind = INSTRUCTION_KINDS.indexOf(document.kind as IndexedInstructionKind);
        documents[document.id] = {
          c: cards,
          m: moduleIndex,
          t: document.tradeName,
          k: kind < 0 ? INSTRUCTION_KINDS.indexOf('unknown') : kind,
          s: document.sourceClass === 'manufacturer-site' ? 1 : 0,
          f: formOf(document.dosageForm),
          y: sectionMask(document.sections),
        };
      }
    },

    finish(): { asset: ComparisonIndexAsset; report: ComparisonBuildReport } {
      const cards = input.cards.map((card) => cardRow(card, forms, formIndex, input.register));
      const sortedDocuments = Object.fromEntries(
        Object.entries(documents).toSorted(([left], [right]) => left.localeCompare(right)),
      );
      const asset: ComparisonIndexAsset = {
        schemaVersion: COMPARISON_INDEX_SCHEMA_VERSION,
        basis: {
          esklp: { edition: input.editions.esklp },
          grls: { edition: input.editions.grls },
          modules: moduleBasis.map((module) => ({ ...module })),
        },
        modules: moduleIds,
        forms,
        cards,
        documents: sortedDocuments,
      };
      const cardsWith = new Set<number>();
      const cardsComplete = new Set<number>();
      for (const document of Object.values(sortedDocuments)) {
        for (const card of document.c) {
          cardsWith.add(card);
          if ((document.y & ROW_MASK) === ROW_MASK) cardsComplete.add(card);
        }
      }
      const top = input.cards
        .map((card, position) => ({ card, position }))
        .filter(({ card }) => card.components.length === 0 && !card.name.includes('+'))
        .toSorted(
          (a, b) =>
            b.card.registrationKeys.length - a.card.registrationKeys.length ||
            a.card.id.localeCompare(b.card.id),
        )
        .slice(0, 200);
      const index = createComparisonIndex(asset);
      const rowShare: Record<string, number> = {};
      for (const spec of SECTION_ROWS) rowShare[spec.id] = 0;
      let withInstruction = 0;
      let allBest = 0;
      let allSome = 0;
      let withGroup = 0;
      let withDispensing = 0;
      for (const { position } of top) {
        const ids = index.documentsOfCard.get(position) ?? [];
        const best = ids[0] ? sortedDocuments[ids[0]] : undefined;
        if (!best) continue;
        withInstruction += 1;
        if ((best.y & ROW_MASK) === ROW_MASK) allBest += 1;
        if (ids.some((id) => ((sortedDocuments[id]?.y ?? 0) & ROW_MASK) === ROW_MASK)) allSome += 1;
        for (const spec of SECTION_ROWS) {
          if ((best.y & SECTION_BITS[spec.id as keyof typeof SECTION_BITS]) !== 0) {
            rowShare[spec.id] = (rowShare[spec.id] ?? 0) + 1;
          }
        }
        if ((best.y & SECTION_BITS.group) !== 0) withGroup += 1;
        if ((best.y & SECTION_BITS.dispensing) !== 0) withDispensing += 1;
      }
      return {
        asset,
        report: {
          top200: {
            definition: 'single-substance ЕСКЛП cards with the most registrations',
            slugs: top.map(({ card }) => card.id.replace(/^esklp\.mnn\./u, '')),
            withInstruction,
            allSixRowsInBestInstruction: allBest,
            allSixRowsInSomeInstruction: allSome,
            rowShare,
            withGroupLine: withGroup,
            withDispensingLine: withDispensing,
          },
          summary: {
            documents: documentsSeen,
            documentsWithoutCard: withoutCard.length,
            documentsMatchedByInn: matchedByInn,
            documentsIndexed: Object.keys(sortedDocuments).length,
            cards: cards.length,
            cardsWithInstruction: cardsWith.size,
            cardsWithCompleteInstruction: cardsComplete.size,
            cardsWithDispensing: cards.filter((card) => card.x !== null).length,
            forms: forms.length,
          },
          documentsWithoutCard: withoutCard.toSorted(),
        },
      };
    },
  };
}
