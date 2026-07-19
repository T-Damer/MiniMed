export interface MedicalDocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string | null;
  readonly sourceType: string;
  readonly status: string;
  readonly specialties: readonly string[];
  readonly versionId: string;
  readonly versionLabel: string;
  readonly effectiveFrom: string | null;
}

export interface MedicalChunk {
  readonly id: string;
  readonly sectionId: string;
  readonly documentVersionId: string;
  readonly orderIndex: number;
  readonly originalText: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly anchor: string;
}

export interface MedicalSection {
  readonly id: string;
  readonly documentVersionId: string;
  readonly parentSectionId: string | null;
  readonly title: string;
  readonly sectionType: string | null;
  readonly depth: number;
  readonly orderIndex: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly anchor: string;
  readonly sectionPath: readonly string[];
  readonly chunks: readonly MedicalChunk[];
}

export interface MedicalDocument extends MedicalDocumentSummary {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sections: readonly MedicalSection[];
}

export interface ChunkContext {
  readonly document: MedicalDocumentSummary;
  readonly section: MedicalSection;
  readonly focusChunkId: string;
  readonly chunks: readonly MedicalChunk[];
  readonly previousChunkId: string | null;
  readonly nextChunkId: string | null;
}
