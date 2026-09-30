package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.tools.*

@Composable
internal fun NativeToolDetails(record: NativeToolRecord) {
    NativeToolDisclosure("Источники и ограничения") {
        Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("${record.bankLabel} · версия ${record.version}",color=MaterialTheme.colorScheme.onSurfaceVariant)
        when(val definition=record.definition) {
            is NativeToolDefinition.Calculator -> {
                Text(definition.value.population)
                definition.value.limitations.forEach { Text("• $it") }
                definition.value.sources.forEach { source ->
                    Text("${source.title}\n${source.publisher} · ${source.version}")
                    listOfNotNull(source.edition,source.page,source.section,source.url).forEach { Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                    Text("Проверено: ${source.reviewedAt}",style=MaterialTheme.typography.labelMedium)
                }
            }
            is NativeToolDefinition.Assessment -> {
                Text(definition.value.disclaimer)
                Text(definition.value.evidenceNote)
                Text("Лицензия: ${definition.value.license.kind}\n${definition.value.license.notice}")
                definition.value.license.sourceUrl?.let { Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                definition.value.population?.let { Text(it) }
                definition.value.limitations.orEmpty().forEach { Text("• $it") }
                definition.value.sources.orEmpty().forEach { source ->
                    Text("${source.title}\n${source.publisher} · ${source.version.orEmpty()}")
                    listOfNotNull(source.edition,source.page,source.section,source.url).forEach { Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        record.sources.forEach { source ->
            Text(source.title);Text("${source.kind} · ${source.relation} · проверено ${source.reviewedAt}",style=MaterialTheme.typography.labelMedium)
            source.url?.let { Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
    }
}
@Composable
internal fun NativeToolEvaluation(evaluation: NativeToolEvaluation) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primary.copy(alpha=.12f)).padding(12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        val title=when(evaluation.status) { "verdict" -> evaluation.verdict?.title ?: "Оценка результата";"missing-context" -> "Недостаточно данных";"not-applicable" -> "Оценка неприменима";else -> "Оценка недоступна" }
        Text(title,style=MaterialTheme.typography.titleMedium)
        evaluation.verdict?.let { Text(it.explanation);Text("Уровень внимания: ${it.attentionLevel}",color=MaterialTheme.colorScheme.onSurfaceVariant) }
        evaluation.reason?.let { Text(it) };evaluation.missingContext.forEach { Text(it) }
        if(evaluation.sourceIds.isNotEmpty()) Text("Источники оценки: ${evaluation.sourceIds.joinToString()}",style=MaterialTheme.typography.labelMedium)
    }
}


@Composable
internal fun NativeToolDisclosure(title: String,content: @Composable ()->Unit) {
    var expanded by remember(title) { mutableStateOf(false) }
    NativePaperSurface(Modifier.fillMaxWidth(),raised=false) {
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            NativePaperButton(title,{expanded=!expanded},Modifier.fillMaxWidth(),glyph=if(expanded) NativeAppGlyphName.CaretUp else NativeAppGlyphName.CaretDown)
            if(expanded) content()
        }
    }
}
