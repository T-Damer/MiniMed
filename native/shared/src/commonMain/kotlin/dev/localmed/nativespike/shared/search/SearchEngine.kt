package dev.localmed.nativespike.shared.search

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.model.SearchResultItem
import dev.localmed.nativespike.shared.model.SearchTiming
import dev.localmed.nativespike.shared.text.buildMatchExpression
import dev.localmed.nativespike.shared.text.tokenize
import kotlin.time.TimeSource

/** Document-level cap and per-document section cap for the result list, matching the general
 * shape of the web search page's grouped-by-document list. */
private const val MAX_DOCUMENT_GROUPS = 20
private const val MAX_SECTIONS_PER_DOCUMENT = 3
private const val FTS_ROW_LIMIT = 120

/**
 * Orchestrates one search: builds the FTS5 MATCH expression (alias-expanded), runs it, groups
 * hits by document, and reports the SQL-only vs. end-to-end timing split the spike's measurement
 * plan asks for. See `TextNormalization.kt` for exactly which parts of the web app's ranking this
 * does and does not reproduce.
 */
class SearchEngine(private val database: NativeSearchDatabase) {

    fun search(query: String): SearchOutcome? {
        val started = TimeSource.Monotonic.markNow()
        val tokens = tokenize(query)
        if (tokens.isEmpty()) return null
        val aliasTerms = database.canonicalTermsForAliases(tokens)
        val matchExpression = buildMatchExpression(query, aliasTerms) ?: return null

        val sqlOnlyMs = database.measureSqlOnlyMs(matchExpression, FTS_ROW_LIMIT)
        val hits = database.searchChunks(matchExpression, FTS_ROW_LIMIT)

        val grouped = LinkedHashMap<String, MutableList<SearchResultItem>>()
        val kindByDocument = HashMap<String, dev.localmed.nativespike.shared.model.DocumentKind>()
        val titleByDocument = HashMap<String, String>()
        for (hit in hits) {
            val items = grouped.getOrPut(hit.documentId) { mutableListOf() }
            if (items.size >= MAX_SECTIONS_PER_DOCUMENT) continue
            items.add(
                SearchResultItem(
                    chunkId = hit.chunkId,
                    sectionId = hit.sectionId,
                    sectionPath = hit.sectionPath,
                    anchor = hit.anchor,
                    snippet = hit.snippet,
                ),
            )
            kindByDocument[hit.documentId] = hit.documentKind
            titleByDocument[hit.documentId] = hit.documentTitle
        }

        val groups = grouped.entries.take(MAX_DOCUMENT_GROUPS).map { (documentId, items) ->
            SearchResultGroup(
                documentId = documentId,
                documentTitle = titleByDocument.getValue(documentId),
                documentKind = kindByDocument.getValue(documentId),
                items = items,
            )
        }

        val totalMs = started.elapsedNow().inWholeMicroseconds / 1000.0
        return SearchOutcome(groups = groups, timing = SearchTiming(sqlOnlyMs, totalMs))
    }
}
