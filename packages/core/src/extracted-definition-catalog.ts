import type { DefinitionCatalog, DefinitionSource, DraftDefinition } from './definition-catalog';

const MAX_BYTES = 16 * 1024 * 1024;
const KINDS = new Set(['term', 'symptom', 'syndrome', 'criterion_set', 'scale', 'classification', 'law', 'tool', 'history_note']);
const COVERAGE = new Set(['definition', 'explicit-definition', 'definition-section', 'contextual-definition', 'criterion-list', 'classification', 'section-overview', 'section-excerpt', 'tool-description', 'source-description', 'cross-reference', 'mention-only']);

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid excerpt object.');
  return value as Readonly<Record<string, unknown>>;
}
function text(value: unknown, maximum = 2048, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error('Invalid excerpt text.');
  return value;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid excerpt collection.');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid excerpt reference.');
  return value;
}
function safePath(source: DefinitionSource, path: string): void {
  if (source.sourceType === 'owner-pdf') {
    if (path !== '') throw new Error('Owner sources must not open external paths.');
    return;
  }
  const base = new URL(source.baseUrl);
  const resolved = new URL(path, base);
  if (base.protocol !== 'https:' || base.username || base.password || base.hash || base.search || !base.pathname.endsWith('/') || resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname) || path.startsWith('/') || path.includes('\\') || /(^|\/)\.\.(\/|$)/u.test(path)) throw new Error('Unsafe excerpt source path.');
}

/** Source excerpts retain a separate text/review state; publication is not enabled here. */
export function parseExtractedDefinitionCatalog(input: unknown): DefinitionCatalog {
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).length > MAX_BYTES) throw new Error('Excerpt module exceeds its size budget.');
  const root = object(input);
  if (root['version'] !== 3 || root['textKind'] !== 'source-excerpt' || root['reviewStatus'] !== 'requires-review' || root['publicationState'] !== 'local-dev') throw new Error('Unsupported excerpt module or trust state.');
  text(root['id'], 256);
  const sourceIds = new Map<number, DefinitionSource>();
  const sourcePaths = new Map<number, string>();
  for (const entry of array(root['sources'], 1000)) {
    const row = object(entry);
    const id = integer(row['id']);
    if (sourceIds.has(id) || row['releaseEligible'] !== false) throw new Error('Duplicate or release-eligible excerpt source.');
    const authority = row['authority'];
    if (authority !== 'professional-reference' && authority !== 'institutional-reference' && authority !== 'third-party') throw new Error('Invalid excerpt authority.');
    const sourceType = text(row['sourceType'], 80);
    const baseUrl = text(row['baseUrl'], 2048, sourceType === 'owner-pdf');
    const accessed = text(row['accessed'], 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(accessed)) throw new Error('Invalid excerpt source date.');
    const source: DefinitionSource = { id, title: text(row['title']), baseUrl, authority, accessed, sourceType, rightsStatus: text(row['rightsStatus'], 256) };
    if (row['sourceSha256'] !== undefined) {
      const hash = text(row['sourceSha256'], 64);
      if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Invalid excerpt source checksum.');
      Object.assign(source, { sourceSha256: hash });
    }
    if (sourceType === 'owner-pdf') {
      const fileName = text(row['fileName'], 255);
      if (baseUrl || /[/\\]/u.test(fileName) || !source.sourceSha256) throw new Error('Invalid owner PDF provenance.');
      Object.assign(source, { fileName });
    }
    const path = row['path'] === undefined ? '' : text(row['path'], 2048, true);
    safePath(source, path);
    sourceIds.set(id, source);
    sourcePaths.set(id, path);
  }
  const blocks = new Map<number, { source: number; text: string; path: string; locator: string }>();
  for (const entry of array(root['blocks'], 100000)) {
    const row = object(entry);
    const id = integer(row['id']);
    const source = integer(row['source']);
    const record = sourceIds.get(source);
    if (blocks.has(id) || !record) throw new Error('Duplicate block or missing source.');
    const path = row['path'] === undefined ? (sourcePaths.get(source) ?? '') : text(row['path'], 2048, true);
    safePath(record, path);
    const hash = text(row['textSha256'], 64);
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Missing excerpt block checksum.');
    blocks.set(id, { source, text: text(row['text'], 262144), path, locator: text(row['locator'], 4096) });
  }
  const origins = array(root['etymologyStatements'] ?? [], 10000).map((entry) => {
    const row = object(entry);
    if (!blocks.has(integer(row['block'])) || row['reviewStatus'] !== 'requires-review') throw new Error('Invalid source etymology reference.');
    return text(row['sourceStatement'], 2048);
  });
  const ids = new Set<string>();
  const terms = array(root['terms'], 50000).map((entry): DraftDefinition => {
    const row = object(entry);
    const id = text(row['id'], 256);
    const kind = text(row['kind'], 40);
    const coverage = text(row['coverage'], 80);
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(id) || ids.has(id) || !KINDS.has(kind) || !COVERAGE.has(coverage)) throw new Error('Invalid excerpt term identity/kind/coverage.');
    ids.add(id);
    const selected = array(row['blockIds'], 500).map((value) => {
      const block = blocks.get(integer(value));
      if (!block) throw new Error('Dangling excerpt block reference.');
      return block;
    });
    if (!selected.length) throw new Error('Term has no source excerpt.');
    const definition = selected.map((block) => block.text).join('\n\n');
    if (definition.length > 262144) throw new Error('Definition exceeds its display budget; split explicitly.');
    for (const key of ['detailBlocks', 'itemBlocks']) {
      for (const value of array(row[key] ?? [], 1000)) {
        if (!blocks.has(integer(value))) throw new Error('Dangling detail/list block reference.');
      }
    }
    const etymology = array(row['etymologyRefs'] ?? [], 32).map((value) => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || !origins[value]) throw new Error('Dangling etymology reference.');
      return origins[value];
    });
    const note = text(row['note'] ?? '', 4096, true);
    // Lists stay in their original source text, retaining nested numbering and qualification clauses.
    // A mention-only scale never acquires runnable scoring or copied questionnaire items.
    return { id, title: text(row['title'], 2048), kind: kind as DraftDefinition['kind'], aliases: array(row['aliases'] ?? [], 128).map((value) => text(value, 2048)), definition, items: [], note, coverage, etymology, references: selected.map((block) => ({ source: block.source, path: block.path, locator: block.locator })) };
  });
  return { version: 3, textKind: 'source-excerpt', reviewStatus: 'requires-review', publicationState: 'local-dev', sources: [...sourceIds.values()], terms };
}
