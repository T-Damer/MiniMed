package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.ui.unit.sp
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
    // Hoistable so a debug bench harness can drive a programmatic scroll (LazyListState.scrollBy)
    // without touch-input injection — see native/androidApp's BenchScreen.kt. Normal callers don't
    // pass this and get an internally-remembered state exactly as before.
    listState: LazyListState = rememberLazyListState(),
) {
    var rows by remember(documentId) { mutableStateOf<List<ReaderRow>>(emptyList()) }

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

    // Web reader typography (apps/app/src/styles/global.css `.document-text__paragraph`): serif,
    // ~16-19px, line-height 1.72 — a generous "book page" measure, not compact UI text.
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface, // --theme-surface, matches the reader's paper background
        topBar = {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Row(Modifier.fillMaxWidth().padding(8.dp)) {
                    IconButton(onClick = onBack) {
                        Text("←", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                    }
                    Text(
                        documentTitle,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(start = 8.dp, top = 12.dp),
                    )
                }
            }
        },
    ) { padding ->
        ReaderList(rows = rows, listState = listState, modifier = Modifier.fillMaxSize().padding(padding))
    }
}

@Composable
private fun ReaderList(rows: List<ReaderRow>, listState: LazyListState, modifier: Modifier = Modifier) {
    LazyColumn(
        modifier = modifier.background(MaterialTheme.colorScheme.surface),
        state = listState,
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        items(rows) { row ->
            when (row) {
                is ReaderRow.Header -> Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 18.dp, bottom = 10.dp)) {
                    Text(
                        row.section.title,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    HorizontalDivider(Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.outline)
                }
                is ReaderRow.Paragraph -> Text(
                    row.chunk.text,
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 27.sp),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 7.dp),
                )
            }
        }
    }
}
