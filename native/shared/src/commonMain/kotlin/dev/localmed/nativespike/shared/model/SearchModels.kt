package dev.localmed.nativespike.shared.model

import dev.localmed.nativespike.shared.text.TextRange
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
enum class NativeSearchMode { @SerialName("lookup") LOOKUP, @SerialName("clinical") CLINICAL }

/** Presentation kinds and labels match the web result-card contract. */
enum class DocumentKind(val label: String) {
    CLINICAL_RECOMMENDATION("Клиническая рекомендация"),
    MEDICATION("Препарат"),
    LEGAL("Нормативный акт"),
    REFERENCE("Норма / справочник"),
    ASSESSMENT("Опросник"),
    CALCULATOR("Калькулятор"),
    UNKNOWN("Документ");

    companion object {
        fun fromClassifiedKind(kind: String?): DocumentKind = when (kind) {
            "clinical-recommendation" -> CLINICAL_RECOMMENDATION
            "medication" -> MEDICATION
            "legal" -> LEGAL
            "reference" -> REFERENCE
            "assessment" -> ASSESSMENT
            "calculator" -> CALCULATOR
            else -> UNKNOWN
        }

        /** Raw SQL measurement path lacks catalog metadata; the lookup UI uses classified kinds. */
        fun fromSourceType(sourceType: String): DocumentKind = when (sourceType) {
            "clinical_recommendation_summary" -> CLINICAL_RECOMMENDATION
            "official_registry_summary" -> MEDICATION
            "core_catalog_pointer" -> REFERENCE
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
    val highlightedRanges: List<TextRange> = emptyList(),
    val target: NativeDocumentTarget? = null,
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

/** SQL branch execution excludes hydration, planning, warmup and waiting for the shared DB gate.
 * totalMs measures the complete query pipeline after warmup and acquisition of that gate. */
data class SearchTiming(
    val sqlOnlyMs: Double,
    val totalMs: Double,
)

data class SearchOutcome(
    val groups: List<SearchResultGroup>,
    val timing: SearchTiming,
    val mode: NativeSearchMode = NativeSearchMode.LOOKUP,
    val analysis: QueryAnalysis? = null,
    val sourceGroups: List<RankedGroup> = emptyList(),
    val selection: NativeSearchSelection = NativeSearchSelection(),
)
