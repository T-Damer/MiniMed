import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';

/**
 * WHO ICD-11 (MMS, Russian linearization) is an optional reference module. ICD-10 stays the default
 * coding system everywhere: ICD-11 documents carry their own source type and none of the ICD-10
 * metadata keys (`mkbCode`, `icd10Codes`, `entityType`), so ICD-10 lookups, the condition catalog
 * and the clinical scopes never pick them up. Only the «Все» search scope lists them, marked.
 */
export const ICD11_SOURCE_TYPE = 'who_icd11_reference';
export const ICD11_DOCUMENT_PREFIX = 'who.icd11.mms.';
export const ICD11_COLLECTION = 'icd11';
export const ICD11_SECTION_LABEL = 'МКБ-11 (ВОЗ), справочно';
export const ICD11_MODULE_ID = 'minimed.reference.icd11.ru';
export const ICD11_RESULT_LABEL = 'МКБ-11 (ВОЗ), справочно';
export const ICD11_PRACTICE_NOTE =
  'В Российской Федерации действует МКБ-10. Код МКБ-11 не заменяет код МКБ-10 в документах.';

export function isIcd11Document(document: Pick<MedicalDocumentSummary, 'sourceType'>): boolean {
  return document.sourceType === ICD11_SOURCE_TYPE;
}

export function isIcd11DocumentId(documentId: string): boolean {
  return documentId.startsWith(ICD11_DOCUMENT_PREFIX);
}

export type Icd11CrosswalkRelation = 'closest' | 'mapped-into-this' | 'mapped-into-this-multiple';

export interface Icd11CrosswalkLink {
  readonly relation: Icd11CrosswalkRelation;
  readonly icd10Code: string;
  readonly icd10TitleEn: string;
  /** Present only when an ICD-10 card with exactly this code is in the ICD-10 module. */
  readonly icd10DocumentId: string | null;
  /** ICD-11 code with extension codes («1A00&XN8P1») when WHO maps to a postcoordinated cluster. */
  readonly cluster: string | null;
}

export interface Icd11DocumentLink {
  readonly documentId: string;
  readonly label: string;
}

export const ICD11_RELATION_LABELS: Readonly<Record<Icd11CrosswalkRelation, string>> = {
  closest: 'Ближайший код МКБ-10 (таблица ВОЗ «МКБ-11 → МКБ-10»)',
  'mapped-into-this': 'Коды МКБ-10, отнесённые к этой рубрике (таблица ВОЗ «МКБ-10 → МКБ-11»)',
  'mapped-into-this-multiple':
    'Ещё коды МКБ-10, которые таблица ВОЗ относит в том числе к этой рубрике',
};

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items.filter(
    (item): item is Readonly<Record<string, unknown>> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function metadataValue(document: Pick<MedicalDocument, 'metadata'>, key: string): unknown {
  return (document.metadata as Readonly<Record<string, unknown>>)[key];
}

/** Crosswalk rows as WHO published them; a link target is kept only for an ICD-10 card id. */
export function icd11CrosswalkLinks(
  document: Pick<MedicalDocument, 'metadata'>,
): readonly Icd11CrosswalkLink[] {
  const links: Icd11CrosswalkLink[] = [];
  for (const item of records(metadataValue(document, 'crosswalkIcd10'))) {
    const relation = item['relation'];
    const code = text(item['icd10Code']);
    if (
      (relation !== 'closest' &&
        relation !== 'mapped-into-this' &&
        relation !== 'mapped-into-this-multiple') ||
      !code
    )
      continue;
    const target = text(item['icd10DocumentId']);
    links.push({
      relation,
      icd10Code: code,
      icd10TitleEn: text(item['icd10TitleEn']) ?? '',
      icd10DocumentId: target?.startsWith('rls.mkb.node.') ? target : null,
      cluster: text(item['icd11Cluster']),
    });
  }
  return links;
}

function documentLinks(
  document: Pick<MedicalDocument, 'metadata'>,
  key: string,
  labelKey: 'label' | 'title',
): readonly Icd11DocumentLink[] {
  const links: Icd11DocumentLink[] = [];
  for (const item of records(metadataValue(document, key))) {
    const documentId = text(item['documentId']);
    const label = text(item[labelKey]);
    if (documentId && isIcd11DocumentId(documentId) && label) links.push({ documentId, label });
  }
  return links;
}

/** Ancestors, nearest first (WHO hierarchy as in the tabulation's Parent column). */
export function icd11Ancestors(
  document: Pick<MedicalDocument, 'metadata'>,
): readonly Icd11DocumentLink[] {
  return documentLinks(document, 'classificationPath', 'title');
}

export function icd11Children(
  document: Pick<MedicalDocument, 'metadata'>,
): readonly Icd11DocumentLink[] {
  return documentLinks(document, 'childDocuments', 'label');
}
