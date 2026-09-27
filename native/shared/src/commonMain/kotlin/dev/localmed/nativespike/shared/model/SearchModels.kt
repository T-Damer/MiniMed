package dev.localmed.nativespike.shared.model

/** Mirrors `documents.source_type` closely enough to show the same kind badge the web app shows. */
enum class DocumentKind(val label: String) {
    CLINICAL_RECOMMENDATION("Клин. рекомендации"),
    OFFICIAL_REGISTRY("Реестр"),
    CATALOG_POINTER("Справочник"),
    UNKNOWN("Документ");

    companion object {
        fun fromSourceType(sourceType: String): DocumentKind = when (sourceType) {
            "clinical_recommendation_summary" -> CLINICAL_RECOMMENDATION
            "official_registry_summary" -> OFFICIAL_REGISTRY
            "core_catalog_pointer" -> CATALOG_POINTER
            else -> UNKNOWN
        }
    }
}

/** One raw FTS5 hit before grouping, straight off `chunks_fts` joined with `documents`. */
data class ChunkHit(
    val chunkId: String,
    val documentId: String,
    val documentTitle: String,
    val documentKind: DocumentKind,
    val sectionId: String,
    val sectionPath: String,
    val anchor: String,
    val snippet: String,
    val bm25Score: Double,
)

/** One row inside a grouped document card. */
data class SearchResultItem(
    val chunkId: String,
    val sectionId: String,
    val sectionPath: String,
    val anchor: String,
    val snippet: String,
)

/** A document card in the result list: title, kind badge, its best-matching sections. */
data class SearchResultGroup(
    val documentId: String,
    val documentTitle: String,
    val documentKind: DocumentKind,
    val items: List<SearchResultItem>,
)

/** A reader table-of-contents row. */
data class SectionRow(
    val id: String,
    val title: String,
    val depth: Int,
    val orderIndex: Int,
    val anchor: String,
)

/** One reader paragraph. */
data class ReaderChunk(
    val id: String,
    val orderIndex: Int,
    val text: String,
    val anchor: String,
)

/** Timing split reported alongside every search, per the spike's measurement requirements. */
data class SearchTiming(
    val sqlOnlyMs: Double,
    val totalMs: Double,
)

data class SearchOutcome(
    val groups: List<SearchResultGroup>,
    val timing: SearchTiming,
)
