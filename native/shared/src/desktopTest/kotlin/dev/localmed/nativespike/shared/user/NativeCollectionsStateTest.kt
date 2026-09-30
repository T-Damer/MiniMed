package dev.localmed.nativespike.shared.user

import dev.localmed.nativespike.shared.content.JVMContentIO
import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable private data class CollectionOperation(
    val kind: String,
    val id: String? = null,
    val name: String? = null,
    val item: NativeItemRef? = null,
    val items: List<NativeItemRef> = emptyList(),
    val included: Boolean? = null,
    val at: String? = null,
)
@Serializable private data class CollectionCase(
    val name: String,
    val before: NativeItemCollectionsSnapshot,
    val operation: CollectionOperation,
    val after: NativeItemCollectionsSnapshot,
    val error: String?,
)
@Serializable private data class CollectionOracle(
    val schemaVersion: Int,
    val source: String,
    val sourceSha256: String,
    val cases: List<CollectionCase>,
)

class NativeCollectionsStateTest {
    private val at = "2026-09-30T10:00:00.000Z"
    private val tool = NativeItemRef(NativeItemKind.Tool, "calc.bmi")
    private val document = NativeItemRef(
        NativeItemKind.Document, "doc.stable", title = "Название источника", documentKind = "clinical-recommendation",
        reader = NativeReaderRoute.Document(
            NativeDocumentTarget("doc.stable", "doc.stable.v1", "sha256:" + "1".repeat(64), "section#chunk", "module.stable", "2026.9"),
            "chunk.stable", 91,
        ),
    )
    private fun profile(): File {
        val repository = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR"))).parentFile.parentFile.parentFile.parentFile.parentFile
        return File(repository, "playwright").resolve("native-collections-${System.nanoTime()}").apply { mkdirs() }
    }

    @Test fun allExistingWebOperationsMatchActualOracleIncludingNamesMetadataErrorsAndCapacity() {
        val resource = File(requireNotNull(System.getProperty("TEST_RESOURCE_DIR")), "native-collections-golden.json")
        val oracle = Json.decodeFromString<CollectionOracle>(resource.readText())
        assertEquals(1, oracle.schemaVersion)
        val repository = resource.parentFile.parentFile.parentFile.parentFile.parentFile.parentFile
        val sourceHash = MessageDigest.getInstance("SHA-256").digest(File(repository, oracle.source).readBytes()).joinToString("") { "%02x".format(it) }
        assertEquals(oracle.sourceSha256, sourceHash, "Authoritative Web source changed; recapture its oracle")
        assertEquals(34, oracle.cases.size)
        assertEquals(8, oracle.cases.count { it.error != null })
        for (case in oracle.cases) {
            validateNativeCollections(case.before)
            var actual = case.before
            val error = try {
                val op = case.operation
                actual = when (op.kind) {
                    "toggle" -> nativeToggleFavorite(actual, requireNotNull(op.item), requireNotNull(op.at))
                    "create" -> nativeCreateCollection(actual, requireNotNull(op.id), requireNotNull(op.name), requireNotNull(op.at), op.items)
                    "rename" -> nativeRenameCollection(actual, requireNotNull(op.id), requireNotNull(op.name))
                    "delete" -> actual.copy(collections = actual.collections.filterNot { it.id == op.id })
                    "set" -> nativeSetCollectionItem(actual, requireNotNull(op.id), requireNotNull(op.item), requireNotNull(op.included), requireNotNull(op.at))
                    else -> error("Unknown oracle operation")
                }
                null
            } catch (cause: IllegalArgumentException) { cause.message }
            assertEquals(case.error, error, case.name)
            assertEquals(case.after, actual, case.name)
            validateNativeCollections(actual)
        }
    }

    @Test fun privateRestartPreservesStableIdentitiesExactEditionPositionAndMultipleMemberships() = runBlocking {
        val profile = profile()
        try {
            val io = JVMContentIO(profile.absolutePath)
            val state = NativeCollectionsState(io).also { it.load() }
            state.toggleFavorite(document, at)
            state.toggleFavorite(tool, at)
            state.createCollection("one", "Мои источники", at, listOf(document, tool))
            state.createCollection("two", "Вторая", at, listOf(document))
            state.setItem("one", document, false, at)
            state.renameCollection("two", "  Точная\tредакция  ")
            state.awaitWrites()
            val saved = requireNotNull(state.snapshot.value)
            val restored = NativeCollectionsState(io).also { it.load() }
            assertEquals(saved, restored.snapshot.value)
            assertEquals(document.reader, saved.favorites.first().reader)
            assertEquals(document.title, saved.favorites.first().title)
            assertEquals(listOf(tool.copy(addedAt = at)), saved.collections.first().items)
            assertEquals(document.copy(addedAt = at), saved.collections.last().items.single())
            restored.deleteCollection("two")
            assertEquals(saved.favorites, restored.snapshot.value?.favorites)
            assertEquals(1, restored.snapshot.value?.collections?.size)
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun failedAtomicWritePublishesNothingAndRetryRetainsOtherLists() = runBlocking {
        val profile = profile()
        try {
            val real = JVMContentIO(profile.absolutePath)
            var fail = false
            val io = object : NativeContentIO by real {
                override suspend fun writeTextAtomic(path: String, text: String) {
                    if (fail) error("Simulated OS write failure")
                    real.writeTextAtomic(path, text)
                }
            }
            val state = NativeCollectionsState(io).also { it.load() }
            state.toggleFavorite(document, at)
            state.createCollection("one", "Первая", at, listOf(tool))
            val saved = state.snapshot.value
            val file = File(profile, "native-item-collections.json")
            val raw = file.readText()
            fail = true
            assertFailsWith<IllegalStateException> { state.toggleFavorite(tool, at) }
            assertFailsWith<IllegalStateException> { state.deleteCollection("one") }
            assertFailsWith<IllegalStateException> { state.renameCollection("one", "Новое имя") }
            assertEquals(saved, state.snapshot.value)
            assertEquals(raw, file.readText())
            fail = false
            state.toggleFavorite(tool, at)
            assertEquals(saved?.collections, state.snapshot.value?.collections)
            assertEquals(state.snapshot.value, NativeCollectionsState(io).also { it.load() }.snapshot.value)
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun overlappingActionsMergeLatestPrivateStateAndDoNotLoseFavoritesOrMembership() = runBlocking {
        val profile = profile()
        try {
            val real = JVMContentIO(profile.absolutePath)
            val firstWrite = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            var writes = 0
            val io = object : NativeContentIO by real {
                override suspend fun writeTextAtomic(path: String, text: String) {
                    if (++writes == 1) { firstWrite.complete(Unit); release.await() }
                    real.writeTextAtomic(path, text)
                }
            }
            val state = NativeCollectionsState(io).also { it.load() }
            val favoriteAction = launch { state.toggleFavorite(document, at) }
            firstWrite.await()
            val collectionAction = launch { state.createCollection("one", "Первая", at, listOf(tool)) }
            yield()
            release.complete(Unit)
            favoriteAction.join(); collectionAction.join()
            val saved = requireNotNull(state.snapshot.value)
            assertEquals(document.copy(addedAt = at), saved.favorites.single())
            assertEquals(tool.copy(addedAt = at), saved.collections.single().items.single())
            assertEquals(saved, NativeCollectionsState(io).also { it.load() }.snapshot.value)
        } finally { check(profile.deleteRecursively()) }
    }

    @Test fun damagedFutureDuplicateAndMismatchedReaderStateIsPreservedAndRejected() = runBlocking {
        val profile = profile()
        try {
            val io = JVMContentIO(profile.absolutePath)
            val file = File(profile, "native-item-collections.json")
            val validItem = document.copy(addedAt = at)
            val json = Json { encodeDefaults = true }
            val valid = NativeItemCollectionsSnapshot(favorites = listOf(validItem))
            val raw = json.encodeToString(valid)
            for (invalid in listOf(
                "not-json", "{}", "{\"version\":99,\"favorites\":[],\"collections\":[]}",
                raw.dropLast(1) + ",\"unknown\":true}",
                json.encodeToString(valid.copy(favorites = listOf(validItem, validItem))),
                json.encodeToString(valid.copy(favorites = listOf(validItem.copy(id = "wrong.document")))),
                json.encodeToString(valid.copy(favorites = listOf(validItem.copy(kind = NativeItemKind.Tool)))),
                json.encodeToString(valid.copy(favorites = listOf(validItem.copy(reader = (document.reader as NativeReaderRoute.Document).copy(offsetPx = -1))))),
            )) {
                file.writeText(invalid)
                val state = NativeCollectionsState(io)
                val failure = assertFailsWith<NativeCollectionsFormatException> { state.load() }
                assertNotNull(failure.cause)
                assertNull(state.snapshot.value)
                assertEquals(invalid, file.readText())
            }
            file.writeText(raw)
            assertEquals(valid, NativeCollectionsState(io).also { it.load() }.snapshot.value)
            assertTrue(profile.listFiles().orEmpty().none { it.name.endsWith(".tmp") })
        } finally { check(profile.deleteRecursively()) }
    }
}
