package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.validateTarget
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Exact source-local names; ambiguity is retained, never an inferred clinical same-as. */
@Serializable
data class NativeCoreIdentityHit(
    val name: String,
    val title: String,
    val kind: String,
    val coverage: String,
    val target: NativeCoreIdentityTarget,
)

@Serializable
sealed interface NativeCoreIdentityTarget {
    @Serializable
    @SerialName("document")
    data class Document(
        val moduleId: String,
        val moduleVersion: String,
        val documentId: String,
        val documentVersionId: String,
        val sourceChecksum: String,
        val anchor: String,
    ) : NativeCoreIdentityTarget {
        fun documentTarget() = NativeDocumentTarget(documentId, documentVersionId, sourceChecksum, anchor, moduleId, moduleVersion)
    }

    @Serializable
    @SerialName("definition")
    data class Definition(
        val moduleId: String,
        val moduleVersion: String,
        val entityId: String,
        val editionId: String,
    ) : NativeCoreIdentityTarget, NativeReaderTarget
}

typealias NativeDefinitionTarget = NativeCoreIdentityTarget.Definition

internal fun validateIdentityHit(hit: NativeCoreIdentityHit): NativeCoreIdentityHit = hit.also {
    require(listOf(it.name,it.title,it.kind,it.coverage).all { value -> value.isNotBlank() }) { "Invalid source identity" }
    when (val target=it.target) {
        is NativeCoreIdentityTarget.Document -> validateTarget(target.documentTarget())
        is NativeCoreIdentityTarget.Definition -> validateDefinitionTarget(target)
    }
}
