package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
    var expanded by remember(analysis.originalQuery) { mutableStateOf(false) }
    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Цель запроса: ${nativeIntentLabel(analysis.intent.primary)}", style = MaterialTheme.typography.titleMedium)
            if (analysis.intent.secondary.isNotEmpty()) Text("Также: ${analysis.intent.secondary.joinToString { nativeIntentLabel(it) }}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (analysis.intent.needsClarification) Text("Цель запроса требует уточнения.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Распознанные факты: ${analysis.facts.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            analysis.warnings.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Скрыть разбор запроса" else "Показать разбор запроса") }
            if (expanded) {
                analysis.facts.forEach { fact ->
                    val polarity = when (fact.polarity) {
                        QueryFactPolarity.POSITIVE -> ""
                        QueryFactPolarity.NEGATIVE -> " · отрицательный признак"
                        QueryFactPolarity.UNCERTAIN -> " · неопределённость"
                    }
                    Text("${fact.label}: ${fact.value}$polarity")
                }
                when (val calculation = analysis.calculation) {
                    is QueryCalculation.MedicationDose -> {
                        Text("Тип расчёта в запросе: доза препарата", style = MaterialTheme.typography.titleSmall)
                        if (calculation.medicationCandidates.isEmpty()) Text("Названия препаратов не распознаны.")
                        else calculation.medicationCandidates.forEach { Text("Название из запроса: ${it.matchedText} · ${it.canonicalTerm}") }
                    }
                    QueryCalculation.InfusionVolume -> Text("Тип расчёта в запросе: объём инфузии", style = MaterialTheme.typography.titleSmall)
                    null -> Unit
                }
                if (analysis.suggestions.isNotEmpty()) {
                    Text("Уточнения запроса", style = MaterialTheme.typography.titleMedium)
                    analysis.suggestions.forEach { suggestion ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(suggestion.detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(onClick = { onSuggestion(suggestion) }) { Text(suggestion.label) }
                        }
                    }
                }
            }
        }
    }
}
