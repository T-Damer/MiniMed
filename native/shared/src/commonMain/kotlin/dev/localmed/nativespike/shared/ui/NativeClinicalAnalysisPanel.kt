package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import dev.localmed.nativespike.shared.designsystem.NativeChoiceChip
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeDisclosure
import dev.localmed.nativespike.shared.designsystem.NativePaperSheet
import dev.localmed.nativespike.shared.designsystem.NativeSectionHeading
import dev.localmed.nativespike.shared.designsystem.textStyle
import dev.localmed.nativespike.shared.model.QueryAnalysis
import dev.localmed.nativespike.shared.model.QueryCalculation
import dev.localmed.nativespike.shared.model.QueryFactPolarity
import dev.localmed.nativespike.shared.model.SearchIntentKind
import dev.localmed.nativespike.shared.model.SearchSuggestion

private fun nativeIntentLabel(intent: SearchIntentKind): String = when (intent) {
    SearchIntentKind.DIAGNOSIS -> "Диагностика"
    SearchIntentKind.TREATMENT -> "Лечение"
    SearchIntentKind.MEDICATION -> "Препарат"
    SearchIntentKind.DISEASE_REFERENCE -> "Сведения о заболевании"
    SearchIntentKind.CARE_GUIDANCE -> "Медицинская помощь"
    SearchIntentKind.ADMINISTRATIVE_REFERENCE -> "Нормативные сведения"
    SearchIntentKind.MIXED -> "Смешанный запрос"
    SearchIntentKind.UNKNOWN -> "Не определена"
}

/** Renders the core's deterministic query analysis, independently of original source passages. */
@Composable
fun NativeClinicalAnalysisPanel(analysis: QueryAnalysis, onSuggestion: (SearchSuggestion) -> Unit) {
    NativePaperSheet(Modifier.testTag("query-index")) {
        NativeSectionHeading("Цель запроса: ${nativeIntentLabel(analysis.intent.primary)}")
        if (analysis.intent.secondary.isNotEmpty()) NativeClinicalDetail("Также: ${analysis.intent.secondary.joinToString { nativeIntentLabel(it) }}")
        if (analysis.intent.needsClarification) NativeClinicalDetail("Цель запроса требует уточнения.")
        NativeClinicalDetail("Распознанные факты: ${analysis.facts.size}")
        analysis.warnings.forEach { warning ->
            BasicText(warning, Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                style = NativeDesign.components.coreStatusDetail.text.textStyle().copy(color = NativeDesign.colors.danger))
        }
        key(analysis.originalQuery) {
            NativeDisclosure("Разбор запроса") {
                analysis.facts.forEach { fact ->
                    val polarity = when (fact.polarity) {
                        QueryFactPolarity.POSITIVE -> ""
                        QueryFactPolarity.NEGATIVE -> " · отрицательный признак"
                        QueryFactPolarity.UNCERTAIN -> " · неопределённость"
                    }
                    NativeClinicalDetail("${fact.label}: ${fact.value}$polarity")
                }
                when (val calculation = analysis.calculation) {
                    is QueryCalculation.MedicationDose -> {
                        NativeSectionHeading("Тип расчёта в запросе: доза препарата")
                        if (calculation.medicationCandidates.isEmpty()) NativeClinicalDetail("Названия препаратов не распознаны.")
                        else calculation.medicationCandidates.forEach { NativeClinicalDetail("Название из запроса: ${it.matchedText} · ${it.canonicalTerm}") }
                    }
                    QueryCalculation.InfusionVolume -> NativeSectionHeading("Тип расчёта в запросе: объём инфузии")
                    null -> Unit
                }
                if (analysis.suggestions.isNotEmpty()) {
                    NativeSectionHeading("Уточнения запроса")
                    analysis.suggestions.forEach { suggestion ->
                        Column(verticalArrangement = Arrangement.spacedBy(NativeDimensions.space1)) {
                            NativeClinicalDetail(suggestion.detail)
                            NativeChoiceChip(suggestion.label, onClick = { onSuggestion(suggestion) }, icon = { tint ->
                                NativeAppGlyph(NativeAppGlyphName.Brain, Modifier.size(NativeDimensions.space4), tint)
                            })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeClinicalDetail(text: String, modifier: Modifier = Modifier) {
    BasicText(text, modifier, style = NativeDesign.components.coreStatusDetail.text.textStyle())
}
