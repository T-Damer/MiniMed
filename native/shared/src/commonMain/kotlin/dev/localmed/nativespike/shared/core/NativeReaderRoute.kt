package dev.localmed.nativespike.shared.core

import dev.localmed.nativespike.shared.content.validateTarget
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

sealed interface NativeReaderTarget

@Serializable
sealed interface NativeReaderRoute {
    val target: NativeReaderTarget

    @Serializable
    @SerialName("document")
    data class Document(
        override val target: NativeDocumentTarget,
        val chunkId: String? = null,
        val offsetPx: Int = 0,
    ) : NativeReaderRoute

    @Serializable
    @SerialName("definition")
    data class Definition(
        override val target: NativeDefinitionTarget,
        val blockLinkId: String? = null,
        val textOffsetCodepoints: Int = 0,
        val firstVisibleItemIndex: Int = 0,
        val firstVisibleItemOffset: Int = 0,
    ) : NativeReaderRoute
}

sealed interface NativeReaderResolution {
    data class Document(val resolution: NativeDocumentResolution) : NativeReaderResolution
    data class Definition(val resolution: NativeDefinitionResolution) : NativeReaderResolution
}

internal fun validateReaderRoute(route: NativeReaderRoute) {
    when(route) {
        is NativeReaderRoute.Document -> {
            validateTarget(route.target)
            require(route.offsetPx>=0 && (route.chunkId==null || route.chunkId.isNotBlank())) { "Invalid saved source position" }
        }
        is NativeReaderRoute.Definition -> {
            validateDefinitionTarget(route.target)
            require(route.textOffsetCodepoints in 0..262144 && route.firstVisibleItemIndex>=0 && route.firstVisibleItemOffset>=0) { "Invalid saved reference position" }
            require(route.blockLinkId==null || (route.blockLinkId.length<=300 && route.blockLinkId.startsWith(route.target.entityId+".reference.") && Regex("\\.reference\\.\\d{6}$").containsMatchIn(route.blockLinkId))) { "Invalid saved reference block" }
        }
    }
}
