import {
  buildNameVocabulary,
  type NameVocabulary,
  normalizeIcd10Lookalikes,
  normalizeSurfaceText,
  searchSubjectText,
} from '@localmed/search-lexical';
import type { SearchDocumentDescriptor } from '@localmed/storage';

/** Immutable per-core projection; never shared across installed corpus generations. */
export class QueryDocumentIndex {
  readonly byId: ReadonlyMap<string, SearchDocumentDescriptor>;
  readonly availableIds: ReadonlySet<string>;
  private readonly aliases = new Map<string, Set<string>>();
  private readonly titles = new Map<string, Set<string>>();
  private readonly navigationAliases = new Map<string, Set<string>>();
  private readonly shortTitles = new Map<string, Set<string>>();
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
    this.availableIds = new Set(this.byId.keys());
    for (const document of documents) {
      this.addIdentity(document.title, document.id, this.titles);
      if (document.shortTitle) {
        this.addIdentity(document.shortTitle, document.id, this.shortTitles);
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
    return this.aliases.get(searchSubjectText(query)) ?? new Set();
  }

  exactTitleIds(query: string): ReadonlySet<string> {
    return this.titles.get(searchSubjectText(query)) ?? new Set();
  }

  exactNavigationAliasIds(query: string): ReadonlySet<string> {
    return this.navigationAliases.get(searchSubjectText(query)) ?? new Set();
  }

  exactShortTitleIds(query: string): ReadonlySet<string> {
    return this.shortTitles.get(searchSubjectText(query)) ?? new Set();
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
  nameVocabulary(extraNames: readonly string[] = []): NameVocabulary {
    this.names ??= buildNameVocabulary([
      ...this.documents.map((document) =>
        normalizeSurfaceText([...documentNames(document), ...terminologyNames(document)].join(' ')),
      ),
      ...extraNames.map(normalizeSurfaceText),
    ]);
    return this.names;
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

  private addIdentity(value: string, documentId: string, index: Map<string, Set<string>>): void {
    const normalized = normalizeSurfaceText(value);
    let ids = index.get(normalized);
    if (!ids) {
      ids = new Set();
      index.set(normalized, ids);
    }
    ids.add(documentId);
  }
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
