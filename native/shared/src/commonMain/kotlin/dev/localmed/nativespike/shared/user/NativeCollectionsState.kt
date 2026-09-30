package dev.localmed.nativespike.shared.user

import dev.localmed.nativespike.shared.core.NativeContentIO
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class NativeCollectionsFormatException(cause: Throwable) : IllegalArgumentException("Unsupported or damaged private collections format", cause)

/** One private owner, independent of medical downloads. OS write failure cannot publish a change. */
class NativeCollectionsState(private val io: NativeContentIO) {
    private val path = "native-item-collections.json"
    private val mutex = Mutex()
    private val json = Json { encodeDefaults = true }
    private val current = MutableStateFlow<NativeItemCollectionsSnapshot?>(null)
    val snapshot: StateFlow<NativeItemCollectionsSnapshot?> = current.asStateFlow()

    suspend fun load() = mutex.withLock {
        if (current.value != null) return@withLock
        val loaded = if (io.exists(path)) {
            val raw = io.readText(path)
            try {
                require(raw.length <= 64 * 1024 * 1024)
                json.decodeFromString<NativeItemCollectionsSnapshot>(raw).also(::validateNativeCollections)
            } catch (cause: SerializationException) { throw NativeCollectionsFormatException(cause) }
            catch (cause: IllegalArgumentException) { throw NativeCollectionsFormatException(cause) }
        } else NativeItemCollectionsSnapshot()
        current.value = loaded
    }

    suspend fun toggleFavorite(item: NativeItemRef, addedAt: String) = mutate { nativeToggleFavorite(it, item, addedAt) }
    suspend fun createCollection(id: String, name: String, createdAt: String, items: List<NativeItemRef> = emptyList()) =
        mutate { nativeCreateCollection(it, id, name, createdAt, items) }
    suspend fun renameCollection(id: String, name: String) = mutate { nativeRenameCollection(it, id, name) }
    suspend fun deleteCollection(id: String) = mutate { it.copy(collections = it.collections.filterNot { collection -> collection.id == id }) }
    suspend fun setItem(id: String, item: NativeItemRef, included: Boolean, addedAt: String) = mutate { nativeSetCollectionItem(it, id, item, included, addedAt) }
    suspend fun awaitWrites() = mutex.withLock { }

    private suspend fun mutate(change: (NativeItemCollectionsSnapshot) -> NativeItemCollectionsSnapshot) = mutex.withLock {
        val before = requireNotNull(current.value) { "Collections are not loaded" }
        val next = change(before)
        validateNativeCollections(next)
        if (next == before) return@withLock
        io.writeTextAtomic(path, json.encodeToString(next))
        current.value = next
    }
}
