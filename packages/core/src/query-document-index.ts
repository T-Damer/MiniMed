import { normalizeSurfaceText, searchSubjectText } from '@localmed/search-lexical';
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
  private latinNames: ReadonlyMap<string, readonly string[]> | undefined;

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

  /** Titles of the documents whose declared Latin name (`nameLat`) is `query`, e.g. «Nurofen». */
  titlesForLatinName(query: string): readonly string[] {
    this.latinNames ??= buildLatinNames(this.documents);
    return this.latinNames.get(normalizeSurfaceText(query)) ?? [];
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

const NAME_PREFIX_LENGTH = 5;
const WORD_SPLIT = /[^0-9a-zа-я]+/u;

function nameWords(value: string): readonly string[] {
  return normalizeSurfaceText(value)
    .split(WORD_SPLIT)
    .filter((word) => word.length >= 3);
}

function buildNameWordPrefixes(
  documents: readonly SearchDocumentDescriptor[],
): ReadonlySet<string> {
  const prefixes = new Set<string>();
  for (const document of documents) {
    const names = [document.title, document.shortTitle ?? ''];
    for (const key of ['declaredAliases', 'navigationAliases'] as const) {
      const aliases = document.metadata[key];
      if (Array.isArray(aliases))
        for (const alias of aliases) if (typeof alias === 'string') names.push(alias);
    }
    for (const name of names)
      for (const word of nameWords(name)) prefixes.add(word.slice(0, NAME_PREFIX_LENGTH));
  }
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
