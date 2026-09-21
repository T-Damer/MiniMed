import {
  levenshteinDistance,
  lightStemRussian,
  normalizeSurfaceText,
  tokenize,
} from '@localmed/search-lexical';

/** A read-only draft projection, never an approved knowledge graph or diagnostic model. */
export interface DefinitionSource {
  readonly id: number;
  readonly title: string;
  readonly baseUrl: string;
  readonly authority: 'professional-reference' | 'institutional-reference' | 'third-party';
  readonly accessed: string;
}

export interface DefinitionReference {
  readonly source: number;
  readonly path: string;
  readonly locator: string;
}

export interface DraftDefinition {
  /** Stable staging identity, not a same-as assertion or an approved concept ID. */
  readonly id: string;
  readonly title: string;
  readonly kind: 'term' | 'symptom' | 'syndrome' | 'criterion_set';
  readonly aliases: readonly string[];
  readonly definition: string;
  readonly items: readonly string[];
  readonly note: string;
  readonly references: readonly DefinitionReference[];
}

export interface DefinitionCatalog {
  readonly version: 1;
  readonly reviewStatus: 'requires-review';
  readonly publicationState: 'local-dev';
  readonly textKind: 'editorial-paraphrase';
  readonly sources: readonly DefinitionSource[];
  readonly terms: readonly DraftDefinition[];
}

export interface DefinitionMatch {
  readonly term: DraftDefinition;
  readonly matchKind: 'name' | 'definition';
  readonly reviewStatus: 'requires-review';
  readonly citations: readonly {
    readonly source: DefinitionSource;
    readonly locator: string;
    readonly url: string;
  }[];
}

export interface DefinitionLookup {
  search(query: string, limit?: number): readonly DefinitionMatch[];
  readonly termCount: number;
  readonly sourceCount: number;
}

// Keep this bundled starter small. Larger collections must be split into optional packs.
export const DEFINITION_CATALOG_MAX_BYTES = 256 * 1024;
const MAX_QUERY_LENGTH = 512;
const MAX_TOKENS = 24;
const NEGATIONS = new Set(['не', 'без', 'нет']);
const QUERY_FILLER = new Set([
  'называется', 'называют', 'вспомнить', 'помню', 'какой', 'какое', 'такое',
]);

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid definition catalog object.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, maximum = 256, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error('Invalid definition catalog text.');
  }
  return value.trim();
}

function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error('Invalid definition catalog collection.');
  }
  return value;
}

function strings(value: unknown, maximum: number, length: number): readonly string[] {
  return array(value ?? [], maximum).map((entry) => text(entry, length));
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid definition source ID.');
  }
  return value;
}

export function definitionSourceUrl(source: DefinitionSource, path: string): string {
  const base = new URL(source.baseUrl);
  const resolved = new URL(path, base);
  if (
    base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
    !base.pathname.endsWith('/') ||
    resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname) ||
    path.startsWith('/') || /(^|\/)\.\.(\/|$)/u.test(path) || path.includes('\\') ||
    resolved.username || resolved.password
  ) {
    throw new Error('Invalid definition source URL.');
  }
  return resolved.href;
}

/** Validate at the asset boundary; authoring cannot silently promote a draft to reviewed. */
export function parseDefinitionCatalog(input: unknown): DefinitionCatalog {
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).length > DEFINITION_CATALOG_MAX_BYTES) {
    throw new Error('Definition catalog exceeds its mobile size budget.');
  }
  const root = object(input);
  if (
    root['version'] !== 1 || root['reviewStatus'] !== 'requires-review' ||
    root['publicationState'] !== 'local-dev' || root['textKind'] !== 'editorial-paraphrase'
  ) {
    throw new Error('Unsupported definition catalog version or review state.');
  }
  const sourceIds = new Set<number>();
  const sources = array(root['sources'], 1000).map((entry): DefinitionSource => {
    const row = object(entry);
    const id = positiveInteger(row['id']);
    if (sourceIds.has(id)) throw new Error('Duplicate definition source ID.');
    sourceIds.add(id);
    const authority = row['authority'];
    if (
      authority !== 'professional-reference' && authority !== 'institutional-reference' &&
      authority !== 'third-party'
    ) {
      throw new Error('Invalid definition source authority.');
    }
    const source: DefinitionSource = {
      id,
      title: text(row['title']),
      baseUrl: text(row['baseUrl'], 2048),
      authority,
      accessed: text(row['accessed'], 10),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(source.accessed)) throw new Error('Invalid source date.');
    definitionSourceUrl(source, '');
    return source;
  });
  const bySourceId = new Map(sources.map((source) => [source.id, source]));
  const termIds = new Set<string>();
  const terms = array(root['terms'], 5000).map((entry): DraftDefinition => {
    const row = object(entry);
    const id = text(row['id'], 128);
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(id) || termIds.has(id)) {
      throw new Error('Invalid or duplicate draft definition ID.');
    }
    termIds.add(id);
    const kind = row['kind'];
    if (kind !== 'term' && kind !== 'symptom' && kind !== 'syndrome' && kind !== 'criterion_set') {
      throw new Error('Invalid draft definition kind.');
    }
    const references = array(row['references'], 8).map((entry): DefinitionReference => {
      const ref = object(entry);
      const source = positiveInteger(ref['source']);
      const record = bySourceId.get(source);
      if (!record) throw new Error('Dangling definition source reference.');
      const path = text(ref['path'], 1024, true);
      definitionSourceUrl(record, path);
      return { source, path, locator: text(ref['locator'], 512) };
    });
    if (references.length === 0) throw new Error('Draft definition needs an exact source locator.');
    const items = strings(row['items'], 20, 512);
    if (kind === 'criterion_set' && items.length === 0) throw new Error('Empty criterion set.');
    return {
      id,
      title: text(row['title']),
      kind,
      aliases: strings(row['aliases'], 24, 256),
      definition: text(row['definition'], 2048),
      items,
      note: text(row['note'] ?? '', 1024, true),
      references,
    };
  });
  return {
    version: 1,
    reviewStatus: 'requires-review',
    publicationState: 'local-dev',
    textKind: 'editorial-paraphrase',
    sources,
    terms,
  };
}

function surface(value: string): string {
  return normalizeSurfaceText(value).replace(/[-.,:]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function words(value: string): readonly string[] {
  const normalized = surface(value);
  // The shared lexical tokenizer drops negation for document lookup. Keep it in definitions.
  const negations = (normalized.match(/[а-яa-z0-9]+/gu) ?? []).filter((word) => NEGATIONS.has(word));
  return [...new Set([...tokenize(normalized), ...negations])];
}

/** Extra inflections are local to the glossary; clinical/drug lookup normalization is unchanged. */
function wordForms(word: string): readonly string[] {
  const inflection = /^[а-я]+$/u.test(word)
    ? word.replace(/(?:иями|ыми|ими|ого|ему|ому|иях|ями|ами|ией|иям|ием|ию|ия|ии|ие|ий|ью|ья|ье|ьи|ях|ам|ям|ах|ом|ем|ую|юю|ей|ой|ая|яя|ое|ые|ее|ы|и|а|я|у|ю|е|о)$/u, '')
    : word;
  return [...new Set([word, lightStemRussian(word), ...(inflection.length >= 3 ? [inflection] : [])])];
}

function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] ?? '') < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Read-only, bounded inverted index over definitions and criterion items, not source titles. */
export function createDefinitionLookup(input: unknown): DefinitionLookup {
  const catalog = parseDefinitionCatalog(input);
  const sources = new Map(catalog.sources.map((source) => [source.id, source]));
  const postings = new Map<string, Set<number>>();
  const names = catalog.terms.map((term) => [term.title, ...term.aliases].map(surface));
  const bodies = catalog.terms.map((term) => surface([term.definition, ...term.items].join(' ')));
  const nameWords = names.map((entries) => new Set(entries.flatMap(words).flatMap(wordForms)));
  for (const [index, term] of catalog.terms.entries()) {
    for (const word of words([term.title, ...term.aliases, term.definition, ...term.items].join(' '))) {
      for (const form of wordForms(word)) {
        let ids = postings.get(form);
        if (!ids) {
          ids = new Set();
          postings.set(form, ids);
        }
        ids.add(index);
      }
    }
  }
  const vocabulary = [...postings.keys()].sort();
  return {
    termCount: catalog.terms.length,
    sourceCount: catalog.sources.length,
    search(query, limit = 5) {
      if (!Number.isFinite(limit) || limit <= 0 || query.length > MAX_QUERY_LENGTH) return [];
      const normalized = surface(query).replace(/^(?:что такое|как называется|определение)\s+/u, '');
      const tokens = words(normalized).filter((word) => !QUERY_FILLER.has(word));
      if (
        !normalized || tokens.length === 0 || tokens.length > MAX_TOKENS ||
        tokens.every((word) => NEGATIONS.has(word))
      ) return [];
      const documentFrequency = new Map(tokens.map((word) => [
        word,
        new Set(wordForms(word).flatMap((form) => [...(postings.get(form) ?? [])])).size,
      ]));
      const candidates = new Map<number, Map<string, number>>();
      const add = (key: string, token: string, quality: number) => {
        for (const id of postings.get(key) ?? []) {
          let hits = candidates.get(id);
          if (!hits) {
            hits = new Map();
            candidates.set(id, hits);
          }
          hits.set(token, Math.max(hits.get(token) ?? 0, quality));
        }
      };
      for (const token of tokens) {
        const forms = wordForms(token);
        for (const form of forms) add(form, token, 1);
        if (forms.some((form) => postings.has(form)) || token.length < 5) continue;
        // Prefix completion and single-edit repair are bounded, and only a fallback.
        const prefix = token.slice(0, 2);
        const start = lowerBound(vocabulary, prefix);
        let scanned = 0;
        for (let index = start; index < vocabulary.length && scanned < 256; index += 1) {
          const candidate = vocabulary[index];
          if (!candidate?.startsWith(prefix)) break;
          scanned += 1;
          if (candidate.startsWith(token)) add(candidate, token, 0.8);
          else if (levenshteinDistance(token, candidate, 1) <= 1) add(candidate, token, 0.7);
        }
      }
      const ranked: { index: number; tier: number; score: number; named: boolean }[] = [];
      for (const [index, hits] of candidates) {
        const termNames = names[index] ?? [];
        const titleExact = termNames[0] === normalized;
        const aliasExact = termNames.includes(normalized);
        const coverage = [...hits.values()].reduce((sum, weight) => sum + weight, 0) / tokens.length;
        const named = titleExact || aliasExact || tokens.every((word) =>
          wordForms(word).some((form) => nameWords[index]?.has(form)));
        const meaningfulHits = [...hits.keys()].filter((word) => !NEGATIONS.has(word));
        const rarePartial = tokens.length <= 4 && meaningfulHits.length === 1 &&
          meaningfulHits.every((word) => documentFrequency.get(word) === 1) && coverage >= 0.25;
        if (
          !named && !rarePartial &&
          (coverage < 0.35 || (tokens.length >= 3 && meaningfulHits.length < 2))
        ) continue;
        const phrase = bodies[index]?.includes(normalized) ? 1 : 0;
        const informativeness = [...hits].reduce((sum, [word, weight]) =>
          sum + weight * Math.log(1 + catalog.terms.length / (documentFrequency.get(word) || 1)), 0);
        ranked.push({
          index,
          tier: titleExact ? 3 : aliasExact ? 2 : named ? 1 : 0,
          score: coverage * 10 + phrase * 2 + informativeness / tokens.length,
          named,
        });
      }
      ranked.sort((a, b) => b.tier - a.tier || b.score - a.score ||
        (catalog.terms[a.index]?.id ?? '').localeCompare(catalog.terms[b.index]?.id ?? ''));
      return ranked.slice(0, Math.min(Math.floor(limit), 20)).flatMap(({ index, named }) => {
        const term = catalog.terms[index];
        if (!term) return [];
        return [{
          term,
          matchKind: named ? 'name' as const : 'definition' as const,
          reviewStatus: 'requires-review' as const,
          citations: term.references.map((ref) => {
            const source = sources.get(ref.source);
            if (!source) throw new Error('Dangling definition source reference.');
            return { source, locator: ref.locator, url: definitionSourceUrl(source, ref.path) };
          }),
        }];
      });
    },
  };
}
