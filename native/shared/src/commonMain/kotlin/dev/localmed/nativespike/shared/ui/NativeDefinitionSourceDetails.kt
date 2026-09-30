package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import dev.localmed.nativespike.shared.core.NativeDefinitionSource
import dev.localmed.nativespike.shared.core.NativeDefinitionTextPage
import androidx.compose.ui.unit.dp

@Composable
fun NativeDefinitionSourceDetails(source: NativeDefinitionSource?, page: NativeDefinitionTextPage) {
    val provenance = page.provenance
    SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            source?.let {
                Text(it.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                it.sourceType?.let { value -> SourceDetail("Тип источника: $value") }
                (it.sourceUrl ?: it.baseUrl)?.let { value -> SourceDetail("Адрес источника: $value") }
                it.fileName?.let { value -> SourceDetail("Исходный файл: $value") }
                it.rightsStatus?.let { value -> SourceDetail("Статус прав: $value") }
                it.sourceSha256?.let { value -> SourceDetail("Контрольная сумма источника: $value") }
            }
            SourceDetail("Идентификатор источника: ${page.sourceId}")
            provenance.documentId?.let { SourceDetail("Документ источника: $it") }
            provenance.documentVersionId?.let { SourceDetail("Редакция документа: $it") }
            provenance.sectionId?.let { SourceDetail("Раздел источника: $it") }
            provenance.sectionTitle?.let { SourceDetail("Название раздела: $it") }
            provenance.parentEntryId?.let { SourceDetail("Родительская запись: $it") }
            provenance.parentTitle?.let { SourceDetail("Название родительской записи: $it") }
            provenance.sourceFile?.let { SourceDetail("Файл исходного фрагмента: $it") }
            provenance.chunkId?.let { SourceDetail("Исходный блок: $it") }
            provenance.anchor?.let { SourceDetail("Якорь источника: $it") }
            provenance.pageStart?.let { start ->
                SourceDetail(if (provenance.pageEnd != null && provenance.pageEnd != start) "Страницы источника: $start–${provenance.pageEnd}" else "Страница источника: $start")
            }
            provenance.charStart?.let { SourceDetail("Исходная координата charStart: $it") }
            provenance.charEnd?.let { SourceDetail("Исходная координата charEnd: $it") }
            provenance.offsetStart?.let { SourceDetail("Исходная координата offsetStart: $it") }
            provenance.offsetEnd?.let { SourceDetail("Исходная координата offsetEnd: $it") }
            provenance.locator?.let { SourceDetail("Положение в источнике: $it") }
            provenance.originalSourceSha256?.let { SourceDetail("Контрольная сумма оригинала: $it") }
        }
    }
}

@Composable
private fun SourceDetail(value: String) = Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
