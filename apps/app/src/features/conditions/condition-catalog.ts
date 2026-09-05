import type { MedicalDocumentSummary } from '@localmed/contracts';
import { normalizeIcd10Lookalikes } from '@localmed/search-lexical';

import { displayDocumentTitle } from '@/features/library/document-display';

export type ConditionCatalogSection = 'diseases' | 'conditions' | 'syndromes' | 'symptoms';

export interface ConditionCatalogSource {
  readonly documentId: string;
  readonly title: string;
  readonly sourceType: string;
  readonly kind: 'classification' | 'recommendation' | 'reference';
  readonly pointer: boolean;
}

export interface ConditionCatalogDefinition {
  readonly id: string;
  readonly text: string;
  readonly pointerDocumentId: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentVersionId: string;
  readonly sourceSectionId: string;
  readonly sourceChunkId: string;
  readonly sourceAnchor: string;
  readonly readerAnchor: string;
  readonly sourceSectionTitle: string;
  readonly sourceTitle: string;
  readonly sourceKind: ConditionCatalogSource['kind'];
}

export interface ConditionCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly codes: readonly string[];
  readonly section: ConditionCatalogSection;
  readonly searchTerms: readonly string[];
  readonly definitions: readonly ConditionCatalogDefinition[];
  readonly sources: readonly ConditionCatalogSource[];
}

interface MutableConditionCatalogEntry {
  id: string;
  title: string;
  titlePriority: number;
  codes: Set<string>;
  section: ConditionCatalogSection;
  searchTerms: Set<string>;
  definitions: Map<string, ConditionCatalogDefinition>;
  sources: Map<string, ConditionCatalogSource>;
}

interface ConditionDocument {
  readonly summary: MedicalDocumentSummary;
  readonly codes: readonly string[];
  readonly entityType: string | null;
  readonly searchTerms: readonly string[];
  readonly pointerTarget: string | null;
}

export const CONDITION_CATALOG_SECTIONS: readonly {
  readonly id: ConditionCatalogSection;
  readonly label: string;
}[] = [
  { id: 'diseases', label: 'Заболевания' },
  { id: 'conditions', label: 'Состояния' },
  { id: 'syndromes', label: 'Синдромы' },
  { id: 'symptoms', label: 'Симптомы' },
];

function metadataString(metadata: Readonly<Record<string, unknown>> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataStrings(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function documentDefinition(document: MedicalDocumentSummary): ConditionCatalogDefinition | null {
  const value = document.metadata?.['canonicalDefinition'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const definition = value as Readonly<Record<string, unknown>>;
  const read = (key: string): string | null => metadataString(definition, key);
  const id = read('definitionId');
  const text = read('text');
  const sourceDocumentId = read('sourceDocumentId');
  const sourceDocumentVersionId = read('sourceDocumentVersionId');
  const sourceSectionId = read('sourceSectionId');
  const sourceChunkId = read('sourceChunkId');
  const sourceAnchor = read('sourceAnchor');
  const sourceSectionTitle = read('sourceSectionTitle');
  if (
    !id ||
    !text ||
    !sourceDocumentId ||
    !sourceDocumentVersionId ||
    !sourceSectionId ||
    !sourceChunkId ||
    !sourceAnchor ||
    !sourceSectionTitle
  ) {
    return null;
  }
  return {
    id,
    text,
    pointerDocumentId: document.id,
    sourceDocumentId,
    sourceDocumentVersionId,
    sourceSectionId,
    sourceChunkId,
    sourceAnchor,
    readerAnchor:
      metadataString(document.metadata, 'contentMode') === 'module-pointer'
        ? (metadataString(document.metadata, 'definitionPreviewAnchor') ?? sourceAnchor)
        : sourceAnchor,
    sourceSectionTitle,
    sourceTitle: displayDocumentTitle(document),
    sourceKind: sourceKind(document),
  };
}

function normalizeIcdCode(value: string): string | null {
  const normalized = normalizeIcd10Lookalikes(value.replaceAll(' ', '')).trim().toUpperCase();
  return /^[A-Z]\d{2}(?:\.\d+)?(?:-[A-Z]?\d{2}(?:\.\d+)?)?$/u.test(normalized) ? normalized : null;
}

const ICD10_CYRILLIC_LOOKALIKE_MAP: Readonly<Record<string, string>> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};

function cyrillicIcdCode(value: string): string {
  return [...value]
    .map((character) => ICD10_CYRILLIC_LOOKALIKE_MAP[character] ?? character)
    .join('');
}

function documentCodes(document: MedicalDocumentSummary): readonly string[] {
  const values = [
    ...metadataStrings(document.metadata, 'icd10Codes'),
    metadataString(document.metadata, 'mkbCode'),
  ];
  return [...new Set(values.flatMap((value) => (value ? [normalizeIcdCode(value)] : [])))].filter(
    (value): value is string => value !== null,
  );
}

function documentEntityType(document: MedicalDocumentSummary): string | null {
  return metadataString(document.metadata, 'entityType')?.toLowerCase() ?? null;
}

function effectiveSourceType(document: MedicalDocumentSummary): string {
  return metadataString(document.metadata, 'sourceType') ?? document.sourceType;
}

function isConditionDocument(document: MedicalDocumentSummary): boolean {
  const entityType = documentEntityType(document);
  return (
    effectiveSourceType(document) === 'rls_mkb_reference' ||
    document.sourceType.startsWith('clinical_recommendation') ||
    metadataString(document.metadata, 'catalogFamily') === 'clinical' ||
    document.sourceType.includes('krasotaimedicina') ||
    entityType === 'disease' ||
    entityType === 'condition' ||
    entityType === 'syndrome' ||
    entityType === 'symptom'
  );
}

function catalogSection(
  codes: readonly string[],
  entityType: string | null,
  title: string,
): ConditionCatalogSection {
  if (entityType === 'symptom') return 'symptoms';
  if (entityType === 'syndrome' || /(^|[\s(—-])синдром/iu.test(title)) return 'syndromes';
  if (entityType === 'condition') return 'conditions';
  if (entityType === 'disease') return 'diseases';
  if (codes.some((code) => code.startsWith('R'))) return 'symptoms';
  if (codes.some((code) => /^[STVWXYZ]/u.test(code))) {
    return 'conditions';
  }
  return 'diseases';
}

function displayTitle(document: MedicalDocumentSummary, codes: readonly string[]): string {
  let title = displayDocumentTitle(document).trim();
  const normalizedTitle = normalizeIcd10Lookalikes(title).toUpperCase();
  for (const code of codes.toSorted((left, right) => right.length - left.length)) {
    if (normalizedTitle.startsWith(`${code} `)) {
      title = title.slice(code.length).trim();
      break;
    }
  }
  return title.replace(/,?\s*МКБ-10$/iu, '').trim();
}

function sourceKind(document: MedicalDocumentSummary): ConditionCatalogSource['kind'] {
  if (effectiveSourceType(document) === 'rls_mkb_reference') return 'classification';
  if (
    document.sourceType.startsWith('clinical_recommendation') ||
    metadataString(document.metadata, 'catalogFamily') === 'clinical'
  ) {
    return 'recommendation';
  }
  return 'reference';
}

function titlePriority(document: MedicalDocumentSummary): number {
  if (effectiveSourceType(document) === 'rls_mkb_reference') return 3;
  if (metadataString(document.metadata, 'contentMode') !== 'module-pointer') return 2;
  return 1;
}

function conditionDocument(document: MedicalDocumentSummary): ConditionDocument {
  const metadata = document.metadata;
  const codes = documentCodes(document);
  return {
    summary: document,
    codes,
    entityType: documentEntityType(document),
    searchTerms: [
      ...metadataStrings(metadata, 'declaredAliases'),
      ...metadataStrings(metadata, 'keywords'),
      ...codes.map(cyrillicIcdCode),
    ],
    pointerTarget: metadataString(metadata, 'targetDocumentId'),
  };
}

function createEntry(document: ConditionDocument, id: string): MutableConditionCatalogEntry {
  const priority = titlePriority(document.summary);
  const title = displayTitle(document.summary, document.codes);
  return {
    id,
    title,
    titlePriority: priority,
    codes: new Set(document.codes),
    section: catalogSection(document.codes, document.entityType, title),
    searchTerms: new Set(document.searchTerms),
    definitions: new Map(),
    sources: new Map(),
  };
}

function addSource(entry: MutableConditionCatalogEntry, document: ConditionDocument): void {
  const summary = document.summary;
  const pointer = metadataString(summary.metadata, 'contentMode') === 'module-pointer';
  const sourceKey = document.pointerTarget ?? summary.id;
  const previous = entry.sources.get(sourceKey);
  if (!previous || (previous.pointer && !pointer)) {
    entry.sources.set(sourceKey, {
      documentId: summary.id,
      title: displayTitle(summary, document.codes),
      sourceType: effectiveSourceType(summary),
      kind: sourceKind(summary),
      pointer,
    });
  }
  if (!entry.id.startsWith('code:')) {
    for (const code of document.codes) entry.codes.add(code);
  }
  for (const term of document.searchTerms) entry.searchTerms.add(term);
  const definition = documentDefinition(summary);
  if (definition) entry.definitions.set(definition.id, definition);
  const priority = titlePriority(summary);
  if (priority > entry.titlePriority) {
    entry.title = displayTitle(summary, document.codes);
    entry.titlePriority = priority;
  }
}

function fallbackEntryId(document: ConditionDocument): string {
  if (document.codes.length === 1) return `code:${document.codes[0]}`;
  return `document:${document.pointerTarget ?? document.summary.id}`;
}

function titleKey(document: ConditionDocument): string {
  return displayTitle(document.summary, document.codes)
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
}

function sourceOrder(source: ConditionCatalogSource): number {
  if (source.kind === 'recommendation') return source.pointer ? 2 : 3;
  if (source.kind === 'reference') return 1;
  return 0;
}

export function buildConditionCatalog(
  documents: readonly MedicalDocumentSummary[],
): readonly ConditionCatalogEntry[] {
  const conditionDocuments = documents.filter(isConditionDocument).map(conditionDocument);
  const entries = new Map<string, MutableConditionCatalogEntry>();
  const entriesByTitle = new Map<string, MutableConditionCatalogEntry>();

  for (const document of conditionDocuments.filter(
    ({ summary }) => effectiveSourceType(summary) === 'rls_mkb_reference',
  )) {
    const code = document.codes[0];
    const id = code ? `code:${code}` : fallbackEntryId(document);
    const entry = entries.get(id) ?? createEntry(document, id);
    addSource(entry, document);
    entries.set(id, entry);
  }

  for (const document of conditionDocuments.filter(
    ({ summary }) => effectiveSourceType(summary) !== 'rls_mkb_reference',
  )) {
    const matchedEntries = document.codes.flatMap((code) => {
      const entry = entries.get(`code:${code}`);
      return entry ? [entry] : [];
    });
    if (matchedEntries.length > 0) {
      for (const entry of matchedEntries) addSource(entry, document);
      continue;
    }
    const matchingTitle = entriesByTitle.get(titleKey(document));
    const id = matchingTitle?.id ?? fallbackEntryId(document);
    const entry = matchingTitle ?? entries.get(id) ?? createEntry(document, id);
    addSource(entry, document);
    entries.set(id, entry);
    entriesByTitle.set(titleKey(document), entry);
  }

  return [...entries.values()]
    .map(
      (entry): ConditionCatalogEntry => ({
        id: entry.id,
        title: entry.title,
        codes: [...entry.codes].toSorted((left, right) => left.localeCompare(right, 'ru')),
        section: entry.section,
        searchTerms: [...entry.searchTerms],
        definitions: [...entry.definitions.values()].toSorted(
          (left, right) =>
            Number(right.sourceKind === 'recommendation') -
              Number(left.sourceKind === 'recommendation') ||
            left.sourceTitle.localeCompare(right.sourceTitle, 'ru'),
        ),
        sources: [...entry.sources.values()].toSorted(
          (left, right) =>
            sourceOrder(right) - sourceOrder(left) || left.title.localeCompare(right.title, 'ru'),
        ),
      }),
    )
    .toSorted((left, right) => left.title.localeCompare(right.title, 'ru'));
}

export function conditionSectionLabel(section: ConditionCatalogSection): string {
  return CONDITION_CATALOG_SECTIONS.find((item) => item.id === section)?.label ?? 'Заболевания';
}
