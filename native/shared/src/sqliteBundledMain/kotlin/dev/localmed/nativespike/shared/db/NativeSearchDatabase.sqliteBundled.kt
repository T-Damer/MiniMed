package dev.localmed.nativespike.shared.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import dev.localmed.nativespike.shared.core.NativeDefinitionBlockPage
import dev.localmed.nativespike.shared.core.NativeDefinitionCard
import dev.localmed.nativespike.shared.core.NativeDefinitionSource
import dev.localmed.nativespike.shared.core.NativeDefinitionStatus
import dev.localmed.nativespike.shared.core.NativeDefinitionTextPage
import dev.localmed.nativespike.shared.core.NativeCoreIdentityTarget
import dev.localmed.nativespike.shared.core.normalizeNativeIdentityName
import dev.localmed.nativespike.shared.core.validateIdentityHit
import dev.localmed.nativespike.shared.content.contentJson
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import dev.localmed.nativespike.shared.core.NativeSourceSection
import dev.localmed.nativespike.shared.core.NativeSourceChunk
import dev.localmed.nativespike.shared.model.AliasRecord
import dev.localmed.nativespike.shared.model.BranchHit
import dev.localmed.nativespike.shared.model.ChunkHit
import dev.localmed.nativespike.shared.model.DocumentKind
import dev.localmed.nativespike.shared.model.ExactSubjectHitText
import dev.localmed.nativespike.shared.model.HydratedHit
import dev.localmed.nativespike.shared.model.ReaderChunk
import dev.localmed.nativespike.shared.model.SearchDocumentSummary
import dev.localmed.nativespike.shared.model.SectionRow
import dev.localmed.nativespike.shared.model.NativeSearchFilters
import dev.localmed.nativespike.shared.model.SearchVersionIdentity
import dev.localmed.nativespike.shared.model.DocumentDescriptor
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
    private var definition: NativeDefinitionSql? = null
    private fun reference() = definition ?: NativeDefinitionSql(requireConnection()).also { definition=it }

    private fun requireConnection(): SQLiteConnection =
        connection ?: error("NativeSearchDatabase.open() was not called before use")

    actual fun open() {
        val driver = BundledSQLiteDriver()
        val opened = driver.open(dbFilePath, SQLITE_OPEN_READONLY)
        connection = opened
        // Warm-up query: mirrors the web app's "core opened, first query possible" readiness
        // signal rather than just "file handle acquired".
        opened.prepare("SELECT count(*) FROM chunks_fts LIMIT 1").use { it.step() }
    }

    actual fun close() {
        connection?.close()
        connection = null
        definition = null
    }

    actual fun lookupIdentities(query: String): List<NativeCoreIdentityHit> {
        val db=requireConnection()
        db.prepare("SELECT 1 FROM sqlite_master WHERE name='core_identities'").use { if(!it.step()) return emptyList() }
        return db.prepare("""SELECT n.name,t.title,t.kind,t.coverage,t.target_json
            FROM core_identities n JOIN core_identity_targets t ON t.target_id=n.target_id AND t.module_id=n.module_id
            WHERE n.normalized_name=? ORDER BY t.title,t.module_id,t.target_id""").use { row ->
            row.bindText(1,normalizeNativeIdentityName(query))
            buildList {
                while(row.step()) add(validateIdentityHit(NativeCoreIdentityHit(row.getText(0),row.getText(1),row.getText(2),row.getText(3),contentJson.decodeFromString<NativeCoreIdentityTarget>(row.getText(4)))))
            }
        }
    }
    actual fun definitionSearch(editionId: String,query: String,requested: Int): List<NativeDefinitionCard> = reference().search(editionId,query,requested)
    actual fun definitionStatus(): NativeDefinitionStatus? = reference().status()
    actual fun definitionCard(editionId: String,entityId: String): NativeDefinitionCard? = reference().card(editionId,entityId)
    actual fun definitionBlocks(editionId: String,entityId: String,after: String): NativeDefinitionBlockPage = reference().blocks(editionId,entityId,after)
    actual fun definitionText(editionId: String,entityId: String,chunkId: String,offset: Int): NativeDefinitionTextPage? = reference().text(editionId,entityId,chunkId,offset)
    actual fun definitionSource(editionId: String,sourceId: String): NativeDefinitionSource? = reference().source(editionId,sourceId)

    actual fun validateContent(schemaVersion: Int, targets: List<NativeDocumentTarget>) {
        val db = requireConnection()
        db.prepare("PRAGMA integrity_check").use { check(it.step() && it.getText(0) == "ok") { "Invalid SQLite integrity" } }
        db.prepare("PRAGMA foreign_key_check").use { check(!it.step()) { "Invalid SQLite foreign keys" } }
        db.prepare("SELECT schema_version FROM content_packs").use { statement ->
            check(statement.step() && statement.getLong(0).toInt() == schemaVersion) { "Incompatible pack schema" }
        }
        db.prepare("SELECT source_checksum FROM document_versions WHERE document_id=? AND id=?").use { statement ->
            targets.forEach { target ->
                statement.bindText(1,target.documentId);statement.bindText(2,target.documentVersionId)
                check(statement.step() && statement.getText(0).let { if (it.startsWith("sha256:")) it else "sha256:$it" } == target.sourceChecksum) { "Pack source membership mismatch" }
                statement.reset();statement.clearBindings()
                if (target.anchor != null) db.prepare("SELECT anchor FROM chunks WHERE document_version_id=? AND anchor=? UNION ALL SELECT anchor FROM sections WHERE document_version_id=? AND anchor=? LIMIT 1").use { anchor ->
                    anchor.bindText(1,target.documentVersionId);anchor.bindText(2,target.anchor);anchor.bindText(3,target.documentVersionId);anchor.bindText(4,target.anchor)
                    check(anchor.step()) { "Missing source anchor" }
                }
            }
        }
    }

    actual fun readSourceDocument(documentId: String, versionId: String?): NativeSourceDocument? {
        val sql = """SELECT d.title,d.source_type,d.metadata_json,v.id,v.source_checksum,v.version_label,v.effective_from,v.effective_to,d.status
            FROM documents d JOIN document_versions v ON v.document_id=d.id
            WHERE d.id=? AND v.id=COALESCE(?,d.current_version_id)"""
        val header = requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, documentId)
            if (versionId == null) statement.bindNull(2) else statement.bindText(2, versionId)
            if (!statement.step()) return null
            NativeSourceDocument(
                NativeDocumentTarget(documentId, statement.getText(3), statement.getText(4).let { if (it.startsWith("sha256:")) it else "sha256:$it" }),
                statement.getText(0), statement.getText(1), statement.getText(2), statement.getText(5),
                if (statement.isNull(6)) null else statement.getText(6), if (statement.isNull(7)) null else statement.getText(7), emptyList(),statement.getText(8),
            )
        }
        val sections = requireConnection().prepare("SELECT id,title,anchor,depth,order_index,parent_section_id,section_type,path_json,page_start,page_end FROM sections WHERE document_version_id=? ORDER BY order_index,id").use { statement ->
            statement.bindText(1, header.target.documentVersionId)
            buildList {
                while (statement.step()) {
                    val id = statement.getText(0)
                    val chunks = requireConnection().prepare("SELECT id,anchor,original_text,order_index,metadata_json,page_start,page_end,char_start,char_end FROM chunks WHERE section_id=? AND document_version_id=? ORDER BY order_index,id").use { chunk ->
                        chunk.bindText(1, id); chunk.bindText(2, header.target.documentVersionId)
                        buildList {
                            while (chunk.step()) add(NativeSourceChunk(chunk.getText(0),chunk.getText(1),chunk.getText(2),chunk.getLong(3).toInt(),chunk.getText(4),
                                if (chunk.isNull(5)) null else chunk.getLong(5).toInt(),if (chunk.isNull(6)) null else chunk.getLong(6).toInt(),
                                if (chunk.isNull(7)) null else chunk.getLong(7).toInt(),if (chunk.isNull(8)) null else chunk.getLong(8).toInt()))
                        }
                    }
                    add(NativeSourceSection(id,statement.getText(1),statement.getText(2),statement.getLong(3).toInt(),statement.getLong(4).toInt(),chunks,if(statement.isNull(5)) null else statement.getText(5),if(statement.isNull(6)) null else statement.getText(6),statement.getText(7),if(statement.isNull(8)) null else statement.getLong(8).toInt(),if(statement.isNull(9)) null else statement.getLong(9).toInt()))
                }
            }
        }
        return header.copy(sections = sections)
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
        // Pooled: `canonicalTerm` (many aliases share one canonical concept) and `category` (a
        // handful of distinct values) — see `String.pooled`'s doc above.
        val canonicalPool = HashMap<String, String>()
        val categoryPool = HashMap<String, String>()
        return requireConnection().prepare(sql).use { statement ->
            val results = mutableListOf<AliasRecord>()
            while (statement.step()) {
                results.add(
                    AliasRecord(
                        id = statement.getText(0),
                        canonicalTerm = statement.getText(1).pooled(canonicalPool),
                        alias = statement.getText(2),
                        category = if (statement.isNull(3)) null else statement.getText(3).pooled(categoryPool),
                        weight = statement.getDouble(4),
                    ),
                )
            }
            results
        }
    }

    actual fun contentPackIds(): List<String> = requireConnection().prepare("SELECT id FROM content_packs").use { s -> buildList { while(s.step()) add(s.getText(0)) } }
    actual fun documentVersionIdentities(): List<SearchVersionIdentity> = requireConnection().prepare("SELECT document_id,id,source_checksum FROM document_versions").use { s ->
        buildList { while(s.step()) add(SearchVersionIdentity(s.getText(0),s.getText(1),s.getText(2).let { if(it.startsWith("sha256:")) it else "sha256:$it" })) }
    }

    private fun filterClauses(filters: NativeSearchFilters): Pair<String,List<String>> {
        val clauses=mutableListOf<String>();val bind=mutableListOf<String>()
        fun add(values: List<String>,clause: String) { if(values.isNotEmpty()) { clauses+=clause;bind+=contentJson.encodeToString(values) } }
        add(filters.documentIds,"d.id IN (SELECT value FROM json_each(?))")
        add(filters.sectionTypes,"s.section_type IN (SELECT value FROM json_each(?))")
        add(filters.specialties,"EXISTS (SELECT 1 FROM json_each(d.specialty_json) x WHERE x.value IN (SELECT value FROM json_each(?)))")
        add(filters.ageGroups,"EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(d.metadata_json, '$.ageGroups'), '[]')) x WHERE x.value IN (SELECT value FROM json_each(?)))")
        return clauses.joinToString("") { " AND $it" } to bind
    }

    actual fun searchBranch(ftsQuery: String, limit: Int, documentIds: List<String>, diversifyDocuments: Boolean, filters: NativeSearchFilters): List<BranchHit> {
        val candidateLimit = minOf(500, limit)
        val allowed=filters.documentIds.toSet()
        val selected=if(documentIds.isEmpty()) filters else filters.copy(documentIds=if(allowed.isEmpty()) documentIds else documentIds.filter { it in allowed }.ifEmpty { listOf("__minimed_empty_search_scope__") })
        val (documentFilter,bind)=filterClauses(selected)
        val joins=buildString {
            if(selected.documentIds.isNotEmpty() || selected.specialties.isNotEmpty() || selected.ageGroups.isNotEmpty()) append("JOIN documents d ON d.id=chunks_fts.document_id ")
            if(selected.sectionTypes.isNotEmpty()) append("JOIN chunks c ON c.id=chunks_fts.chunk_id JOIN sections s ON s.id=c.section_id ")
        }
        val sql = """
            SELECT chunk_id, bm25_rank
            FROM (
                SELECT window_fts.chunk_id AS chunk_id, ranked.bm25_rank AS bm25_rank,
                    row_number() OVER (
                        PARTITION BY window_fts.document_version_id ORDER BY ranked.bm25_rank
                    ) AS document_order
                FROM (
                    SELECT chunks_fts.rowid AS fts_rowid,
                        bm25(chunks_fts, 0, 0, 0, 0, 0, 8.0, 4.0, 1.0) AS bm25_rank
                    FROM chunks_fts
                    $joins
                    WHERE chunks_fts MATCH ?$documentFilter
                    ORDER BY bm25_rank
                    LIMIT ?
                ) ranked
                JOIN chunks_fts window_fts ON window_fts.rowid = ranked.fts_rowid
            )
            WHERE document_order <= ?
            ORDER BY bm25_rank
            LIMIT ?
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, ftsQuery)
            bind.forEachIndexed { index, value -> statement.bindText(index + 2,value) }
            val bound = bind.size + 2
            statement.bindLong(bound, (candidateLimit * 4).toLong())
            statement.bindLong(bound + 1, if (diversifyDocuments) 3 else candidateLimit.toLong())
            statement.bindLong(bound + 2, candidateLimit.toLong())
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
            SELECT d.title AS document_title, s.title AS section_title, c.original_text AS original_text, c.id AS chunk_id
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
                        chunkId = statement.getText(3),
                    ),
                )
            }
            results
        }
    }

    actual fun hydrateHits(chunkIds: List<String>): List<HydratedHit> {
        if (chunkIds.isEmpty()) return emptyList()
        val placeholders = chunkIds.joinToString(",") { "?" }
        // char(31) (ASCII unit separator) joins array-valued metadata fields so Kotlin can split
        // them back into a List<String> without a JSON parser — see the expect fun's doc. Safe as a
        // separator: it cannot appear in any of these string values (document titles, alias names,
        // MeSH ids), unlike a comma or pipe.
        val sql = """
            SELECT
                c.id AS chunk_id, c.document_version_id, c.section_id, c.original_text,
                c.anchor AS chunk_anchor,
                s.title AS section_title, s.section_type,
                (SELECT group_concat(value, char(31)) FROM json_each(s.path_json)) AS section_path,
                (SELECT group_concat(value, char(31)) FROM json_each(c.metadata_json, '${'$'}.terminologyConceptIds'))
                    AS terminology_concept_ids,
                d.id AS document_id, d.title AS document_title, d.short_title, d.source_type,
                json_extract(d.metadata_json, '${'$'}.catalogFamily') AS catalog_family,
                json_extract(d.metadata_json, '${'$'}.entityType') AS entity_type,
                json_extract(d.metadata_json, '${'$'}.targetDocumentId') AS target_document_id,
                json_extract(d.metadata_json, '${'$'}.contentMode') AS content_mode,
                json_extract(d.metadata_json, '${'$'}.notLegalAdvice') AS not_legal_advice,
                json_extract(d.metadata_json, '${'$'}.interactiveAssessmentId') AS interactive_assessment_id,
                json_extract(d.metadata_json, '${'$'}.calculationRequired') AS calculation_required,
                json_extract(d.metadata_json, '${'$'}.interactiveCalculatorId') AS interactive_calculator_id,
                json_extract(d.metadata_json, '${'$'}.conceptId') AS concept_id,
                (SELECT group_concat(value, char(31)) FROM json_each(d.metadata_json, '${'$'}.navigationAliases'))
                    AS navigation_aliases,
                (SELECT group_concat(value, char(31)) FROM json_each(d.metadata_json, '${'$'}.ageGroups'))
                    AS age_groups
            FROM chunks c
            JOIN sections s ON s.id = c.section_id
            JOIN document_versions dv ON dv.id = c.document_version_id
            JOIN documents d ON d.id = dv.document_id
            WHERE c.id IN ($placeholders)
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            chunkIds.forEachIndexed { index, id -> statement.bindText(index + 1, id) }
            val results = mutableListOf<HydratedHit>()
            while (statement.step()) {
                results.add(
                    HydratedHit(
                        chunkId = statement.getText(0),
                        documentVersionId = statement.getText(1),
                        sectionId = statement.getText(2),
                        originalText = statement.getText(3),
                        anchor = statement.getText(4),
                        sectionTitle = statement.getText(5),
                        sectionType = statement.textOrNull(6),
                        sectionPath = statement.splitList(7),
                        terminologyConceptIds = statement.splitList(8),
                        documentId = statement.getText(9),
                        documentTitle = statement.getText(10),
                        documentShortTitle = statement.textOrNull(11),
                        sourceType = statement.getText(12),
                        catalogFamily = statement.textOrNull(13),
                        entityType = statement.textOrNull(14),
                        targetDocumentId = statement.textOrNull(15),
                        contentMode = statement.textOrNull(16),
                        notLegalAdvice = statement.boolOrFalse(17),
                        interactiveAssessmentId = statement.textOrNull(18),
                        calculationRequired = statement.boolOrFalse(19),
                        interactiveCalculatorId = statement.textOrNull(20),
                        conceptId = statement.textOrNull(21),
                        navigationAliases = statement.splitList(22),
                        ageGroups = statement.splitList(23),
                        rank = 0.0,
                    ),
                )
            }
            results
        }
    }

    actual fun allDocumentIds(): List<String> {
        return requireConnection().prepare("SELECT id FROM documents").use { statement ->
            val results = mutableListOf<String>()
            while (statement.step()) results.add(statement.getText(0))
            results
        }
    }

    actual fun listSearchDocuments(): List<SearchDocumentSummary> {
        val sql = """
            SELECT d.id, d.title, d.short_title, d.source_type,
                (SELECT group_concat(value, char(31)) FROM json_each(metadata_json, '${'$'}.declaredAliases'))
                    AS declared_aliases,
                (SELECT group_concat(value, char(31)) FROM json_each(metadata_json, '${'$'}.navigationAliases'))
                    AS navigation_aliases,
                json_extract(metadata_json, '$.catalogFamily'),json_extract(metadata_json, '$.entityType'),
                json_extract(metadata_json, '$.targetDocumentId'),json_extract(metadata_json, '$.contentMode'),
                json_extract(metadata_json, '$.notLegalAdvice'),json_extract(metadata_json, '$.interactiveAssessmentId'),
                json_extract(metadata_json, '$.calculationRequired'),json_extract(metadata_json, '$.interactiveCalculatorId'),
                (SELECT group_concat(value,char(31)) FROM json_each(metadata_json,'$.ageGroups')),
                json_extract(metadata_json,'$.terminology') IS NOT NULL AND json_extract(metadata_json,'$.terminology')!=0 AND json_extract(metadata_json,'$.terminology')!=''
            FROM documents d
            ORDER BY d.title COLLATE NOCASE,d.id
        """.trimIndent()
        // Pooled: `sourceType` is one of a handful of distinct values across ~20k documents — see
        // `String.pooled`'s doc above.
        val sourceTypePool = HashMap<String, String>()
        return requireConnection().prepare(sql).use { statement ->
            val results = ArrayList<SearchDocumentSummary>(20_000)
            while (statement.step()) {
                results.add(
                    SearchDocumentSummary(
                        id = statement.getText(0),
                        title = statement.getText(1),
                        shortTitle = statement.textOrNull(2),
                        sourceType = statement.getText(3).pooled(sourceTypePool),
                        declaredAliases = statement.splitList(4),
                        navigationAliases = statement.splitList(5),
                        descriptor = DocumentDescriptor(statement.getText(0),statement.getText(3),statement.getText(1),
                            statement.textOrNull(6),statement.textOrNull(7),statement.textOrNull(8),statement.textOrNull(9),
                            statement.boolOrFalse(10),statement.textOrNull(11),statement.boolOrFalse(12),statement.textOrNull(13),statement.splitList(5),statement.splitList(14)),
                        terminology = statement.boolOrFalse(15),
                    ),
                )
            }
            results
        }
    }

    actual fun firstReadableChunk(documentId: String,filters: NativeSearchFilters): HydratedHit? {
        val (clauses,bind)=filterClauses(filters)
        val sql = """
            SELECT
                c.id AS chunk_id, c.document_version_id, c.section_id, c.original_text,
                c.anchor AS chunk_anchor,
                s.title AS section_title, s.section_type,
                (SELECT group_concat(value, char(31)) FROM json_each(s.path_json)) AS section_path,
                (SELECT group_concat(value, char(31)) FROM json_each(c.metadata_json, '${'$'}.terminologyConceptIds'))
                    AS terminology_concept_ids,
                d.id AS document_id, d.title AS document_title, d.short_title, d.source_type,
                json_extract(d.metadata_json, '${'$'}.catalogFamily') AS catalog_family,
                json_extract(d.metadata_json, '${'$'}.entityType') AS entity_type,
                json_extract(d.metadata_json, '${'$'}.targetDocumentId') AS target_document_id,
                json_extract(d.metadata_json, '${'$'}.contentMode') AS content_mode,
                json_extract(d.metadata_json, '${'$'}.notLegalAdvice') AS not_legal_advice,
                json_extract(d.metadata_json, '${'$'}.interactiveAssessmentId') AS interactive_assessment_id,
                json_extract(d.metadata_json, '${'$'}.calculationRequired') AS calculation_required,
                json_extract(d.metadata_json, '${'$'}.interactiveCalculatorId') AS interactive_calculator_id,
                json_extract(d.metadata_json, '${'$'}.conceptId') AS concept_id,
                (SELECT group_concat(value, char(31)) FROM json_each(d.metadata_json, '${'$'}.navigationAliases'))
                    AS navigation_aliases,
                (SELECT group_concat(value, char(31)) FROM json_each(d.metadata_json, '${'$'}.ageGroups'))
                    AS age_groups
            FROM documents d
            JOIN document_versions dv ON dv.id = d.current_version_id
            JOIN sections s ON s.document_version_id = dv.id
            JOIN chunks c ON c.section_id = s.id
            WHERE d.id = ? AND length(trim(c.original_text)) > 0 $clauses
            ORDER BY s.order_index, c.order_index
            LIMIT 1
        """.trimIndent()
        return requireConnection().prepare(sql).use { statement ->
            statement.bindText(1, documentId)
            bind.forEachIndexed { index,value -> statement.bindText(index+2,value) }
            if (!statement.step()) return@use null
            HydratedHit(
                chunkId = statement.getText(0),
                documentVersionId = statement.getText(1),
                sectionId = statement.getText(2),
                originalText = statement.getText(3),
                anchor = statement.getText(4),
                sectionTitle = statement.getText(5),
                sectionType = statement.textOrNull(6),
                sectionPath = statement.splitList(7),
                terminologyConceptIds = statement.splitList(8),
                documentId = statement.getText(9),
                documentTitle = statement.getText(10),
                documentShortTitle = statement.textOrNull(11),
                sourceType = statement.getText(12),
                catalogFamily = statement.textOrNull(13),
                entityType = statement.textOrNull(14),
                targetDocumentId = statement.textOrNull(15),
                contentMode = statement.textOrNull(16),
                notLegalAdvice = statement.boolOrFalse(17),
                interactiveAssessmentId = statement.textOrNull(18),
                calculationRequired = statement.boolOrFalse(19),
                interactiveCalculatorId = statement.textOrNull(20),
                conceptId = statement.textOrNull(21),
                navigationAliases = statement.splitList(22),
                ageGroups = statement.splitList(23),
                rank = 0.0,
            )
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

/** Null-safe `getText` for an outer-joined or `json_extract`-absent (SQL NULL) column. */
private fun SQLiteStatement.textOrNull(index: Int): String? = if (isNull(index)) null else getText(index)

/**
 * Optimization-pass memory fix (docs/research/native-vs-webview-2026-09-28.md, "Optimization
 * pass" — "compare memory of structures: string interning, primitive arrays instead of boxing"):
 * `androidx.sqlite`'s `getText` allocates a NEW `String` (new backing `CharArray`) for every row,
 * even when the column is low-cardinality (`aliases.category` is one of a handful of values across
 * tens of thousands of rows; `documents.source_type` the same across ~20k documents). Both
 * `listAliases()` and `listSearchDocuments()` retain their whole result list for the process
 * lifetime (`LookupEngine.aliases`/its `QueryDocumentIndex`), so every duplicate string is real,
 * permanent heap. A manual pool — not `kotlin.text.intern()`, which is JVM-only and would silently
 * do nothing on iOS/Kotlin-Native — dedupes by value within one query's result set. Not applied to
 * `hydrateHits`/`firstReadableChunk`: those run per query and their results are transient (GC'd
 * once the query's response is built), so pooling them would cost CPU without reducing any RETAINED
 * memory.
 */
private fun String.pooled(pool: MutableMap<String, String>): String = pool.getOrPut(this) { this }

/** A `char(31)`-joined array column (see `hydrateHits`'s doc) back into a `List<String>`; NULL or
 * empty means "no values", not a one-element list with an empty string. */
private fun SQLiteStatement.splitList(index: Int): List<String> {
    if (isNull(index)) return emptyList()
    val text = getText(index)
    if (text.isEmpty()) return emptyList()
    return text.split('\u001F')
}

/** `json_extract(...)` of a JSON boolean surfaces as SQLite INTEGER 0/1 (NULL when the key is
 * absent, which this treats as "not true" — matches `metadata?.notLegalAdvice === true` etc. in the
 * TS source, where a missing key is also falsy). */
private fun SQLiteStatement.boolOrFalse(index: Int): Boolean = !isNull(index) && getLong(index) != 0L
