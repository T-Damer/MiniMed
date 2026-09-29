package dev.localmed.nativespike.shared.model

/** Mirrors the `SearchDocumentDescriptor` fields `QueryDocumentIndex` (packages/core/src/query-document-index.ts)
 * reads to build its identity indexes — one row per document in the whole corpus, not per hit. */
data class SearchDocumentSummary(
    val id: String,
    val title: String,
    val shortTitle: String?,
    val sourceType: String,
    val declaredAliases: List<String>,
    val navigationAliases: List<String>,
)
