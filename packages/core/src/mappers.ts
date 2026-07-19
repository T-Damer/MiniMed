import type {
  MedicalChunk,
  MedicalDocument,
  MedicalDocumentSummary,
  MedicalSection,
} from '@localmed/contracts';
import type { ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';

export function toDocumentSummary(record: DocumentRecord): MedicalDocumentSummary {
  return {
    id: record.id,
    title: record.title,
    shortTitle: record.shortTitle,
    sourceType: record.sourceType,
    status: record.status,
    specialties: record.specialties,
    versionId: record.version.id,
    versionLabel: record.version.versionLabel,
    effectiveFrom: record.version.effectiveFrom,
  };
}

export function toMedicalChunk(record: ChunkRecord): MedicalChunk {
  return {
    id: record.id,
    sectionId: record.sectionId,
    documentVersionId: record.documentVersionId,
    orderIndex: record.orderIndex,
    originalText: record.originalText,
    pageStart: record.pageStart,
    pageEnd: record.pageEnd,
    anchor: record.anchor,
  };
}

export function toMedicalSection(
  record: SectionRecord,
  chunks: readonly ChunkRecord[],
): MedicalSection {
  return {
    id: record.id,
    documentVersionId: record.documentVersionId,
    parentSectionId: record.parentSectionId,
    title: record.title,
    sectionType: record.sectionType,
    depth: record.depth,
    orderIndex: record.orderIndex,
    pageStart: record.pageStart,
    pageEnd: record.pageEnd,
    anchor: record.anchor,
    sectionPath: record.sectionPath,
    chunks: chunks.map(toMedicalChunk),
  };
}

export function toMedicalDocument(
  record: DocumentRecord,
  sections: readonly MedicalSection[],
): MedicalDocument {
  return {
    ...toDocumentSummary(record),
    metadata: record.metadata,
    sections,
  };
}
