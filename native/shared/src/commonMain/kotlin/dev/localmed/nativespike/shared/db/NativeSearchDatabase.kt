package dev.localmed.nativespike.shared.db

import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.ChunkHit
import dev.localmed.nativespike.shared.model.ReaderChunk
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
}
