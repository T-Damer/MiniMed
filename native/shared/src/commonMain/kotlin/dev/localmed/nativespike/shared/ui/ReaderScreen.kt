package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
    onSaveItem: (() -> Unit)? = null,
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

    NativeChromeScaffold(
        containerColor = MaterialTheme.colorScheme.surfaceVariant,
        topBar = {
            Column(Modifier.fillMaxWidth()) {
                Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                if (chrome.visible || error != null) NativeReaderHeader(
                    title = document.title,
                    details = listOfNotNull(document.versionLabel,
                        listOfNotNull(document.effectiveFrom, document.effectiveTo).joinToString(" — ").takeIf(String::isNotBlank),
                        "Статус источника: ${nativeCatalogStatus(document.status)}"),
                    error = error, onBack = onBack, onSaveItem = onSaveItem,
                    onRetrySave = if (saveFailed) ({ saveAttempt += 1 }) else null,
                )
            }
        },
    ) { padding ->
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().nestedScroll(chrome.connection).background(MaterialTheme.colorScheme.surfaceVariant),
            contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 24.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + padding.calculateBottomPadding())) {
            for (row in rows) when (row) {
                is NativeReaderRow.Header -> stickyHeader(key = row.key) {
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 10.dp)) {
                            Text(row.section.title, style = MaterialTheme.typography.titleMedium.copy(fontSize = 24.sp, lineHeight = 28.sp), color = MaterialTheme.colorScheme.onSurface)
                            HorizontalDivider(Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
                is NativeReaderRow.Source -> item(key = row.key) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 7.dp)) {
                        // Preserve all source characters, including tables and unsupported markup.
                        SelectionContainer {
                            Text(row.chunk.originalText, style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp),
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
