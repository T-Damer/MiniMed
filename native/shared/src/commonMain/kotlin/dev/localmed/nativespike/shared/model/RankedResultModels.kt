package dev.localmed.nativespike.shared.model

import dev.localmed.nativespike.shared.text.TextRange
import dev.localmed.nativespike.shared.core.NativeDocumentTarget

/** Ranked source passage, retaining reader identity and query-aligned excerpt evidence. */
data class RankedResult(
    val chunkId: String,
    val documentId: String,
    val sourceType: String,
    val documentTitle: String,
    val sectionType: String?,
    val category: String,
    val sectionPath: List<String>,
    val matchedTerms: List<String>,
    val finalScore: Double,
    val anchor: String = "",
    val sectionId: String = "",
    val documentVersionId: String = "",
    val snippet: String = "",
    val highlightedRanges: List<TextRange> = emptyList(),
    val target: NativeDocumentTarget? = null,
    val sourceTarget: NativeDocumentTarget? = null,
)

/** Mirrors `SearchResultGroup` (packages/contracts/src/search.ts), same narrowing as `RankedResult`. */
data class RankedGroup(
    val documentId: String,
    val title: String,
    val bestScore: Double,
    val results: List<RankedResult>,
    val documentKind: String? = null,
    val contentKind: String? = null,
    /** See `LookupPipeline.kt`'s `resolveTargetDocumentId` doc — golden's benchmark-only `target()`
     * semantics, not the pipeline's own internal `resolvedGroupIdentity` dedup key. */
    val targetDocumentId: String = "",
)
