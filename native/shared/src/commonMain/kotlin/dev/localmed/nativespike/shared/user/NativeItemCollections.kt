package dev.localmed.nativespike.shared.user

import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.validateReaderRoute
import kotlinx.serialization.Required
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

const val NATIVE_COLLECTION_NAME_MAX = 60
internal const val NATIVE_COLLECTION_LIMIT = 100
internal const val NATIVE_COLLECTION_ITEM_LIMIT = 500

@Serializable enum class NativeItemKind {
    @SerialName("tool") Tool,
    @SerialName("document") Document,
    @SerialName("note") Note,
}

/** Stable catalog identity and title snapshot; an unavailable item remains in the user's list. */
@Serializable data class NativeItemRef(
    val kind: NativeItemKind,
    val id: String,
    val addedAt: String = "",
    val title: String? = null,
    val documentKind: String? = null,
    val parentId: String? = null,
    val reader: NativeReaderRoute? = null,
)

@Serializable data class NativeItemCollection(
    val id: String,
    val name: String,
    val createdAt: String,
    @Required val items: List<NativeItemRef> = emptyList(),
)

@Serializable data class NativeItemCollectionsSnapshot(
    @Required val version: Int = 2,
    @Required val favorites: List<NativeItemRef> = emptyList(),
    @Required val collections: List<NativeItemCollection> = emptyList(),
)

private val collectionWhitespace = Regex("[\t\n\u000b\u000c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")
internal fun nativeCollectionName(value: String): String = value.replace(collectionWhitespace, " ").trim(' ')
private fun itemKey(item: NativeItemRef) = item.kind to item.id
internal fun nativeCollectionNameError(state: NativeItemCollectionsSnapshot, name: String, exceptId: String? = null): String? {
    val normalized = nativeCollectionName(name)
    if (normalized.isEmpty()) return "Введите название коллекции."
    if (normalized.length > NATIVE_COLLECTION_NAME_MAX) return "Название длиннее $NATIVE_COLLECTION_NAME_MAX символов."
    if (state.collections.any { it.id != exceptId && it.name.lowercase() == normalized.lowercase() })
        return "Коллекция с таким названием уже есть."
    return null
}

internal fun nativeToggleFavorite(state: NativeItemCollectionsSnapshot, item: NativeItemRef, addedAt: String): NativeItemCollectionsSnapshot =
    state.copy(favorites = if (state.favorites.any { itemKey(it) == itemKey(item) }) state.favorites.filterNot { itemKey(it) == itemKey(item) }
    else (state.favorites + item.copy(addedAt = addedAt)).take(NATIVE_COLLECTION_ITEM_LIMIT))

internal fun nativeCreateCollection(state: NativeItemCollectionsSnapshot, id: String, name: String, createdAt: String, items: List<NativeItemRef> = emptyList()): NativeItemCollectionsSnapshot {
    nativeCollectionNameError(state, name)?.let { throw IllegalArgumentException(it) }
    require(state.collections.size < NATIVE_COLLECTION_LIMIT) { "Можно создать не больше $NATIVE_COLLECTION_LIMIT коллекций." }
    require(state.collections.none { it.id == id }) { "Коллекция с таким идентификатором уже есть." }
    val normalizedItems = items.map { it.copy(addedAt = createdAt, title = it.title?.trim { char -> collectionWhitespace.matches(char.toString()) }?.takeIf(String::isNotEmpty)?.take(300)) }.distinctBy(::itemKey).take(NATIVE_COLLECTION_ITEM_LIMIT)
    return state.copy(collections = state.collections + NativeItemCollection(id, nativeCollectionName(name), createdAt, normalizedItems))
}

internal fun nativeRenameCollection(state: NativeItemCollectionsSnapshot, id: String, name: String): NativeItemCollectionsSnapshot {
    nativeCollectionNameError(state, name, id)?.let { throw IllegalArgumentException(it) }
    return state.copy(collections = state.collections.map { if (it.id == id) it.copy(name = nativeCollectionName(name)) else it })
}

internal fun nativeSetCollectionItem(state: NativeItemCollectionsSnapshot, id: String, item: NativeItemRef, included: Boolean, addedAt: String): NativeItemCollectionsSnapshot =
    state.copy(collections = state.collections.map { collection ->
        if (collection.id != id || collection.items.any { itemKey(it) == itemKey(item) } == included) collection
        else collection.copy(items = if (included) (collection.items + item.copy(addedAt = addedAt)).take(NATIVE_COLLECTION_ITEM_LIMIT)
        else collection.items.filterNot { itemKey(it) == itemKey(item) })
    })

internal fun validateNativeCollections(state: NativeItemCollectionsSnapshot) {
    require(state.version == 2 && state.collections.size <= NATIVE_COLLECTION_LIMIT)
    require(state.collections.map { it.id }.distinct().size == state.collections.size)
    fun identity(value: String) = require(value.isNotBlank() && value.length <= 200 && '\u0000' !in value)
    fun validateItems(items: List<NativeItemRef>) {
        require(items.size <= NATIVE_COLLECTION_ITEM_LIMIT && items.distinctBy(::itemKey).size == items.size)
        items.forEach { item ->
            identity(item.id)
            require(item.addedAt.isNotBlank() && item.addedAt.length <= 128)
            require(item.title == null || item.title.length <= 300)
            item.documentKind?.let(::identity)
            item.parentId?.let(::identity)
            item.reader?.let { route ->
                require(item.kind == NativeItemKind.Document)
                validateReaderRoute(route)
                require(item.id == when (route) {
                    is NativeReaderRoute.Document -> route.target.documentId
                    is NativeReaderRoute.Definition -> route.target.entityId
                })
            }
        }
    }
    validateItems(state.favorites)
    state.collections.forEach {
        identity(it.id)
        require(it.name == nativeCollectionName(it.name) && it.name.length in 1..NATIVE_COLLECTION_NAME_MAX)
        require(it.createdAt.isNotBlank() && it.createdAt.length <= 128)
        validateItems(it.items)
    }
}
