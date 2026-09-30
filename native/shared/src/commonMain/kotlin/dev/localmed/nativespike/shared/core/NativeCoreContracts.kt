package dev.localmed.nativespike.shared.core

import kotlinx.serialization.Serializable

const val NATIVE_SEARCH_QUERY_MAX_LENGTH = 20_000
const val NATIVE_CATALOG_FILTER_MAX_LENGTH = 2_048

@Serializable
data class NativeDocumentTarget(
    val documentId: String,
    val documentVersionId: String,
    val sourceChecksum: String,
    val anchor: String? = null,
    val moduleId: String? = null,
    val moduleVersion: String? = null,
) : NativeReaderTarget

@Serializable
data class NativeSearchSnapshot(
    val query: String = "",
    val firstVisibleItemIndex: Int = 0,
    val firstVisibleItemOffset: Int = 0,
)

@Serializable
data class NativeCatalogSnapshot(
    val moduleId: String? = null,
    val moduleVersion: String? = null,
    val firstVisibleItemIndex: Int = 0,
    val firstVisibleItemOffset: Int = 0,
    val filterQuery: String = "",
    val overviewFilterQuery: String = "",
    val overviewFirstVisibleItemIndex: Int = 0,
    val overviewFirstVisibleItemOffset: Int = 0,
)

/** Catalog membership is an inventory; readability is verified separately when opening. */
data class NativeModuleOffer(
    val id: String,
    val version: String,
    val title: String,
    val kind: String,
    val releaseState: String,
    val documentCount: Int,
    val documentVersionCount: Int,
    val downloadBytes: Long?,
    val unsupportedReason: String?,
    val definitionEntryCount: Int? = null,
)

data class NativeCatalogDocument(
    val target: NativeDocumentTarget,
    val title: String?,
    val status: String,
)

@Serializable
data class NativeNavigationSnapshot(
    val search: NativeSearchSnapshot = NativeSearchSnapshot(),
    val readers: List<NativeReaderRoute> = emptyList(),
    val catalog: NativeCatalogSnapshot? = null,
)

data class NativeSourceChunk(
    val id: String,
    val anchor: String,
    val originalText: String,
    val orderIndex: Int,
    val metadataJson: String,
    val pageStart: Int?,
    val pageEnd: Int?,
    val charStart: Int?,
    val charEnd: Int?,
)

data class NativeSourceSection(
    val id: String,
    val title: String,
    val anchor: String,
    val depth: Int,
    val orderIndex: Int,
    val chunks: List<NativeSourceChunk>,
    val parentSectionId: String? = null,
    val sectionType: String? = null,
    val pathJson: String = "[]",
    val pageStart: Int? = null,
    val pageEnd: Int? = null,
)

data class NativeSourceDocument(
    val target: NativeDocumentTarget,
    val title: String,
    val sourceType: String,
    val metadataJson: String,
    val versionLabel: String,
    val effectiveFrom: String?,
    val effectiveTo: String?,
    val sections: List<NativeSourceSection>,
    val status: String = "active",
)

sealed interface NativeDocumentResolution {
    data class Readable(val document: NativeSourceDocument) : NativeDocumentResolution
    data class Download(val target: NativeDocumentTarget, val title: String, val downloadBytes: Long) : NativeDocumentResolution
    data class Unavailable(val reason: String) : NativeDocumentResolution
}

data class NativeInstallFailure(val target: NativeReaderTarget, val message: String)

data class NativeInstallProgress(val stage: String, val receivedBytes: Long = 0, val totalBytes: Long? = null)

class NativeContentVerificationException(message: String) : IllegalArgumentException(message)

/** Platform file/network primitives; all paths are relative to an app-private root. */
interface NativeContentIO {
    fun exists(path: String): Boolean
    suspend fun readText(path: String): String
    suspend fun writeTextAtomic(path: String, text: String)
    fun databasePath(path: String): String
    /** Throws NativeContentVerificationException only for size/SHA mismatch; OS errors propagate. */
    suspend fun verify(path: String, sha256: String, sizeBytes: Long)
    suspend fun download(url: String, path: String, maximumBytes: Long, progress: (Long) -> Unit)
    suspend fun decodeGzip(source: String, target: String, maximumBytes: Long)
    suspend fun moveAtomic(source: String, target: String)
    suspend fun delete(path: String)
}
