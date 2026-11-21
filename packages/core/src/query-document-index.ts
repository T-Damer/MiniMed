import {
  buildNameVocabulary,
  buildNameVocabularySliced,
  type NameVocabulary,
  normalizeIcd10Lookalikes,
  normalizeSurfaceText,
  searchSubjectText,
  type TimeSlicer,
} from '@localmed/search-lexical';
import type { SearchDocumentDescriptor } from '@localmed/storage';

type IdentityIndex = Map<string, string | Set<string>>;
const NO_IDENTITY_IDS: ReadonlySet<string> = new Set();

function exactIds(index: IdentityIndex, query: string): ReadonlySet<string> {
  const ids = index.get(searchSubjectText(query));
  return typeof ids === 'string' ? new Set([ids]) : (ids ?? NO_IDENTITY_IDS);
}

/** Immutable per-core projection; never shared across installed corpus generations. */
export class QueryDocumentIndex {
  readonly byId: ReadonlyMap<string, SearchDocumentDescriptor>;
  private readonly aliases: IdentityIndex = new Map();
  private readonly titles: IdentityIndex = new Map();
  private readonly navigationAliases: IdentityIndex = new Map();
  private readonly shortTitles: IdentityIndex = new Map();
  private readonly documents: readonly SearchDocumentDescriptor[];
  private namePrefixes: ReadonlySet<string> | undefined;
  private names: NameVocabulary | undefined;
  private latinNames: ReadonlyMap<string, readonly string[]> | undefined;
  private icdCards: ReadonlyMap<string, readonly string[]> | undefined;
  private linkedProducts: ReadonlyMap<string, readonly string[]> | undefined;
  private pointersByTarget: ReadonlyMap<string, readonly string[]> | undefined;

  constructor(documents: readonly SearchDocumentDescriptor[]) {
    this.documents = documents;
    this.byId = new Map(documents.map((document) => [document.id, document]));
    for (const document of documents) {
      this.addIdentity(document.title, document.id, this.titles);
      if (document.shortTitle) {
        this.addIdentity(document.shortTitle, document.id, this.shortTitles);
        // «ИМТ — взрослые и дети»: the abbreviation before the dash names the document too.
        const abbreviation = leadingAbbreviation(document.shortTitle);
        if (abbreviation) this.addIdentity(abbreviation, document.id, this.shortTitles);
      }
      for (const key of ['declaredAliases', 'navigationAliases'] as const) {
        const names = document.metadata[key];
        if (!Array.isArray(names)) continue;
        for (const name of names) {
          if (typeof name !== 'string') continue;
          this.addIdentity(name, document.id, this.aliases);
          if (key === 'navigationAliases') {
            this.addIdentity(name, document.id, this.navigationAliases);
          }
        }
      }
    }
  }

  exactAliasIds(query: string): ReadonlySet<string> {
    return exactIds(this.aliases, query);
  }

  exactTitleIds(query: string): ReadonlySet<string> {
    return exactIds(this.titles, query);
  }

  exactNavigationAliasIds(query: string): ReadonlySet<string> {
    return exactIds(this.navigationAliases, query);
  }

  exactShortTitleIds(query: string): ReadonlySet<string> {
    return exactIds(this.shortTitles, query);
  }

  /**
   * The МКБ-10 cards of the code typed as the whole query («J18», «j18.9», Cyrillic look-alike
   * letters too): the card whose own title starts with the code. A recommendation or article that
   * merely lists the code is no such card.
   */
  exactIcdCardIds(query: string): readonly string[] {
    const code = normalizeIcd10Lookalikes(normalizeSurfaceText(query).trim()).toUpperCase();
    if (!ICD_CODE.test(code)) return [];
    this.icdCards ??= buildIcdCards(this.documents);
    return this.icdCards.get(code) ?? [];
  }

  exactIdentityIds(query: string): ReadonlySet<string> {
    return new Set([
      ...this.exactTitleIds(query),
      ...this.exactNavigationAliasIds(query),
      ...this.exactShortTitleIds(query),
    ]);
  }

  /**
   * True when `word` begins a word of some document title or alias of the mounted corpus: the first
   * five letters (all of a shorter word). A transliterated or layout-swapped name is only worth a
   * search when its words look like names the corpus has; built on the first use.
   */
  hasNameWordPrefix(word: string): boolean {
    this.namePrefixes ??= buildNameWordPrefixes(this.documents);
    return this.namePrefixes.has(word.slice(0, NAME_PREFIX_LENGTH));
  }

  /**
   * Every word of the document titles, short titles, aliases and terminology names, plus
   * `extraNames` (the core's exact source names of modules not installed), weighted by the names
   * containing it: what a misspelt word is corrected to (`correctWord`). Built on the first use;
   * later `extraNames` are ignored.
   */
  /**
   * The tables a search builds on first use, one step each, so an idle warm-up can build them
   * between other work (`MedicalCore.warmUp`). Each step is a no-op once its table exists.
   */
  warmUpSteps(): readonly (() => void)[] {
    return [
      () => {
        this.icdCards ??= buildIcdCards(this.documents);
      },
      () => {
        this.namePrefixes ??= buildNameWordPrefixes(this.documents);
      },
      () => {
        this.latinNames ??= buildLatinNames(this.documents);
      },
      () => {
        this.linkedProducts ??= buildLinkedProducts(this.documents);
      },
      () => {
        this.pointersByTarget ??= buildPointersByTarget(this.documents);
      },
    ];
  }

  nameVocabulary(extraNames: readonly string[] = []): NameVocabulary {
    this.names ??= buildNameVocabulary([
      ...this.documents.map(normalizedDocumentNames),
      ...extraNames.map(normalizeSurfaceText),
    ]);
    return this.names;
  }

  /**
   * {@link nameVocabulary} built in slices: in one piece it held the main thread for 0.6 s at
   * phone speed right after the start. A search that built the table meanwhile wins.
   */
  async nameVocabularySliced(
    extraNames: readonly string[],
    slice: TimeSlicer,
  ): Promise<NameVocabulary> {
    if (this.names) return this.names;
    const names: string[] = [];
    for (const document of this.documents) {
      names.push(normalizedDocumentNames(document));
      const due = slice();
      if (due) await due;
    }
    for (const name of extraNames) {
      names.push(normalizeSurfaceText(name));
      const due = slice();
      if (due) await due;
    }
    const vocabulary = await buildNameVocabularySliced(names, slice);
    this.names ??= vocabulary;
    return this.names;
  }

  /**
   * Normalizes the names the constructor indexes, in slices, so that the constructor (which a
   * search may also run, in one piece) finds them already normalized.
   */
  static async prepare(
    documents: readonly SearchDocumentDescriptor[],
    slice: TimeSlicer,
  ): Promise<void> {
    for (const document of documents) {
      normalizeSurfaceText(document.title);
      if (document.shortTitle) normalizeSurfaceText(document.shortTitle);
      for (const key of ['declaredAliases', 'navigationAliases'] as const) {
        const names = document.metadata[key];
        if (!Array.isArray(names)) continue;
        for (const name of names) if (typeof name === 'string') normalizeSurfaceText(name);
      }
      const due = slice();
      if (due) await due;
    }
  }

  /** Titles of the documents whose declared Latin name (`nameLat`) is `query`, e.g. «Nurofen». */
  titlesForLatinName(query: string): readonly string[] {
    this.latinNames ??= buildLatinNames(this.documents);
    return this.latinNames.get(normalizeSurfaceText(query)) ?? [];
  }

  /**
   * Product records (an installed instruction, an Allmed card) linked to the ЕСКЛП substance
   * `substanceDocumentId` («esklp.mnn.амоксициллин»), instructions first.
   */
  linkedProductIds(substanceDocumentId: string): readonly string[] {
    this.linkedProducts ??= buildLinkedProducts(this.documents);
    return this.linkedProducts.get(substanceDocumentId) ?? [];
  }

  /**
   * The mounted documents that stand for the record `targetDocumentId` («esklp.mnn.амоксициллин»):
   * the record itself when its module is installed, then the catalogue pointers that name it. An
   * empty list means the corpus holds nothing of that record.
   */
  documentIdsForTarget(targetDocumentId: string): readonly string[] {
    this.pointersByTarget ??= buildPointersByTarget(this.documents);
    return [
      ...(this.byId.has(targetDocumentId) ? [targetDocumentId] : []),
      ...(this.pointersByTarget.get(targetDocumentId) ?? []),
    ];
  }

  private addIdentity(value: string, documentId: string, index: IdentityIndex): void {
    const normalized = normalizeSurfaceText(value);
    const ids = index.get(normalized);
    if (ids === undefined) {
      index.set(normalized, documentId);
    } else if (typeof ids === 'string') {
      if (ids !== documentId) index.set(normalized, new Set([ids, documentId]));
    } else {
      ids.add(documentId);
    }
  }
}

/** A short title written as «ИМТ — …» / «СКФ: …» starts with an abbreviation of capitals only. */
const LEADING_ABBREVIATION = /^([\p{Lu}][\p{Lu}\p{N}-]{1,7})\s*(?:[—–:]|\s-\s)\s*\S/u;

function leadingAbbreviation(shortTitle: string): string | undefined {
  return LEADING_ABBREVIATION.exec(shortTitle.trim())?.[1];
}

const ICD_CODE = /^[A-Z]\d{2}(?:\.\d{1,2})?$/u;
const NAME_PREFIX_LENGTH = 5;
const WORD_SPLIT = /[^0-9a-zа-я]+/u;

function nameWords(value: string): readonly string[] {
  return normalizeSurfaceText(value)
    .split(WORD_SPLIT)
    .filter((word) => word.length >= 3);
}

/** The title, short title and declared and navigation aliases of a document. */
function normalizedDocumentNames(document: SearchDocumentDescriptor): string {
  return normalizeSurfaceText(
    [...documentNames(document), ...terminologyNames(document)].join(' '),
  );
}

function documentNames(document: SearchDocumentDescriptor): readonly string[] {
  const names = [document.title, document.shortTitle ?? ''];
  for (const key of ['declaredAliases', 'navigationAliases'] as const) {
    const aliases = document.metadata[key];
    if (Array.isArray(aliases))
      for (const alias of aliases) if (typeof alias === 'string') names.push(alias);
  }
  return names;
}

/** Names a terminology projection gives the document (`metadata.terminology.names`). */
function terminologyNames(document: SearchDocumentDescriptor): readonly string[] {
  const terminology = document.metadata['terminology'];
  if (typeof terminology !== 'object' || terminology === null) return [];
  const names: unknown = Reflect.get(terminology, 'names');
  return Array.isArray(names) ? names.filter((name) => typeof name === 'string') : [];
}

function buildNameWordPrefixes(
  documents: readonly SearchDocumentDescriptor[],
): ReadonlySet<string> {
  const prefixes = new Set<string>();
  for (const document of documents)
    for (const name of documentNames(document))
      for (const word of nameWords(name)) prefixes.add(word.slice(0, NAME_PREFIX_LENGTH));
  return prefixes;
}

function buildLatinNames(
  documents: readonly SearchDocumentDescriptor[],
): ReadonlyMap<string, readonly string[]> {
  const names = new Map<string, string[]>();
  for (const document of documents) {
    const latin = document.metadata['nameLat'];
    if (typeof latin !== 'string' || latin.trim().length === 0) continue;
    const key = normalizeSurfaceText(latin);
    const titles = names.get(key) ?? [];
    if (!titles.includes(document.title)) titles.push(document.title);
    names.set(key, titles);
  }
  return names;
}

function buildPointersByTarget(
  documents: readonly SearchDocumentDescriptor[],
): ReadonlyMap<string, readonly string[]> {
  const pointers = new Map<string, string[]>();
  for (const document of documents) {
    const target = document.metadata['targetDocumentId'];
    if (typeof target !== 'string' || target === document.id) continue;
    const ids = pointers.get(target) ?? [];
    ids.push(document.id);
    pointers.set(target, ids);
  }
  return pointers;
}

function buildIcdCards(
  documents: readonly SearchDocumentDescriptor[],
): ReadonlyMap<string, readonly string[]> {
  const cards = new Map<string, string[]>();
  for (const document of documents) {
    const code = document.metadata['mkbCode'];
    if (typeof code !== 'string') continue;
    const key = code.trim().toUpperCase();
    if (!document.title.toUpperCase().startsWith(`${key} `)) continue;
    const ids = cards.get(key) ?? [];
    ids.push(document.id);
    cards.set(key, ids);
  }
  return cards;
}

function buildLinkedProducts(
  documents: readonly SearchDocumentDescriptor[],
): ReadonlyMap<string, readonly string[]> {
  const products = new Map<string, SearchDocumentDescriptor[]>();
  for (const document of documents) {
    const substance = document.metadata['linkedMnnDocumentId'];
    if (typeof substance !== 'string') continue;
    const linked = products.get(substance) ?? [];
    linked.push(document);
    products.set(substance, linked);
  }
  return new Map(
    [...products].map(([substance, linked]) => [
      substance,
      linked
        .toSorted(
          (left, right) =>
            Number(right.sourceType === 'official_drug_instruction') -
              Number(left.sourceType === 'official_drug_instruction') ||
            left.id.localeCompare(right.id),
        )
        .map((document) => document.id),
    ]),
  );
}
