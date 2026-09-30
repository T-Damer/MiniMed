package dev.localmed.nativespike.shared.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.core.NativeSourceDocument
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReaderBar
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReaderList
import dev.localmed.nativespike.shared.designsystem.NativeDocumentReaderOverlays
import dev.localmed.nativespike.shared.designsystem.rememberNativeDocumentReaderState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * An official source in the shared reader: the Web source-text rules turn each original chunk into
 * blocks (`nativeSourceReaderBlocks`), rendered by the design-system reader inside the transparent
 * chrome scaffold. Reading positions stay exact chunk ids with the offset into the chunk's first
 * block; a position further inside a chunk restores to the chunk's start.
 */
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
    val reader = remember(document) { nativeSourceReaderDocument(document) }
    val list = rememberLazyListState()
    val chrome = rememberNativeReaderChrome(document.target)
    val state = rememberNativeDocumentReaderState(reader.document, list = list, chrome = chrome)
    val glyphs = remember { nativeReaderAppGlyphs() }
    var positioned by remember(document.target) { mutableStateOf(false) }
    var saveAttempt by remember(document.target) { mutableStateOf(0) }

    LaunchedEffect(document.target) {
        val start = nativeSourceReaderStart(reader, snapshot)
        val offset = if (snapshot.chunkId != null && reader.firstBlockOf(snapshot.chunkId) == start) snapshot.offsetPx else 0
        list.scrollToItem(start, offset.coerceAtLeast(0))
        positioned = true
    }
    fun currentSnapshot(): NativeReaderRoute.Document {
        val block = state.currentBlock
        val chunk = reader.chunkAtOrAfter(block)
        val exact = chunk != null && reader.firstBlockOf(chunk.id) == block
        return NativeReaderRoute.Document(snapshot.target, chunk?.id, if (exact) list.firstVisibleItemScrollOffset else 0)
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

    val details = listOfNotNull(
        document.versionLabel,
        listOfNotNull(document.effectiveFrom, document.effectiveTo).joinToString(" — ").takeIf(String::isNotBlank),
        "Статус источника: ${nativeCatalogStatus(document.status)}",
    )
    // The list keeps the tallest bar's padding, so hiding the bar never moves the text under it.
    var listTop by remember { mutableStateOf(0.dp) }
    val paper = NativeDesign.components.readerPaper.background
    NativeChromeScaffold(
        containerColor = paper,
        topBar = {
            Column(Modifier.fillMaxWidth()) {
                Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                AnimatedVisibility(
                    chrome.visible || error != null || state.findOpen,
                    enter = expandVertically(expandFrom = Alignment.Top) + fadeIn(),
                    exit = shrinkVertically(shrinkTowards = Alignment.Top) + fadeOut(),
                ) {
                    NativeDocumentReaderBar(state, document.title, onBack, glyphs, background = Color.Transparent) {
                        NativeReaderSourceMenu(document.title, details, error, onSaveItem, if (saveFailed) ({ saveAttempt += 1 }) else null)
                    }
                }
            }
        },
    ) { padding ->
        val top = padding.calculateTopPadding()
        val paddedTop = maxOf(listTop, top)
        SideEffect { listTop = paddedTop }
        val bottom = padding.calculateBottomPadding() + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        Box(Modifier.fillMaxSize()) {
            NativeDocumentReaderList(state, contentPadding = PaddingValues(top = paddedTop + 12.dp, bottom = bottom + 24.dp))
            NativeDocumentReaderOverlays(state, glyphs, top = top, bottom = bottom)
        }
    }
}

