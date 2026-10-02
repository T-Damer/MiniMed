import { ContentPackSeedSchema } from '@localmed/contracts';
import rawCoreSlice from './generated/core-slice.json';

/**
 * A deterministic slice of the released corpus (see scripts/build-core-slice.ts): catalog
 * pointers and aliases from core.db, three released clinical recommendations, Allmed
 * instructions, ICD-10 entries and regulatory acts, with portable feature-hash embeddings.
 */
export const CORE_SLICE_PACK = ContentPackSeedSchema.parse(rawCoreSlice);

/** Stable identifiers inside {@link CORE_SLICE_PACK}. */
export const CORE_SLICE = {
  pneumonia: 'kr.rf.714_2',
  appendicitis: 'kr.rf.64_2',
  urinaryInfection: 'kr.rf.281_3',
  amoxicillinClavulanate: 'drug.allmed.3324',
  ibuprofen: 'drug.allmed.11',
  icdPneumonia: 'rls.mkb.node.j18',
  icdAppendicitis: 'rls.mkb.node.k35',
  pediatricInfectionsOrder: 'regulatory.rf.minzdravsoc.521n-2012',
  repealedPediatricsOrder: 'regulatory.rf.minzdravsoc.366n-2012',
  pneumoniaSummary: 'kr.rf.714_2.pneumonia',
  pneumoniaPointer: 'core.catalog.pointer.clinical.kr.rf.714_2-bdda529a738d527d',
} as const;

// core.db appears once per checksum: the current pointers, and summaries frozen from an earlier core.
const coreDatabaseDocumentIds = new Set(
  rawCoreSlice.sources
    .filter((source) => source.file === 'apps/app/public/content/core.db')
    .flatMap((source) => source.documents),
);
const coreDatabaseDocuments = CORE_SLICE_PACK.documents.filter((document) =>
  coreDatabaseDocumentIds.has(document.id),
);
const coreDatabaseChunkIds = new Set(
  coreDatabaseDocuments.flatMap((document) =>
    document.sections.flatMap((section) => section.chunks.map((chunk) => chunk.id)),
  ),
);
/** Only the part of the slice copied from core.db: catalog pointers and the core summary. */
export const CORE_SLICE_CORE_DB_PACK = {
  ...CORE_SLICE_PACK,
  documents: coreDatabaseDocuments,
  embeddings: CORE_SLICE_PACK.embeddings.filter((embedding) =>
    coreDatabaseChunkIds.has(embedding.chunkId),
  ),
};
