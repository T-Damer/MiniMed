package dev.localmed.nativespike.shared.search

import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.lexical.QueryDocumentIndex
import dev.localmed.nativespike.shared.lexical.buildQueryDocumentIndex
import dev.localmed.nativespike.shared.lexical.filterQueryAliases
import dev.localmed.nativespike.shared.lexical.runLookupPipelineGroups
import dev.localmed.nativespike.shared.lexical.sortAliasesLikeMultiMedicalStore
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.DocumentKind
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.model.SearchResultItem
import dev.localmed.nativespike.shared.model.SearchTiming
import kotlin.time.TimeSource

private const val GROUP_LIMIT = 20
private const val ITEMS_PER_GROUP = 3

/**
 * Stage 4 (docs/CURRENT_STATE.md): the full ported pipeline (stage 2 sub-stages A–D —
 * `buildLookupQueryPlan`, SQL branch execution, fusion/grouping/ranking, `QueryDocumentIndex`)
 * wired into the spike UI, replacing `SearchEngine`'s deliberately simplified single-branch
 * matcher (kept in the tree, unreferenced, for anyone who wants the pre-stage-2 baseline).
 *
 * `aliases`/`documentIndex` are built ONCE, here in the constructor, not per query — mirrors
 * `create-medical-core.ts` caching `queryDocumentIndex`/its alias expander, and matters for an
 * honest comparison: the real WebView pipeline builds its own equivalent index at app startup too.
 * `indexBuildMs` records how long that took so the caller (`MainActivity`) can report it as its own
 * cold-start line, separate from first-frame time — per the coordinator's stage 4 instruction.
 *
 * `SearchTiming.sqlOnlyMs`/`totalMs` are equal here (both the whole `runLookupPipelineGroups` wall
 * time): unlike `SearchEngine`'s single FTS5 query, the full pipeline runs several interleaved SQL
 * round trips (one bm25 query + one hydration query per branch, plus any exact-identity lookups)
 * mixed with Kotlin-side fusion/ranking — splitting "SQL-only" from "app compute" the way
 * `SearchEngine.measureSqlOnlyMs` did for one query no longer isolates a meaningful boundary, so
 * this doesn't pretend to; both fields report the same honestly-measured total.
 */
class LookupEngine(private val database: NativeSearchDatabase) {
    val aliases: List<AliasRecord>
    val documentIndex: QueryDocumentIndex
    val indexBuildMs: Double

    init {
        val started = TimeSource.Monotonic.markNow()
        aliases = filterQueryAliases(sortAliasesLikeMultiMedicalStore(database.listAliases()))
        documentIndex = buildQueryDocumentIndex(database)
        indexBuildMs = started.elapsedNow().inWholeMicroseconds / 1000.0
    }

    fun search(query: String): SearchOutcome? {
        if (query.isBlank()) return null
        val started = TimeSource.Monotonic.markNow()
        val groups = runLookupPipelineGroups(query, aliases, database, documentIndex, GROUP_LIMIT)
        val totalMs = started.elapsedNow().inWholeMicroseconds / 1000.0

        val uiGroups = groups.map { group ->
            SearchResultGroup(
                documentId = group.documentId,
                documentTitle = group.title,
                documentKind = DocumentKind.fromSourceType(group.results.firstOrNull()?.sourceType ?: ""),
                items = group.results.take(ITEMS_PER_GROUP).map { result ->
                    SearchResultItem(
                        chunkId = result.chunkId,
                        sectionId = result.sectionId,
                        sectionPath = result.sectionPath.joinToString(" › "),
                        anchor = result.anchor,
                        snippet = result.previewText,
                    )
                },
            )
        }
        return SearchOutcome(groups = uiGroups, timing = SearchTiming(sqlOnlyMs = totalMs, totalMs = totalMs))
    }
}
