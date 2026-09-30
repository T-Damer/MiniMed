package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.asPaddingValues
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.core.NativeDefinitionCard
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

@Composable
fun NativeDefinitionReaderScreen(
    core: NativeMedicalCore, card: NativeDefinitionCard, route: NativeReaderRoute.Definition,
    onSavePosition: suspend (NativeReaderRoute.Definition) -> Boolean,
    error: String?, saveFailed: Boolean, onBack: () -> Unit,
    registerNavigationFlush: ((suspend () -> Boolean) -> (() -> Unit))? = null,
    onSaveItem: (() -> Unit)? = null,
) {
    val state = remember(core, route.target) { NativeDefinitionReaderState(route) }
    val listState = remember(core, route.target) { LazyListState(route.firstVisibleItemIndex, route.firstVisibleItemOffset) }
    var positioned by remember(core, route.target) { mutableStateOf(false) }
    var pendingTextPosition by remember(core, route.target) { mutableStateOf(false) }
    val chrome = rememberNativeReaderChrome(route.target)
    val scope = rememberCoroutineScope()
    var blocksAttempt by remember(route.target) { mutableStateOf(0) }
    var textAttempt by remember(route.target) { mutableStateOf(0) }
    var saveAttempt by remember(route.target) { mutableStateOf(0) }
    var sourceVisible by remember(route.target) { mutableStateOf(false) }
    LaunchedEffect(core, route.target, blocksAttempt) { state.loadInitialBlocks(core) }
    LaunchedEffect(core, route.target, state.selected?.linkId, state.offset, textAttempt) { state.loadText(core) }
    LaunchedEffect(core, route.target, state.text != null, pendingTextPosition) {
        if (!positioned && state.text != null) {
            listState.scrollToItem(route.firstVisibleItemIndex, route.firstVisibleItemOffset)
            positioned = true
        }
        if (state.text != null && pendingTextPosition) {
            listState.scrollToItem(2)
            pendingTextPosition = false
        }
    }
    fun currentSnapshot() = state.position(
        if (pendingTextPosition) 2 else if (positioned) listState.firstVisibleItemIndex else route.firstVisibleItemIndex,
        if (pendingTextPosition) 0 else if (positioned) listState.firstVisibleItemScrollOffset else route.firstVisibleItemOffset)
    DisposableEffect(core, route.target, registerNavigationFlush) {
        val unregister = registerNavigationFlush?.invoke { currentSnapshot()?.let { onSavePosition(it) } ?: true }
        onDispose { unregister?.invoke() }
    }
    LaunchedEffect(core, route.target, saveAttempt) {
        var saved: NativeReaderRoute.Definition? = null
        snapshotFlow { currentSnapshot() }.filterNotNull().distinctUntilChanged().collectLatest { current ->
            // Block and Unicode page changes persist before text I/O completes; only scrolling waits.
            if (!nativeDefinitionSemanticPositionChanged(saved, current)) delay(120)
            if (onSavePosition(current)) saved = current
        }
    }

    val readerError = listOfNotNull(error, state.blocksError, state.textError, state.sourceError).distinct().joinToString("\n").ifBlank { null }
    NativeChromeScaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        Column(Modifier.fillMaxWidth()) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            if (chrome.visible || readerError != null) NativeReaderHeader(
                title = card.title,
                details = listOf(nativeDefinitionEntryLabel(card),
                    "Требует проверки · запись в пределах источника", "Редакция: ${route.target.moduleVersion}"),
                error = readerError, onBack = onBack, onSaveItem = onSaveItem,
                onRetrySave = if (saveFailed) ({ saveAttempt += 1 }) else null,
            )
        }
    }) { padding ->
        Column(Modifier.fillMaxSize()) {
            if (!state.blocksLoaded) {
                Column(Modifier.fillMaxWidth().padding(padding)) {
                    if (state.blocksLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    else NativePaperButton(text = "Повторить чтение блоков", onClick = { blocksAttempt += 1 })
                }
            } else {
                val page = state.text
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize().nestedScroll(chrome.connection), contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 24.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + padding.calculateBottomPadding())) {
                    item("record") {
                        NativePaperSurface(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), raised = false) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(nativeIdentityCoverageLabel(card.coverage), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("Связь названия с записью предложена в пределах источника.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("Исходных блоков: ${card.blockCount}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("Редакция: ${route.target.moduleVersion}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    item("blocks") {
                        NativeDefinitionBlockSelector(state, card, onPrevious = { state.previousBlock(); pendingTextPosition = true }, onNext = { scope.launch { state.nextBlock(core); pendingTextPosition = true } }, onSelect = { block ->
                            state.select(block)
                            pendingTextPosition = true
                        }, onMore = { scope.launch { state.loadMoreBlocks(core) } })
                    }
                    item("text") {
                        NativePaperSurface(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), raised = true) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (state.selected == null) Text("В этой записи нет доступного исходного блока.", color = MaterialTheme.colorScheme.onSurface)
                                else if (page == null) {
                                    if (state.textLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                                    else NativePaperButton(text = "Повторить чтение текста", onClick = { textAttempt += 1 })
                                } else {
                                Text(nativeDefinitionBlockLabel(requireNotNull(state.selected).role, card), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                                Text(nativeDefinitionPageRange(state.offset, page.totalCharacters, page.nextOffset),
                                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                if (page.text.isEmpty() && state.offset > 0) NativePaperButton(text = "К началу блока", onClick = { state.moveTo(0); pendingTextPosition = true })
                                SelectionContainer { Text(page.text, style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 27.2.sp), color = MaterialTheme.colorScheme.onSurface) }
                                }
                            }
                        }
                    }
                    item("paging") {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            NativePaperButton(text = "Предыдущий фрагмент", modifier = Modifier.weight(1f), enabled = page?.previousOffset != null, onClick = {
                                page?.previousOffset?.let { state.moveTo(it); pendingTextPosition = true }
                            })
                            NativePaperButton(text = "Следующий фрагмент", modifier = Modifier.weight(1f), enabled = page?.nextOffset != null, onClick = {
                                page?.nextOffset?.let { state.moveTo(it); pendingTextPosition = true }
                            })
                        }
                    }
                    item("source") {
                        if (page != null) NativePaperSurface(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), raised = true) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                                NativePaperButton(text = if (sourceVisible) "Скрыть сведения об источнике" else "Источник и положение фрагмента", onClick = { sourceVisible = !sourceVisible })
                                if (sourceVisible) NativeDefinitionSourceDetails(state.source, page)
                                if (state.sourceError != null) NativePaperButton(text = "Повторить чтение источника", onClick = { textAttempt += 1 })
                            }
                        }
                    }
                }
            }
        }
    }
}
