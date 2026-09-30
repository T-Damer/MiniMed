package dev.localmed.nativespike.shared.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class NativeSearchScope {
    @SerialName("all") ALL, @SerialName("diagnosis") DIAGNOSIS,
    @SerialName("guidelines") GUIDELINES, @SerialName("medications") MEDICATIONS,
    @SerialName("legal") LEGAL, @SerialName("conditions") CONDITIONS,
    @SerialName("calculators") CALCULATORS, @SerialName("assessments") ASSESSMENTS,
    @SerialName("personal") PERSONAL,
}

@Serializable
data class NativeSearchFilters(
    val documentIds: List<String> = emptyList(),
    val specialties: List<String> = emptyList(),
    val ageGroups: List<String> = emptyList(),
    val sectionTypes: List<String> = emptyList(),
)

@Serializable
data class NativeSearchSelection(
    val scope: NativeSearchScope = NativeSearchScope.ALL,
    val filters: NativeSearchFilters = NativeSearchFilters(),
)

internal fun validateSearchSelection(selection: NativeSearchSelection) {
    val lists=listOf(selection.filters.documentIds,selection.filters.specialties,selection.filters.ageGroups,selection.filters.sectionTypes)
    require(lists.sumOf { it.size }<=100_000 && lists.sumOf { list -> list.sumOf { it.length.toLong() } }<=8_000_000) { "Search filters are too large" }
    require(lists.all { list -> list.all { it.isNotEmpty() && it.length<=2048 && !it.contains('\u0000') } }) { "Invalid search filter" }
}
