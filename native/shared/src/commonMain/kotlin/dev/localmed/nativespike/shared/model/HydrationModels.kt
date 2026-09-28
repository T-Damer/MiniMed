package dev.localmed.nativespike.shared.model

/**
 * A hydrated hit — chunk + section + document, with exactly the document-metadata fields stage 2
 * sub-stage D's ranking/grouping logic reads (docs/CURRENT_STATE.md). Mirrors `LexicalHit`
 * (packages/domain: `ChunkRecord`+`SectionRecord`+`DocumentRecord`) narrowed to what
 * `fuseBranchHits`/`query-group-ranking.ts`/`ScopedMedicalCore.ts` actually use — not a full 1:1
 * `DocumentRecord`/`SectionRecord`/`ChunkRecord` port (metadata JSON parsing stays in SQL via
 * `json_extract`/`json_each`, not a Kotlin JSON model — see `db/NativeSearchDatabase.kt`'s
 * `hydrateHits` doc for why).
 */
data class HydratedHit(
    val chunkId: String,
    val documentVersionId: String,
    val sectionId: String,
    val anchor: String,
    val originalText: String,
    val sectionTitle: String,
    val sectionType: String?,
    val sectionPath: List<String>,
    val terminologyConceptIds: List<String>,
    val documentId: String,
    val documentTitle: String,
    val documentShortTitle: String?,
    val sourceType: String,
    val catalogFamily: String?,
    val entityType: String?,
    val targetDocumentId: String?,
    val contentMode: String?,
    val notLegalAdvice: Boolean,
    val interactiveAssessmentId: String?,
    val calculationRequired: Boolean,
    val interactiveCalculatorId: String?,
    val conceptId: String?,
    val navigationAliases: List<String>,
    val ageGroups: List<String>,
    /** Set by the caller from the `BranchHit`/`searchBranch` result this hit's chunk id came from —
     * mirrors `LexicalHit.rank`. */
    val rank: Double,
)
