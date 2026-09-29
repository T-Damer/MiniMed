package dev.localmed.nativespike.shared.db

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.BranchHit
import dev.localmed.nativespike.shared.model.ChunkHit
import dev.localmed.nativespike.shared.model.ExactSubjectHitText
import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.ReaderChunk
import dev.localmed.nativespike.shared.model.SearchDocumentSummary
import dev.localmed.nativespike.shared.model.SectionRow

/**
 * Raw SQL access to `core.db`. Declared `expect` so platform actuals can plug in whatever SQLite
 * binding that platform has: on Android this is `androidx.sqlite` with the bundled driver
 * (guarantees FTS5 regardless of the OS's system SQLite build — see ADR 0021). A desktop actual
 * would reuse the same androidx.sqlite-bundled JVM artifact; an iOS/Wasm actual would need a
 * different binding entirely (see the commented targets in shared/build.gradle.kts).
 */
expect class NativeSearchDatabase(dbFilePath: String) {
    /** Opens the connection and runs one warm-up query, mirroring the web app's "search ready"
     * signal (core opened, first query possible) rather than just "file exists". */
    fun open()

    fun close()

    /** FTS5 MATCH against `chunks_fts` joined with `documents`, ordered by bm25. */
    fun searchChunks(matchExpression: String, limit: Int): List<ChunkHit>

    /** Elapsed wall time (ms) for exactly the same query `searchChunks` runs, isolating SQL/FTS5
     * engine time from Compose recomposition and list-rendering time. */
    fun measureSqlOnlyMs(matchExpression: String, limit: Int): Double

    /** Canonical terms for aliases whose `alias` column exactly equals one of `tokens`. */
    fun canonicalTermsForAliases(tokens: List<String>): List<String>

    /** The full `aliases` table — `id, canonical_term, alias, category, weight` — for
     * `lexical/Aliases.kt`'s `createAliasExpander` to build its in-memory vocabulary snapshot from,
     * mirroring `MultiMedicalStore.listAliases()` (packages/storage/src/multi-medical-store.ts). */
    fun listAliases(): List<AliasRecord>

    fun sectionsForDocument(documentId: String): List<SectionRow>

    fun chunksForSection(sectionId: String): List<ReaderChunk>

    /**
     * Mirrors `SqliteMedicalStore.search()`/`CapacitorMedicalStore.search()`'s bm25-ranking phase —
     * stage 2 sub-stage C of the migration (docs/CURRENT_STATE.md): a two-phase rowid-window ->
     * hydration pattern (here, no hydration is needed — see `lexical/SearchExecution.kt`'s header
     * for why). Same bm25 weight vector both TS stores use: `bm25(chunks_fts, 0,0,0,0,0,8,4,1)`.
     * No filters (`request.filters` is always `{}` in the golden export this is checked against).
     */
    fun searchBranch(ftsQuery: String, limit: Int): List<BranchHit>

    /** Mirrors the fields `hitsContainExactSubject` (create-medical-core.ts) reads off a hit. */
    fun textsForChunks(chunkIds: List<String>): List<ExactSubjectHitText>

    /**
     * Stage 2 sub-stage D's hydration phase: mirrors the second (chunk/section/document) JOIN
     * `SqliteMedicalStore.search()`/`CapacitorMedicalStore.search()` run after their bm25-ranked
     * rowid window, PLUS the specific document/chunk metadata fields the fusion/grouping/kind
     * pipeline reads — extracted with SQL `json_extract`/`json_each`, not a Kotlin JSON parser (this
     * module has no JSON library in `commonMain`; adding one for a handful of scalar/array fields
     * was worse than letting SQLite do it, which it already can). `rank` is not set here — the
     * caller fills it in from the `BranchHit` this chunk id came from.
     */
    fun hydrateHits(chunkIds: List<String>): List<HydratedHit>

    /** Every document id in the corpus — mirrors `QueryDocumentIndex.availableIds`'s source data
     * (`document-siblings.ts`'s `isSupersededSummaryDocument` needs the full id set, not just the
     * ids already present in a query's own results, to know whether a `.full` sibling exists). */
    fun allDocumentIds(): List<String>

    /**
     * Every document's identity fields (title, short title, declared/navigation aliases) — the
     * source data `QueryDocumentIndex` (packages/core/src/query-document-index.ts) builds its
     * exact-identity lookup maps from, once per document-list version, not per query. Loads the
     * whole ~20k-document corpus in one query.
     *
     * **Optimization-pass correction**: `create-medical-core.ts` does NOT build this at startup —
     * it builds `queryDocumentIndex` lazily inside the first `search()` call (see
     * `QueryDocumentIndex.kt`'s header for the exact line). `LookupEngine.kt` now builds this in the
     * background right after construction instead of blocking first frame OR waiting for the first
     * query, which is faster to a ready index than either TS's behavior or this port's own stage-4
     * behavior (eager, blocking, at startup) — see that file's header.
     */
    fun listSearchDocuments(): List<SearchDocumentSummary>

    /**
     * The first chunk (by section, then chunk order) of a document's current version with
     * non-blank text — mirrors the fallback path in `buildExactIdentityResults`
     * (create-medical-core.ts) for a document an exact alias/title/short-title match names but that
     * no branch's own FTS search surfaced. `rank` is unset (0.0); exact-identity results always use
     * a hardcoded score, not a lexical rank (see `lexical/ExactIdentity.kt`).
     */
    fun firstReadableChunk(documentId: String): HydratedHit?
}
