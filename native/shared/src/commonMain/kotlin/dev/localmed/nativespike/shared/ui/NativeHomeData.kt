@file:OptIn(org.jetbrains.compose.resources.ExperimentalResourceApi::class)
package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.tools.NativeToolCore
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import minimed_native_spike.shared.generated.resources.Res

@Serializable
internal data class NativeHomeProvenance(val path: String, val sha256: String, val lineStart: Int, val lineEnd: Int)
@Serializable
internal data class NativeHomeSection(
    val id: String, val label: String, val icon: String, val countNoun: List<String>,
    val navigationDocumentCount: Int?, val countEntity: String, val countProvider: String, val membershipSha256: String?,
)
@Serializable
internal data class NativeHomeAction(
    val label: String, val icon: String?, val webHref: String?, val webAction: String?,
    val webAvailabilityCondition: String?, val metadataOnly: Boolean,
)
@Serializable
internal data class NativeHomeFeature(
    val id: String, val icon: String, val kicker: String, val title: String, val text: String,
    val actions: List<NativeHomeAction>, val webVisibility: String, val nativeAvailability: String,
    val provenance: List<NativeHomeProvenance>,
)
@Serializable
internal data class NativeHomeCarousel(val label: String, val itemLabel: String, val autoplayMs: Long, val initialIndexRule: String)
@Serializable
internal data class NativeHomeData(
    val schemaVersion: Int, val coreSha256: String, val sections: List<NativeHomeSection>,
    val examplesByScope: Map<String, List<String>>, val features: List<NativeHomeFeature>,
    val carousel: NativeHomeCarousel, val sourceProvenance: List<NativeHomeProvenance>,
)

internal fun parseNativeHomeData(text: String): NativeHomeData = Json.decodeFromString<NativeHomeData>(text).also { data ->
    require(data.schemaVersion == 1 && data.coreSha256 == NativeMedicalCore.RELEASE_CORE.decodedSha256.removePrefix("sha256:"))
    require(data.sections.map { it.id } == listOf("conditions", "guidelines", "medications", "legal", "assessments", "calculators"))
    data.sections.forEach { row ->
        require(row.countNoun.size == 3 && row.countNoun.all(String::isNotBlank) && row.label.isNotBlank())
        require(NativeAppGlyphName.entries.any { it.webName == row.icon })
        val isTool = row.id in setOf("calculators", "assessments")
        require(if (isTool) row.countEntity == "tool" && row.countProvider == "native-tool-runtime" && row.navigationDocumentCount == null && row.membershipSha256 == null
            else row.countEntity == "navigation-document" && row.countProvider == "released-core" && (row.navigationDocumentCount ?: -1) >= 0 && Regex("[a-f0-9]{64}").matches(row.membershipSha256.orEmpty()))
    }
    require(data.features.map { it.id }.distinct().size == data.features.size && data.features.any { it.webVisibility == "always" })
    data.features.forEach { feature ->
        require(feature.title.isNotBlank() && feature.text.isNotBlank() && feature.nativeAvailability == "unqualified")
        require(feature.webVisibility in setOf("always", "experimental-modules-enabled"))
        require(feature.actions.isNotEmpty() && feature.actions.all { it.metadataOnly && it.label.isNotBlank() })
        require((listOf(feature.icon) + feature.actions.mapNotNull { it.icon }).all { name -> NativeAppGlyphName.entries.any { it.webName == name } })
    }
    require(data.examplesByScope.keys == setOf("all", "conditions", "guidelines", "medications", "legal", "assessments", "calculators", "diagnosis", "personal"))
    require(data.examplesByScope.all { (scope, list) -> list.all(String::isNotBlank) && (list.isNotEmpty() || scope in setOf("calculators", "assessments")) })
    require(data.carousel.autoplayMs > 0 && data.carousel.label.isNotBlank() && data.carousel.itemLabel.isNotBlank() && data.sourceProvenance.isNotEmpty())
    (data.sourceProvenance + data.features.flatMap { it.provenance }).forEach {
        require(it.path.isNotBlank() && Regex("[a-f0-9]{64}").matches(it.sha256) && it.lineStart > 0 && it.lineEnd >= it.lineStart)
    }
}
internal suspend fun bundledNativeHomeData(): NativeHomeData = parseNativeHomeData(Res.readBytes("files/native-home-data.json").decodeToString())

internal fun NativeHomeSection.countLabel(core: NativeToolCore?): String {
    val count = if (countEntity == "tool") core?.tools()?.count { it.kind == if (id == "calculators") "calculator" else "assessment" }
        else navigationDocumentCount
    if (count == null) return "считаем…"
    if (count == 0) return "нет в установленных базах"
    val form = if (count % 100 in 11..14) 2 else when (count % 10) { 1 -> 0; 2, 3, 4 -> 1; else -> 2 }
    val grouped = count.toString().reversed().chunked(3).joinToString("\u00a0").reversed()
    return "$grouped\u00a0${countNoun[form]}"
}

/** Epoch day of the local calendar date, as in Web featureOfDayIndex (no query or private data). */
internal expect fun nativeHomeLocalEpochDay(): Long
internal fun nativeHomeFeatureIndex(count: Int, epochDay: Long): Int = if (count <= 0) 0 else ((epochDay % count + count) % count).toInt()
