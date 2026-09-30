package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ReaderScreen(
    document: NativeSourceDocument,
    snapshot: NativeReaderRoute.Document,
    onSavePosition: suspend (NativeReaderRoute.Document) -> Boolean,
    error: String? = null,
    saveFailed: Boolean = false,
    onBack: () -> Unit,
    registerNavigationFlush: ((suspend () -> Boolean) -> (() -> Unit))? = null,
) {
    val rows = remember(document) { nativeReaderRows(document) }
    val listState = rememberLazyListState()
    var positioned by remember(document.target) { mutableStateOf(false) }
    var saveAttempt by remember(document.target) { mutableStateOf(0) }
    val chrome = rememberNativeReaderChrome(document.target)

    LaunchedEffect(document.target) {
        listState.scrollToItem(nativeReaderStartIndex(rows, snapshot), snapshot.offsetPx.coerceAtLeast(0))
        positioned = true
    }
    fun currentSnapshot(): NativeReaderRoute.Document {
        val index = listState.firstVisibleItemIndex
        val row = rows.getOrNull(index)
        val chunk = (row as? NativeReaderRow.Source)?.chunk
            ?: rows.drop(index).firstNotNullOfOrNull { (it as? NativeReaderRow.Source)?.chunk }
        return NativeReaderRoute.Document(snapshot.target, chunk?.id, if (row is NativeReaderRow.Source) listState.firstVisibleItemScrollOffset else 0)
    }
    DisposableEffect(document.target, registerNavigationFlush) {
        val unregister = registerNavigationFlush?.invoke { if (positioned) onSavePosition(currentSnapshot()) else true }
        onDispose { unregister?.invoke() }
    }
    LaunchedEffect(document.target, positioned, saveAttempt) {
        if (!positioned) return@LaunchedEffect
        snapshotFlow { currentSnapshot() }.distinctUntilChanged().collectLatest {
            delay(120)
            onSavePosition(it)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth()) {
                    // Opaque paper paints behind the status bar even while controls are hidden.
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    if (chrome.visible || error != null) Row(Modifier.fillMaxWidth().padding(8.dp)) {
                        IconButton(onClick = onBack, modifier = Modifier.semantics { contentDescription = "Назад" }) {
                            Text("←", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                        }
                        Column(Modifier.weight(1f).padding(start = 8.dp, top = 8.dp)) {
                            Text(document.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                            Text(document.versionLabel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            val dates = listOfNotNull(document.effectiveFrom, document.effectiveTo).joinToString(" — ")
                            if (dates.isNotBlank()) Text(dates, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (document.status != "active") Text("Статус источника: ${nativeCatalogStatus(document.status)}",
                                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
                            if (saveFailed) TextButton(onClick = { saveAttempt += 1 }) { Text("Повторить сохранение") }
                        }
                    }
                }
            }
        },
    ) { padding ->
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().nestedScroll(chrome.connection).background(MaterialTheme.colorScheme.surface).padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp)) {
            for (row in rows) when (row) {
                is NativeReaderRow.Header -> stickyHeader(key = row.key) {
                    Surface(color = MaterialTheme.colorScheme.surface) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                            Text(row.section.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                            HorizontalDivider(Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
                is NativeReaderRow.Source -> item(key = row.key) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 7.dp)) {
                        // Preserve all source characters, including tables and unsupported markup.
                        SelectionContainer {
                            Text(row.chunk.originalText, style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 27.sp),
                                color = MaterialTheme.colorScheme.onSurface)
                        }
                        row.chunk.pageStart?.let { page ->
                            val end = row.chunk.pageEnd
                            Text(if (end != null && end != page) "Страницы $page–$end" else "Страница $page",
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}
