export interface DocumentVersionRecord {
  readonly id: string;
  readonly documentId: string;
  readonly versionLabel: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly sourceChecksum: string;
  readonly extractedAt: string;
}

export interface DocumentRecord {
  readonly id: string;
  readonly contentPackId: string;
  readonly title: string;
  readonly shortTitle: string | null;
  readonly sourceType: string;
  readonly status: string;
  readonly specialties: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly version: DocumentVersionRecord;
}

export interface SectionRecord {
  readonly id: string;
  readonly documentVersionId: string;
  readonly parentSectionId: string | null;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly sectionType: string | null;
  readonly depth: number;
  readonly orderIndex: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly anchor: string;
  readonly sectionPath: readonly string[];
}

export interface ChunkRecord {
  readonly id: string;
  readonly documentVersionId: string;
  readonly sectionId: string;
  readonly orderIndex: number;
  readonly originalText: string;
  readonly normalizedText: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly charStart: number | null;
  readonly charEnd: number | null;
  readonly previousChunkId: string | null;
  readonly nextChunkId: string | null;
  readonly anchor: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AliasRecord {
  readonly id: string;
  readonly canonicalTerm: string;
  readonly alias: string;
  readonly category: string | null;
  readonly weight: number;
}
