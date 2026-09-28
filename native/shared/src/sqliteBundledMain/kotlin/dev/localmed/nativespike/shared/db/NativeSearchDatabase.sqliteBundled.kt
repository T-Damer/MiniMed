package dev.localmed.nativespike.shared.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.BranchHit
import dev.localmed.nativespike.shared.model.ChunkHit
import dev.localmed.nativespike.shared.model.DocumentKind
import dev.localmed.nativespike.shared.model.ExactSubjectHitText
import dev.localmed.nativespike.shared.model.ReaderChunk
import dev.localmed.nativespike.shared.model.SectionRow
import kotlin.time.TimeSource

// androidx.sqlite mirrors the underlying C API convention: bind*(index) is 1-based (SQL
// parameter position), get*(index) is 0-based (column position in the SELECT list). Column
// indices below are hand-matched to each query's SELECT list order — kept in one file so the two
// stay next to each other.

/**
 * Shared actual for Android, desktop (JVM) and iOS (arm64 + simulator arm64) — one intermediate
 * source set (`sqliteBundledMain`, see shared/build.gradle.kts), not three copies, because
 * `androidx.sqlite-bundled`'s Kotlin API is identical across all of them (verified against its
 * Gradle Module Metadata: it publishes `androidJvm`, `jvm`, `iosArm64` and `iosSimulatorArm64`
 * variants — see docs/research/native-vs-webview-2026-09-28.md). It guarantees FTS5 regardless of
 * the OS's own SQLite build — the same reason `packages/storage-sqlite`/ADR-0018 avoid relying on
 * Android's framework SQLite. Read-only, single connection: this spike's search page is read-only
 * and single-threaded by design. wasmJs has no equivalent — see the explicit stub actual in
 * `wasmJsMain`.
 */
actual class NativeSearchDatabase actual constructor(private val dbFilePath: String) {
    private var connection: SQLiteConnection? = null

    private fun requireConnection(): SQLiteConnection =
        connection ?: error("NativeSearchDatabase.open() was not called before use")

    actual fun open() {
        val driver = BundledSQLiteDriver()
        val opened = driver.open(dbFilePath)
        connection = opened
        // Warm-up query: mirrors the web app's "core opened, first query possible" readiness
        // signal rather than just "file handle acquired".
        opened.prepare("SELECT count(*) FROM chunks_fts LIMIT 1").use { it.step() }
    }

    actual fun close() {
        connection?.close()
        connection = null
    }

    actual fun searchChunks(matchExpression: String, limit: Int): List<ChunkHit> {
        val sql = """
            SELECT f.chunk_id, f.document_id, f.section_id, f.anchor, f.section_path,
                   d.title, d.source_type,
                   snippet(chunks_fts, -1, '[', ']', '…', 12) AS snippet,
                   bm25(chunks_fts, 8.0, 3.0, 1.0) AS score
            FROM chunks_fts f
            JOIN documents d ON d.id = f.document_id
            WHERE chunks_fts MATCH ?
            ORDER BY score
            LIMIT ?
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, matchExpression)
            statement.bindLong(2, limit.toLong())
            val results = mutableListOf<ChunkHit>()
            while (statement.step()) {
                results.add(
                    ChunkHit(
                        chunkId = statement.getText(0),
                        documentId = statement.getText(1),
                        sectionId = statement.getText(2),
                        anchor = statement.getText(3),
                        sectionPath = statement.getText(4),
                        documentTitle = statement.getText(5),
                        documentKind = DocumentKind.fromSourceType(statement.getText(6)),
                        snippet = statement.getText(7),
                        bm25Score = statement.getDouble(8),
                    ),
                )
            }
            results
        }
    }

    actual fun measureSqlOnlyMs(matchExpression: String, limit: Int): Double {
        val sql = """
            SELECT f.chunk_id
            FROM chunks_fts f
            WHERE chunks_fts MATCH ?
            ORDER BY bm25(chunks_fts, 8.0, 3.0, 1.0)
            LIMIT ?
        """.trimIndent()
        val started = TimeSource.Monotonic.markNow()
        requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, matchExpression)
            statement.bindLong(2, limit.toLong())
            while (statement.step()) { /* drain to force full execution */ }
        }
        return started.elapsedNow().inWholeMicroseconds / 1000.0
    }

    actual fun canonicalTermsForAliases(tokens: List<String>): List<String> {
        if (tokens.isEmpty()) return emptyList()
        val placeholders = tokens.joinToString(",") { "?" }
        val sql = "SELECT DISTINCT canonical_term FROM aliases WHERE alias IN ($placeholders)"
        return requireConnection().prepare(sql).use { statement ->
            tokens.forEachIndexed { index, token -> statement.bindText(index + 1, token) }
            val results = mutableListOf<String>()
            while (statement.step()) results.add(statement.getText(0))
            results
        }
    }

    actual fun listAliases(): List<AliasRecord> {
        // Mirrors `SqliteMedicalStore.listAliases()` (packages/storage-sqlite/src/sqlite-medical-store.ts):
        // `SELECT id, canonical_term, alias, category, weight FROM aliases NOT INDEXED ORDER BY alias`.
        val sql = "SELECT id, canonical_term, alias, category, weight FROM aliases NOT INDEXED ORDER BY alias"
        return requireConnection().prepare(sql).use { statement ->
            val results = mutableListOf<AliasRecord>()
            while (statement.step()) {
                results.add(
                    AliasRecord(
                        id = statement.getText(0),
                        canonicalTerm = statement.getText(1),
                        alias = statement.getText(2),
                        category = if (statement.isNull(3)) null else statement.getText(3),
                        weight = statement.getDouble(4),
                    ),
                )
            }
            results
        }
    }

    actual fun searchBranch(ftsQuery: String, limit: Int): List<BranchHit> {
        // Mirrors SqliteMedicalStore.search()/CapacitorMedicalStore.search()'s bm25-ranking phase
        // exactly (same weight vector, same rowid-window query). No filters/hydration join here —
        // see lexical/SearchExecution.kt's header for why that second phase isn't needed for this
        // spike's parity target.
        val sql = """
            SELECT chunks_fts.chunk_id AS chunk_id, ranked.bm25_rank AS bm25_rank
            FROM (
                SELECT chunks_fts.rowid AS fts_rowid,
                    bm25(chunks_fts, 0, 0, 0, 0, 0, 8.0, 4.0, 1.0) AS bm25_rank
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY bm25_rank
                LIMIT ?
            ) ranked
            JOIN chunks_fts ON chunks_fts.rowid = ranked.fts_rowid
            ORDER BY ranked.bm25_rank
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, ftsQuery)
            statement.bindLong(2, limit.toLong())
            val results = mutableListOf<BranchHit>()
            while (statement.step()) {
                val rawRank = statement.getDouble(1)
                val rank = if (rawRank < 0) -rawRank else 1.0 / (1.0 + rawRank)
                results.add(BranchHit(chunkId = statement.getText(0), rank = rank))
            }
            results
        }
    }

    actual fun textsForChunks(chunkIds: List<String>): List<ExactSubjectHitText> {
        if (chunkIds.isEmpty()) return emptyList()
        val placeholders = chunkIds.joinToString(",") { "?" }
        val sql = """
            SELECT d.title AS document_title, s.title AS section_title, c.original_text AS original_text
            FROM chunks c
            JOIN sections s ON s.id = c.section_id
            JOIN document_versions dv ON dv.id = c.document_version_id
            JOIN documents d ON d.id = dv.document_id
            WHERE c.id IN ($placeholders)
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            chunkIds.forEachIndexed { index, id -> statement.bindText(index + 1, id) }
            val results = mutableListOf<ExactSubjectHitText>()
            while (statement.step()) {
                results.add(
                    ExactSubjectHitText(
                        documentTitle = statement.getText(0),
                        sectionTitle = statement.getText(1),
                        originalText = statement.getText(2),
                    ),
                )
            }
            results
        }
    }

    actual fun sectionsForDocument(documentId: String): List<SectionRow> {
        val sql = """
            SELECT s.id, s.title, s.depth, s.order_index, s.anchor
            FROM sections s
            JOIN documents d ON d.current_version_id = s.document_version_id
            WHERE d.id = ?
            ORDER BY s.order_index
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, documentId)
            val results = mutableListOf<SectionRow>()
            while (statement.step()) {
                results.add(
                    SectionRow(
                        id = statement.getText(0),
                        title = statement.getText(1),
                        depth = statement.getLong(2).toInt(),
                        orderIndex = statement.getLong(3).toInt(),
                        anchor = statement.getText(4),
                    ),
                )
            }
            results
        }
    }

    actual fun chunksForSection(sectionId: String): List<ReaderChunk> {
        val sql = """
            SELECT id, order_index, original_text, anchor
            FROM chunks
            WHERE section_id = ?
            ORDER BY order_index
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, sectionId)
            val results = mutableListOf<ReaderChunk>()
            while (statement.step()) {
                results.add(
                    ReaderChunk(
                        id = statement.getText(0),
                        orderIndex = statement.getLong(1).toInt(),
                        text = statement.getText(2),
                        anchor = statement.getText(3),
                    ),
                )
            }
            results
        }
    }
}

private inline fun <T> SQLiteStatement.use(block: (SQLiteStatement) -> T): T {
    try {
        return block(this)
    } finally {
        close()
    }
}
