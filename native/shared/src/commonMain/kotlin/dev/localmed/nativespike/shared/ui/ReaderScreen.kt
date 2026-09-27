package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.db.NativeSearchDatabase
import dev.localmed.nativespike.shared.model.ReaderChunk
import dev.localmed.nativespike.shared.model.SectionRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Flattened reader row: a section header followed by its paragraph chunks, in document order —
 * this is what actually scrolls, so a "long document" fling test measures this list. */
private sealed interface ReaderRow {
    data class Header(val section: SectionRow) : ReaderRow
    data class Paragraph(val chunk: ReaderChunk) : ReaderRow
}

@Composable
fun ReaderScreen(
    database: NativeSearchDatabase,
    documentId: String,
    documentTitle: String,
    initialSectionAnchor: String?,
    onBack: () -> Unit,
) {
    var rows by remember(documentId) { mutableStateOf<List<ReaderRow>>(emptyList()) }
    val listState = rememberLazyListState()

    LaunchedEffect(documentId) {
        val loaded = withContext(Dispatchers.Default) {
            val sections = database.sectionsForDocument(documentId)
            sections.flatMap { section ->
                listOf(ReaderRow.Header(section)) +
                    database.chunksForSection(section.id).map { ReaderRow.Paragraph(it) }
            }
        }
        rows = loaded
        val targetIndex = initialSectionAnchor?.let { anchor ->
            loaded.indexOfFirst { it is ReaderRow.Header && it.section.anchor == anchor }
        }
        if (targetIndex != null && targetIndex >= 0) {
            listState.scrollToItem(targetIndex)
        }
    }

    Scaffold(topBar = {
        Surface(tonalElevation = 2.dp) {
            Row(Modifier.fillMaxWidth().padding(8.dp)) {
                IconButton(onClick = onBack) {
                    Text("←", style = MaterialTheme.typography.titleLarge)
                }
                Text(
                    documentTitle,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(start = 8.dp, top = 12.dp),
                )
            }
        }
    }) { padding ->
        ReaderList(rows = rows, listState = listState, modifier = Modifier.fillMaxSize().padding(padding))
    }
}

@Composable
private fun ReaderList(rows: List<ReaderRow>, listState: LazyListState, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier, state = listState) {
        items(rows) { row ->
            when (row) {
                is ReaderRow.Header -> Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(row.section.title, style = MaterialTheme.typography.titleSmall)
                    HorizontalDivider(Modifier.padding(top = 6.dp))
                }
                is ReaderRow.Paragraph -> Text(
                    row.chunk.text,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }
        }
    }
}
