package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.checksumPattern
import dev.localmed.nativespike.shared.content.contentJson
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// One recorded conversion of the shipped private schema, not a product compatibility model.
@Serializable
private data class ReaderV1(val target: NativeDocumentTarget, val chunkId: String?=null, val offsetPx: Int=0)
@Serializable
private data class NavigationV1(val search: NativeSearchSnapshot=NativeSearchSnapshot(), val readers: List<ReaderV1> = emptyList(), val catalog: NativeCatalogSnapshot?=null)
@Serializable
private data class StateV1(val schemaVersion: Int=1, val installed: List<NativeInstalledModule> = emptyList(), val navigation: NavigationV1=NavigationV1())

internal fun validateContentState(state: NativeContentState) {
    require(state.schemaVersion==2) { "Unsupported private state schema" }
    require(state.installed.map { it.moduleId to it.moduleVersion }.distinct().size==state.installed.size) { "Duplicate installed edition" }
    state.installed.forEach { record ->
        require(record.moduleId.isNotBlank() && record.moduleVersion.isNotBlank() && checksumPattern.matches(record.sourceSetDigest)) { "Invalid installed edition" }
        val artifact=record.artifact
        require(checksumPattern.matches(artifact.sha256) && checksumPattern.matches(artifact.decodedSha256) && artifact.sizeBytes>0 && artifact.decodedSizeBytes>0 && artifact.compression in setOf("none","gzip")) { "Invalid installed artifact" }
        require(record.path=="content/${artifact.decodedSha256.removePrefix("sha256:")}.db") { "Invalid installed path" }
    }
    val nav=state.navigation
    require(nav.readers.size<=32 && nav.search.firstVisibleItemIndex>=0 && nav.search.firstVisibleItemOffset>=0 && nav.search.query.length<=NATIVE_SEARCH_QUERY_MAX_LENGTH && !nav.search.query.contains('\u0000')) { "Invalid saved search" }
    nav.readers.forEach(::validateReaderRoute)
    nav.catalog?.let { route ->
        require((route.moduleId==null)==(route.moduleVersion==null) && route.firstVisibleItemIndex>=0 && route.firstVisibleItemOffset>=0 && route.overviewFirstVisibleItemIndex>=0 && route.overviewFirstVisibleItemOffset>=0) { "Invalid saved catalog route" }
        require(route.moduleId==null || (route.moduleId.isNotBlank() && route.moduleVersion!!.isNotBlank())) { "Invalid saved catalog edition" }
        require(listOf(route.filterQuery,route.overviewFilterQuery).all { it.length<=NATIVE_CATALOG_FILTER_MAX_LENGTH && !it.contains('\u0000') }) { "Invalid saved catalog filter" }
    }
}

private inline fun <T> readPrivateState(read: ()->T): T = try { read() } catch(cause: SerializationException) { throw IllegalArgumentException("Malformed private state") }

internal suspend fun loadNativeContentState(io: NativeContentIO, path: String): NativeContentState {
    if(!io.exists(path)) return NativeContentState(schemaVersion=2)
    val original=io.readText(path)
    val root=readPrivateState { contentJson.parseToJsonElement(original) as? JsonObject } ?: throw IllegalArgumentException("Private state is not an object")
    // The schema1 producer omits its default schemaVersion when encodeDefaults=false.
    val version=if(root.containsKey("schemaVersion")) (root["schemaVersion"] as? kotlinx.serialization.json.JsonPrimitive)?.intOrNull ?: error("Invalid private state schema") else 1
    if(version==2) return readPrivateState { contentJson.decodeFromString<NativeContentState>(original) }.also(::validateContentState)
    require(version==1) { "Unsupported private state schema" }
    val old=readPrivateState { contentJson.decodeFromString<StateV1>(original) }
    require(old.schemaVersion==1)
    val next=NativeContentState(2,old.installed,NativeNavigationSnapshot(old.navigation.search,old.navigation.readers.map { NativeReaderRoute.Document(it.target,it.chunkId,it.offsetPx) },old.navigation.catalog))
    validateContentState(next)
    currentCoroutineContext().ensureActive()
    try {
        io.writeTextAtomic(path,contentJson.encodeToString(next))
        currentCoroutineContext().ensureActive()
    } catch(cause: Throwable) {
        withContext(NonCancellable) { io.writeTextAtomic(path,original) }
        throw cause
    }
    return next
}
