package dev.localmed.nativespike.shared.model

/**
 * A narrowed mirror of `SearchResult` (packages/contracts/src/search.ts) — stage 2 sub-stage D
 * (docs/CURRENT_STATE.md). Drops `anchor`/`highlightedRanges`/`documentVersionId`/`sectionId`/
 * `conceptId`/`terminologyConceptIds`/UI-only fields: none feed `bestScore`, group order,
 * `documentKind`, or `contentKind` — the only fields this migration's golden fixture compares.
 * `snippet` is dropped entirely (not `""`): nothing this port keeps needs it (see
 * `lexical/Fusion.kt`'s header for exactly which TS pieces read a snippet and why they're excluded).
 */
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
    /** `anchor`/`sectionId`: kept (unlike the rest of this narrowing) because stage 4's UI wiring
     * needs them to open a reader at the right place — not read by any compared parity field. */
    val anchor: String = "",
    val sectionId: String = "",
    /** A plain truncated `originalText` prefix, NOT a port of `buildQueryAlignedSnippet`/
     * `buildSnippet` (query-term highlighting, row-alignment for medication presentation rows —
     * see `lexical/Fusion.kt`'s header for why that's out of scope). UI-display-only, never read by
     * a compared field. */
    val previewText: String = "",
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
