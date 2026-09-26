import type { DefinitionCatalog, DefinitionSource, DraftDefinition } from './definition-catalog';

/** A lexical source projection, not a second canonical medical identity system. */
export const SOURCE_DEFINITION_MAX_BYTES = 16 * 1024 * 1024;
const SUBJECTS = new Set([
  'medicine',
  'anatomy',
  'physiology',
  'pharmacology',
  'psychology',
  'psychiatry',
]);

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid source glossary object.');
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Invalid source glossary text.');
  return value;
}

function array(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > max)
    throw new Error('Invalid source glossary collection.');
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('Invalid source glossary ID.');
  return value;
}

function digest(value: unknown): string {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error('Invalid source snapshot digest.');
  return result;
}

/** This adapter admits only the already licensed Russian Wiktionary source shape. */
export function parseSourceDefinitionCatalog(input: unknown): DefinitionCatalog {
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).length > SOURCE_DEFINITION_MAX_BYTES) {
    throw new Error('Source glossary exceeds its optional-module budget.');
  }
  const root = object(input);
  if (
    root['version'] !== 2 ||
    root['textKind'] !== 'source-gloss' ||
    root['language'] !== 'ru' ||
    root['reviewStatus'] !== 'requires-review' ||
    root['publicationState'] !== 'local-dev'
  ) {
    throw new Error('Unsupported source glossary or review state.');
  }
  const sourceIds = new Set<number>();
  const sources = array(root['sources'], 1000).map((value): DefinitionSource => {
    const row = object(value);
    const id = integer(row['id']);
    if (sourceIds.has(id)) throw new Error('Duplicate source glossary ID.');
    sourceIds.add(id);
    if (
      row['baseUrl'] !== 'https://ru.wiktionary.org/wiki/' ||
      row['authority'] !== 'third-party' ||
      row['license'] !== 'CC-BY-SA-4.0' ||
      row['licenseUrl'] !== 'https://creativecommons.org/licenses/by-sa/4.0/' ||
      row['sourceUrl'] !== 'https://kaikki.org/dictionary/downloads/ru/ru-extract.jsonl.gz'
    ) {
      throw new Error('Source/rights outside the admitted Russian dictionary contract.');
    }
    const accessed = text(row['accessed'], 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(accessed)) throw new Error('Invalid glossary source date.');
    return {
      id,
      title: text(row['title']),
      baseUrl: row['baseUrl'],
      authority: row['authority'],
      accessed,
      license: row['license'],
      licenseUrl: row['licenseUrl'],
      attribution: text(row['attribution']),
      sourceSha256: digest(row['sourceSha256']),
      preparedSha256: digest(row['preparedSha256']),
      sourceUrl: row['sourceUrl'],
      changes: text(row['changes']),
    };
  });
  const ids = new Set<string>();
  const terms = array(root['terms'], 20000).map((value): DraftDefinition => {
    const row = object(value);
    const id = text(row['id'], 64);
    if (!/^ruwikt\.[a-f0-9]{24}$/u.test(id) || ids.has(id))
      throw new Error('Invalid/duplicate source sense ID.');
    ids.add(id);
    const title = text(row['title'], 2000);
    const page = encodeURIComponent(title).replace(
      /[!'()*]/gu,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    if (
      row['kind'] !== 'term' ||
      !Array.isArray(row['aliases']) ||
      row['aliases'].length ||
      !Array.isArray(row['items']) ||
      row['items'].length ||
      row['note'] !== '' ||
      (row['definitionKind'] !== 'gloss' && row['definitionKind'] !== 'cross-reference')
    ) {
      throw new Error('Source gloss must not acquire invented aliases, criteria or commentary.');
    }
    for (const subject of array(row['sourceSubjects'], 6)) {
      if (typeof subject !== 'string' || !SUBJECTS.has(subject))
        throw new Error('Unsupported dictionary subject.');
    }
    const references = array(row['references'], 8).map((value) => {
      const ref = object(value);
      const source = integer(ref['source']);
      if (!sourceIds.has(source) || ref['path'] !== page)
        throw new Error('Invalid exact dictionary source reference.');
      const locator = text(ref['locator'], 512);
      if (!/^ru-extract\.jsonl:[1-9]\d*; sense=\d+; pos=\S+$/u.test(locator))
        throw new Error('Missing source line/sense locator.');
      const recordSha256 = text(ref['recordSha256'], 71);
      if (!/^sha256:[a-f0-9]{64}$/u.test(recordSha256))
        throw new Error('Missing original record checksum.');
      return { source, path: page, locator, recordSha256 };
    });
    return {
      id,
      title,
      kind: 'term',
      aliases: [],
      definition: text(row['definition'], 65536),
      items: [],
      note:
        row['definitionKind'] === 'cross-reference'
          ? 'Словарная отсылка; может не содержать развёрнутого определения.'
          : '',
      references,
    };
  });
  return {
    version: 2,
    textKind: 'source-gloss',
    reviewStatus: 'requires-review',
    publicationState: 'local-dev',
    sources,
    terms,
  };
}
