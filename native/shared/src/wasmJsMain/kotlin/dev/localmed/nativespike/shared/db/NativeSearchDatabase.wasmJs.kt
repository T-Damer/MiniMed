package dev.localmed.nativespike.shared.db

import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import dev.localmed.nativespike.shared.core.NativeDefinitionBlockPage
import dev.localmed.nativespike.shared.core.NativeDefinitionCard
import dev.localmed.nativespike.shared.core.NativeDefinitionSource
import dev.localmed.nativespike.shared.core.NativeDefinitionStatus
import dev.localmed.nativespike.shared.core.NativeDefinitionTextPage
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeSourceDocument
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

/**
 * STUB, NOT A REAL DATABASE. `androidx.sqlite-bundled` publishes no `wasmJs`/`js` variant
 * (verified against its Gradle Module Metadata: only `androidJvm`, `jvm`, `iosArm64`,
 * `iosSimulatorArm64`, `linuxArm64`, `linuxX64`, `macosArm64`, `tvos*`, `watchos*` — see
 * docs/research/native-vs-webview-2026-09-28.md), and there is no browser-native SQLite either.
 * Building a real one would mean shipping a wa-sqlite/sql.js-style WASM SQLite build with an
 * OPFS-backed VFS — exactly the engine `packages/storage-sqlite` already maintains for the actual
 * web app; duplicating that here was out of scope for this spike.
 *
 * This actual exists only so the *same* `NativeSearchSpikeApp` commonMain UI can be proven to
 * render correctly in a browser via Kotlin/Wasm + Compose Multiplatform. `open()` never touches a
 * file (the constructor path is ignored); every query returns a small fixed in-memory sample so
 * the search/result/reader screens have something to show. `dbFilePath` is intentionally unused —
 * there is nothing to open.
 */
actual class NativeSearchDatabase actual constructor(dbFilePath: String) {
    actual fun lookupIdentities(query: String): List<NativeCoreIdentityHit> = error("Native content storage is unavailable on Wasm")
    actual fun definitionSearch(editionId: String,query: String,requested: Int): List<NativeDefinitionCard> = error("Native content storage is unavailable on Wasm")
    actual fun definitionStatus(): NativeDefinitionStatus? = error("Native content storage is unavailable on Wasm")
    actual fun definitionCard(editionId: String, entityId: String): NativeDefinitionCard? = error("Native content storage is unavailable on Wasm")
    actual fun definitionBlocks(editionId: String, entityId: String, after: String): NativeDefinitionBlockPage = error("Native content storage is unavailable on Wasm")
    actual fun definitionText(editionId: String, entityId: String, chunkId: String, offset: Int): NativeDefinitionTextPage? = error("Native content storage is unavailable on Wasm")
    actual fun definitionSource(editionId: String, sourceId: String): NativeDefinitionSource? = error("Native content storage is unavailable on Wasm")

    actual fun open() {
        // Nothing to open — see the class-level warning above.
    }

    actual fun readSourceDocument(documentId: String, versionId: String?): NativeSourceDocument? = error("Native content storage is unavailable on Wasm")

    actual fun validateContent(schemaVersion: Int, targets: List<NativeDocumentTarget>): Unit = error("Native content storage is unavailable on Wasm")

    actual fun close() {
        // Nothing to close.
    }

    actual fun searchChunks(matchExpression: String, limit: Int): List<ChunkHit> =
        SAMPLE_HITS.filter { hit ->
            SAMPLE_QUERY_TOKENS.any { hit.snippet.contains(it, ignoreCase = true) }
        }.take(limit)

    actual fun measureSqlOnlyMs(matchExpression: String, limit: Int): Double = 0.0

    actual fun canonicalTermsForAliases(tokens: List<String>): List<String> = emptyList()

    actual fun listAliases(): List<AliasRecord> = emptyList()
    actual fun contentPackIds(): List<String> = emptyList()
    actual fun documentVersionIdentities(): List<SearchVersionIdentity> = emptyList()

    actual fun searchBranch(ftsQuery: String, limit: Int, documentIds: List<String>, diversifyDocuments: Boolean, filters: NativeSearchFilters): List<BranchHit> = emptyList()

    actual fun textsForChunks(chunkIds: List<String>): List<ExactSubjectHitText> = emptyList()

    actual fun hydrateHits(chunkIds: List<String>): List<HydratedHit> = emptyList()

    actual fun allDocumentIds(): List<String> = emptyList()

    actual fun listSearchDocuments(): List<SearchDocumentSummary> = emptyList()

    actual fun firstReadableChunk(documentId: String, filters: NativeSearchFilters): HydratedHit? = null

    actual fun sectionsForDocument(documentId: String): List<SectionRow> = SAMPLE_SECTIONS

    actual fun chunksForSection(sectionId: String): List<ReaderChunk> =
        SAMPLE_CHUNKS.filter { it.id.startsWith(sectionId) }

    private companion object {
        val SAMPLE_QUERY_TOKENS = listOf("демо", "demo", "образец", "sample", "")

        val SAMPLE_HITS = listOf(
            ChunkHit(
                chunkId = "demo.chunk.1",
                documentId = "demo.document.1",
                documentTitle = "Демонстрационный документ (веб-заглушка, не core.db)",
                documentKind = DocumentKind.REFERENCE,
                sectionId = "demo.section.1",
                sectionPath = "Пример раздела",
                anchor = "demo.document.1#demo.section.1",
                snippet = "Это [образец] данных — веб-таргет (Kotlin/Wasm) не подключён к настоящему core.db, см. ADR-0021.",
                bm25Score = 0.0,
            ),
        )

        val SAMPLE_SECTIONS = listOf(
            SectionRow(id = "demo.section.1", title = "Пример раздела", depth = 1, orderIndex = 0, anchor = "demo.document.1#demo.section.1"),
        )

        val SAMPLE_CHUNKS = listOf(
            ReaderChunk(
                id = "demo.section.1.chunk.1",
                orderIndex = 0,
                text = "Веб-сборка (wasmJs) отображает тот же общий UI, что Android/desktop/iOS, но без настоящей FTS5 базы — данные здесь фиксированы для демонстрации рендеринга.",
                anchor = "demo.document.1#demo.section.1",
            ),
        )
    }
}
