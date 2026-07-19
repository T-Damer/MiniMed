import type { ContentPackSeed, EmbeddingProfile } from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';

import type {
  LexicalHit,
  LexicalSearchRequest,
  MedicalStore,
  StorageHealth,
  VectorHit,
  VectorSearchRequest,
} from './ports';

interface MemoryEmbedding {
  readonly profileId: string;
  readonly chunkId: string;
  readonly values: readonly number[];
  readonly norm: number;
}

interface MemoryState {
  readonly schemaVersion: number;
  readonly documents: readonly DocumentRecord[];
  readonly sections: readonly SectionRecord[];
  readonly chunks: readonly ChunkRecord[];
  readonly aliases: readonly AliasRecord[];
  readonly embeddingProfiles: readonly EmbeddingProfile[];
  readonly embeddings: readonly MemoryEmbedding[];
  readonly packIds: readonly string[];
}

const EMPTY_STATE: MemoryState = {
  schemaVersion: 1,
  documents: [],
  sections: [],
  chunks: [],
  aliases: [],
  embeddingProfiles: [],
  embeddings: [],
  packIds: [],
};

function buildState(seed: ContentPackSeed): MemoryState {
  const documents: DocumentRecord[] = [];
  const sections: SectionRecord[] = [];
  const chunks: ChunkRecord[] = [];

  for (const sourceDocument of seed.documents) {
    documents.push({
      id: sourceDocument.id,
      contentPackId: seed.manifest.id,
      title: sourceDocument.title,
      shortTitle: sourceDocument.shortTitle,
      sourceType: sourceDocument.sourceType,
      status: sourceDocument.status,
      specialties: sourceDocument.specialties,
      metadata: sourceDocument.metadata,
      version: {
        id: sourceDocument.version.id,
        documentId: sourceDocument.id,
        versionLabel: sourceDocument.version.label,
        effectiveFrom: sourceDocument.version.effectiveFrom,
        effectiveTo: sourceDocument.version.effectiveTo,
        sourceChecksum: sourceDocument.version.sourceChecksum,
        extractedAt: sourceDocument.version.extractedAt,
      },
    });

    const orderedChunks = sourceDocument.sections
      .flatMap((section) => section.chunks)
      .toSorted((left, right) => left.orderIndex - right.orderIndex);
    const neighbors = new Map(
      orderedChunks.map((chunk, index) => [
        chunk.id,
        {
          previous: orderedChunks[index - 1]?.id ?? null,
          next: orderedChunks[index + 1]?.id ?? null,
        },
      ]),
    );

    for (const sourceSection of sourceDocument.sections) {
      sections.push({
        id: sourceSection.id,
        documentVersionId: sourceDocument.version.id,
        parentSectionId: sourceSection.parentSectionId,
        title: sourceSection.title,
        normalizedTitle: sourceSection.normalizedTitle,
        sectionType: sourceSection.sectionType,
        depth: sourceSection.depth,
        orderIndex: sourceSection.orderIndex,
        pageStart: sourceSection.pageStart,
        pageEnd: sourceSection.pageEnd,
        anchor: sourceSection.anchor,
        sectionPath: sourceSection.sectionPath,
      });

      for (const sourceChunk of sourceSection.chunks) {
        const neighbor = neighbors.get(sourceChunk.id);
        chunks.push({
          id: sourceChunk.id,
          documentVersionId: sourceDocument.version.id,
          sectionId: sourceSection.id,
          orderIndex: sourceChunk.orderIndex,
          originalText: sourceChunk.originalText,
          normalizedText: sourceChunk.normalizedText,
          pageStart: sourceChunk.pageStart,
          pageEnd: sourceChunk.pageEnd,
          charStart: sourceChunk.charStart,
          charEnd: sourceChunk.charEnd,
          previousChunkId: neighbor?.previous ?? null,
          nextChunkId: neighbor?.next ?? null,
          anchor: sourceChunk.anchor,
          metadata: sourceChunk.metadata,
        });
      }
    }
  }

  return {
    schemaVersion: seed.manifest.schemaVersion,
    documents,
    sections,
    chunks,
    aliases: seed.aliases,
    embeddingProfiles: seed.embeddingProfiles,
    embeddings: seed.embeddings,
    packIds: [seed.manifest.id],
  };
}

function metadataStrings(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function intersects(left: readonly string[], right: readonly string[] | undefined): boolean {
  if (!right || right.length === 0) return true;
  const expected = new Set(right);
  return left.some((value) => expected.has(value));
}

function matchesFilters(
  document: DocumentRecord,
  section: SectionRecord,
  filters: VectorSearchRequest['filters'],
): boolean {
  if (filters.documentIds?.length && !filters.documentIds.includes(document.id)) return false;
  if (filters.sectionTypes?.length && !filters.sectionTypes.includes(section.sectionType ?? '')) {
    return false;
  }
  return (
    intersects(document.specialties, filters.specialties) &&
    intersects(metadataStrings(document.metadata, 'ageGroups'), filters.ageGroups)
  );
}

function cosine(
  left: readonly number[],
  right: readonly number[],
  leftNorm: number,
  rightNorm: number,
): number {
  if (left.length !== right.length || leftNorm === 0 || rightNorm === 0) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Math.max(-1, Math.min(1, dot / (leftNorm * rightNorm)));
}

export class InMemoryMedicalStore implements MedicalStore {
  private state: MemoryState = EMPTY_STATE;
  private initialized = false;

  public async initialize(seed?: ContentPackSeed): Promise<StorageHealth> {
    if (seed) this.state = buildState(seed);
    this.initialized = true;
    return this.getHealth();
  }

  public async getHealth(): Promise<StorageHealth> {
    this.assertInitialized();
    return {
      schemaVersion: this.state.schemaVersion,
      sqliteVersion: 'memory-adapter',
      fts5Available: false,
      contentPackIds: this.state.packIds,
      documentCount: this.state.documents.length,
      backend: 'in-memory',
      persistent: false,
      installation: 'memory',
      sizeBytes: null,
    };
  }

  public async listDocuments(): Promise<readonly DocumentRecord[]> {
    this.assertInitialized();
    return this.state.documents.toSorted((left, right) => left.title.localeCompare(right.title));
  }

  public async getDocument(id: string): Promise<DocumentRecord | null> {
    this.assertInitialized();
    return this.state.documents.find((document) => document.id === id) ?? null;
  }

  public async getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    this.assertInitialized();
    return this.state.documents.find((document) => document.version.id === versionId) ?? null;
  }

  public async getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    const document = await this.getDocument(documentId);
    if (!document) return [];
    return this.state.sections
      .filter((section) => section.documentVersionId === document.version.id)
      .toSorted((left, right) => left.orderIndex - right.orderIndex);
  }

  public async getSection(id: string): Promise<SectionRecord | null> {
    this.assertInitialized();
    return this.state.sections.find((section) => section.id === id) ?? null;
  }

  public async getChunksBySection(sectionId: string): Promise<readonly ChunkRecord[]> {
    this.assertInitialized();
    return this.state.chunks
      .filter((chunk) => chunk.sectionId === sectionId)
      .toSorted((left, right) => left.orderIndex - right.orderIndex);
  }

  public async getChunk(id: string): Promise<ChunkRecord | null> {
    this.assertInitialized();
    return this.state.chunks.find((chunk) => chunk.id === id) ?? null;
  }

  public async getChunkWindow(chunkId: string, radius: number): Promise<readonly ChunkRecord[]> {
    const focus = await this.getChunk(chunkId);
    if (!focus) return [];
    return this.state.chunks
      .filter(
        (chunk) =>
          chunk.documentVersionId === focus.documentVersionId &&
          Math.abs(chunk.orderIndex - focus.orderIndex) <= radius,
      )
      .toSorted((left, right) => left.orderIndex - right.orderIndex);
  }

  public async listAliases(): Promise<readonly AliasRecord[]> {
    this.assertInitialized();
    return this.state.aliases;
  }

  public async listEmbeddingProfiles(): Promise<readonly EmbeddingProfile[]> {
    this.assertInitialized();
    return this.state.embeddingProfiles;
  }

  public async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    this.assertInitialized();
    const documentByVersion = new Map(
      this.state.documents.map((document) => [document.version.id, document]),
    );
    const sectionById = new Map(this.state.sections.map((section) => [section.id, section]));

    return this.state.chunks
      .flatMap((chunk): LexicalHit[] => {
        const document = documentByVersion.get(chunk.documentVersionId);
        const section = sectionById.get(chunk.sectionId);
        if (!document || !section || !matchesFilters(document, section, request.filters)) return [];

        const haystack = chunk.normalizedText;
        const matches = request.terms.filter((term) => haystack.includes(term));
        if (matches.length === 0) return [];
        const titleBonus = request.terms.some((term) => document.title.toLowerCase().includes(term))
          ? 2
          : 0;
        return [{ chunk, section, document, rank: matches.length + titleBonus }];
      })
      .toSorted((left, right) => right.rank - left.rank)
      .slice(0, request.limit);
  }

  public async searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    this.assertInitialized();
    const documentByVersion = new Map(
      this.state.documents.map((document) => [document.version.id, document]),
    );
    const sectionById = new Map(this.state.sections.map((section) => [section.id, section]));
    const chunkById = new Map(this.state.chunks.map((chunk) => [chunk.id, chunk]));

    return this.state.embeddings
      .flatMap((embedding): VectorHit[] => {
        if (embedding.profileId !== request.profileId) return [];
        const chunk = chunkById.get(embedding.chunkId);
        if (!chunk) return [];
        const document = documentByVersion.get(chunk.documentVersionId);
        const section = sectionById.get(chunk.sectionId);
        if (!document || !section || !matchesFilters(document, section, request.filters)) return [];
        return [
          {
            chunk,
            section,
            document,
            score: cosine(request.vector, embedding.values, request.norm, embedding.norm),
          },
        ];
      })
      .toSorted((left, right) => right.score - left.score)
      .slice(0, request.limit);
  }

  public async close(): Promise<void> {
    this.state = EMPTY_STATE;
    this.initialized = false;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('In-memory store is not initialized.');
  }
}
