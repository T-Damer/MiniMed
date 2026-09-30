package dev.localmed.nativespike.shared.core

import kotlinx.serialization.Serializable

const val NATIVE_DEFINITION_QUERY_MAX_LENGTH = 2_048
const val NATIVE_DEFINITION_RESULTS_MAX = 20

/** Exact catalog edition, independent of any selected source-local entity. */
@Serializable
data class NativeDefinitionEditionTarget(
    val moduleId: String,
    val moduleVersion: String,
    val editionId: String,
) : NativeReaderTarget {
    fun entityTarget(entityId: String) = NativeDefinitionTarget(moduleId,moduleVersion,entityId,editionId)
}

fun NativeDefinitionTarget.editionTarget() = NativeDefinitionEditionTarget(moduleId,moduleVersion,editionId)

internal fun validateDefinitionEdition(target: NativeDefinitionEditionTarget) {
    referenceIdentity(target.moduleId);referenceIdentity(target.editionId)
    require(target.moduleVersion.isNotBlank() && target.moduleVersion.length<=256 && !target.moduleVersion.contains('\u0000')) { "Invalid reference module version" }
}

sealed interface NativeDefinitionEditionResolution {
    data class Installed(val target: NativeDefinitionEditionTarget,val status: NativeDefinitionStatus) : NativeDefinitionEditionResolution
    data class Download(val target: NativeDefinitionEditionTarget,val title: String,val downloadBytes: Long) : NativeDefinitionEditionResolution
    data class Unavailable(val reason: String) : NativeDefinitionEditionResolution
}
