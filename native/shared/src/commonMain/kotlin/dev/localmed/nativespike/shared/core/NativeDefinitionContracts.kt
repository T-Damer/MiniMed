package dev.localmed.nativespike.shared.core

import kotlinx.serialization.Serializable

@Serializable
data class NativeDefinitionCard(
    val id: String,
    val title: String,
    val kind: String,
    val coverage: String,
    val textKind: String,
    val blockCount: Int,
    val reviewStatus: String = "requires-review",
    val identityStatus: String = "source-local-proposed",
    val match: String = "name",
)

@Serializable
data class NativeDefinitionBlock(
    val linkId: String,
    val chunkId: String,
    val sourceId: String,
    val role: String,
    val characters: Int,
)

@Serializable
data class NativeDefinitionBlockPage(val blocks: List<NativeDefinitionBlock>, val next: String?)

data class NativeDefinitionStatus(
    val editionId: String,
    val entries: Int,
    val publicationState: String,
    val reviewStatus: String,
    val identityStatus: String,
    val annotationsSupported: Boolean = false,
)

/** Known original fields plus the exact stored metadata; no source claims are discarded. */
data class NativeDefinitionProvenance(
    val rawMetadata: String,
    val path: String?,
    val locator: String?,
    val textSha256: String?,
    val originalSourceSha256: String?,
    val databaseSha256: String?,
    val inputSha256: String?,
    val documentId: String?,
    val documentVersionId: String?,
    val sectionId: String?,
    val chunkId: String?,
    val anchor: String?,
    val charStart: Int?,
    val charEnd: Int?,
    val pageStart: Int?,
    val pageEnd: Int?,
    val sourceFile: String? = null,
    val sectionTitle: String? = null,
    val parentEntryId: String? = null,
    val parentTitle: String? = null,
    val offsetStart: Int? = null,
    val offsetEnd: Int? = null,
)

data class NativeDefinitionTextPage(
    val text: String,
    val nextOffset: Int?,
    val totalCharacters: Int,
    val sourceId: String,
    val provenance: NativeDefinitionProvenance,
    val previousOffset: Int? = null,
)

data class NativeDefinitionSource(
    val id: String,
    val title: String,
    val sourceType: String?,
    val sourceUrl: String?,
    val baseUrl: String?,
    val rightsStatus: String?,
    val releaseEligible: Boolean,
    val reviewStatus: String,
    val sourceSha256: String?,
    val fileName: String?,
    val rawMetadata: String,
)

sealed interface NativeDefinitionResolution {
    data class Readable(val target: NativeDefinitionTarget, val card: NativeDefinitionCard) : NativeDefinitionResolution
    data class Download(val target: NativeDefinitionTarget, val title: String, val downloadBytes: Long) : NativeDefinitionResolution
    data class Unavailable(val reason: String) : NativeDefinitionResolution
}
