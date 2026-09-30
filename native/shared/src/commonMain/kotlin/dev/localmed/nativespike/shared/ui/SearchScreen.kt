package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import dev.localmed.nativespike.shared.model.DocumentKind
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.tools.NativeToolCore
import dev.localmed.nativespike.shared.tools.NativeToolRecord
import dev.localmed.nativespike.shared.tools.searchTools
import dev.localmed.nativespike.shared.user.NativeItemRef
import dev.localmed.nativespike.shared.model.SearchResultGroup
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private const val DEBOUNCE_MS = 120L

// --home-gap from apps/app/src/features/search/search-home-intro.css: 1rem (16dp) baseline, 1.25rem
// (20dp) at the wider breakpoint. This spike targets phone width only, so 16dp throughout — see
// docs/research/native-vs-webview-2026-09-28.md, "Web visual parity restyle".
private val HOME_GAP = 16.dp

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun SearchScreen(
    core: NativeSearchActions,
    state: NativeSearchUiState,
    onOpenDocument: (documentId: String, documentTitle: String, sectionAnchor: String?, target: NativeDocumentTarget?) -> Unit,
    openingSource: Boolean = false,
    sourceError: String? = null,
    onOpenSources: () -> Unit,
    onOpenIdentity: (NativeCoreIdentityHit) -> Unit,
    onOpenSettings: (() -> Unit)? = null,
    onOpenHistory: (() -> Unit)? = null,
    onOpenCollections: (() -> Unit)? = null,
    toolCore: NativeToolCore? = null,
    onOpenTools: (() -> Unit)? = null,
    onOpenTool: ((NativeToolRecord) -> Unit)? = null,
    onSaveTool: ((NativeItemRef) -> Unit)? = null,
    onCompletedSearch: ((String, SearchOutcome) -> Unit)? = null,
    onRetrySave: (() -> Unit)? = null,
    // Debug measurement hook only (see native/androidApp's MainActivity — HyperOS blocks
    // `adb shell input` entirely on the physical Xiaomi 14, and even on a plain emulator
    // `adb shell input text` cannot type Cyrillic: it maps characters through the current
    // KeyCharacterMap, which has no mapping for них — `input text "менингит"` throws inside
    // InputShellCommand.sendText). `externalQuery`, when non-null, drives the same query state a
    // real keystroke would, so a debug build can be driven by a broadcast instead of typing.
    // `null` (every non-bench caller) preserves exactly the original typed-search behavior.
    externalQuery: String? = null,
    // `stages`: per-stage timing map from LookupEngine.search's onStage callback, summed by stage
    // name across all branches (see PipelineTiming.kt/LookupPipeline.kt) — used only by the debug
    // bench path (see MainActivity), empty for any non-bench call.
    onOutcome: ((query: String, outcome: SearchOutcome?, tookMs: Double, stages: Map<String, Double>) -> Unit)? = null,
) {
    val queryFocus = remember(core) { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(externalQuery) {
        if (externalQuery != null) state.updateQuery(externalQuery)
    }
    var identities by remember(core, state.query, state.mode,state.selection) { mutableStateOf<List<NativeCoreIdentityHit>>(emptyList()) }
    var identitiesLoading by remember(core, state.query, state.mode,state.selection) { mutableStateOf(false) }
    var identitiesError by remember(core, state.query, state.mode,state.selection) { mutableStateOf<String?>(null) }
    LaunchedEffect(core, state.query, state.mode,state.selection, state.attempt) {
        val requestQuery = state.query
        val requestMode = state.mode
        val requestSelection = state.selection
        if (requestQuery.isBlank() || requestMode != NativeSearchMode.LOOKUP) return@LaunchedEffect
        identitiesLoading = true
        identitiesError = null
        try {
            delay(DEBOUNCE_MS)
            val hits = core.lookupIdentities(requestQuery,requestSelection)
            if (currentCoroutineContext().isActive && state.acceptsLookupIdentities(requestQuery, requestMode,requestSelection)) identities = hits
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) {
            if (currentCoroutineContext().isActive && state.acceptsLookupIdentities(requestQuery, requestMode,requestSelection)) identitiesError = "Не удалось прочитать точные названия из источников. Повторите запрос."
        } finally {
            if (currentCoroutineContext().isActive && state.acceptsLookupIdentities(requestQuery, requestMode,requestSelection)) identitiesLoading = false
        }
    }

    LaunchedEffect(core, state.query, state.mode,state.selection, state.attempt) {
        val requestQuery = state.query
        val requestMode = state.mode
        val requestSelection = state.selection
        if (state.positionQuery != requestQuery || state.positionMode != requestMode || state.positionSelection != requestSelection) {
            state.listState.scrollToItem(0)
            if (!state.acceptsRequest(requestQuery,requestMode,requestSelection)) return@LaunchedEffect
            state.positionQuery = requestQuery
            state.positionMode = requestMode
            state.positionSelection = requestSelection
        }
        if (requestQuery.isBlank()) {
            state.outcome = null
            state.loading = false
            state.error = null
            state.completedQuery = null
            state.completedMode = null
            return@LaunchedEffect
        }
        if (state.completedQuery == requestQuery && state.completedMode == requestMode && state.completedSelection == requestSelection && state.outcome != null) return@LaunchedEffect
        state.loading = true
        state.error = null
        state.outcome = null
        val benchStart = if (requestQuery == externalQuery) kotlin.time.TimeSource.Monotonic.markNow() else null
        val stageTimings: MutableMap<String, Double>? = if (benchStart != null) LinkedHashMap() else null
        delay(DEBOUNCE_MS)
        try {
            val result = core.search(requestQuery, requestMode,requestSelection) { stage, ms ->
                    stageTimings?.let { it[stage] = (it[stage] ?: 0.0) + ms }
            }
            if (!currentCoroutineContext().isActive || !state.acceptsRequest(requestQuery,requestMode,requestSelection)) return@LaunchedEffect
            state.outcome = result
            state.completedQuery = requestQuery
            state.completedMode = requestMode
            state.completedSelection = requestSelection
            state.error = null
            if (result != null) onCompletedSearch?.invoke(requestQuery, result)
            if (benchStart != null) {
                // Two frame waits: the first is where Compose schedules recomposition for the
                // new `outcome`, the second guarantees that recomposition has actually been
                // measured/laid-out/drawn — see docs/research/native-vs-webview-2026-09-28.md.
                androidx.compose.runtime.withFrameNanos { }
                androidx.compose.runtime.withFrameNanos { }
                if (!currentCoroutineContext().isActive || !state.acceptsRequest(requestQuery,requestMode,requestSelection)) return@LaunchedEffect
                onOutcome?.invoke(
                    requestQuery, result, benchStart.elapsedNow().inWholeMicroseconds / 1000.0,
                    stageTimings.orEmpty(),
                )
            }
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            if (currentCoroutineContext().isActive && state.acceptsRequest(requestQuery,requestMode,requestSelection)) {
                state.error = "Не удалось выполнить поиск. Повторите запрос."
            }
        } finally {
            if (currentCoroutineContext().isActive && state.acceptsRequest(requestQuery,requestMode,requestSelection)) {
                state.loading = false
            }
        }
    }

    NativeChromeScaffold(
        containerColor = MaterialTheme.colorScheme.background,
        scrolled = state.listState.firstVisibleItemIndex > 0 || state.listState.firstVisibleItemScrollOffset > 0,
        topBarTintAlpha = .92f,
        desk = true,
        topBar = {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal=HOME_GAP,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
                onOpenHistory?.let { NativePaperIconButton(NativeAppGlyphName.History,it,"История поиска") }
                Spacer(Modifier.weight(1f))
                NativePaperIconButton(NativeAppGlyphName.Books,onOpenSources,"Источники")
                onOpenTools?.let { NativePaperIconButton(NativeAppGlyphName.Calculator,it,"Инструменты",Modifier.padding(start=8.dp)) }
            }
        },
    ) { padding ->
        val groups = state.outcome?.groups.orEmpty()
        LazyColumn(
            modifier = Modifier.fillMaxSize().navigationBarsPadding(), state = state.listState,
            contentPadding = PaddingValues(start=HOME_GAP,end=HOME_GAP,top=padding.calculateTopPadding()+8.dp,bottom=8.dp+padding.calculateBottomPadding()),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            item(key="search-controls") {
            Column(Modifier.fillMaxWidth()) {
            Surface(color=MaterialTheme.colorScheme.errorContainer,shape=RoundedCornerShape(7.dp),
                border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.primary),
                modifier=Modifier.fillMaxWidth().padding(vertical=8.dp)) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(start=16.dp,end=4.dp,top=10.dp,bottom=8.dp),verticalAlignment=Alignment.Top) {
                        BasicTextField(value=state.query,onValueChange={state.updateQuery(it)},
                            modifier=Modifier.weight(1f).heightIn(min=52.dp).focusRequester(queryFocus)
                                .padding(top=4.dp,end=8.dp).semantics { contentDescription="Поисковый запрос" },
                            singleLine=state.mode==NativeSearchMode.LOOKUP,maxLines=if(state.mode==NativeSearchMode.CLINICAL) 6 else 1,
                            textStyle=MaterialTheme.typography.bodyLarge.copy(color=MaterialTheme.colorScheme.onSurface,lineHeight=22.4.sp),
                            cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),
                            decorationBox={inner -> Box { if(state.query.isEmpty()) Text("Название, код МКБ, препарат или фраза из документа",
                                style=MaterialTheme.typography.bodyLarge.copy(lineHeight=22.4.sp),color=MaterialTheme.colorScheme.onSurfaceVariant);inner() } })
                        if(state.query.isNotEmpty()) androidx.compose.material3.IconButton(onClick={state.updateQuery("")}) {
                            NativeAppGlyph(NativeAppGlyphName.Close,contentDescription="Очистить запрос")
                        }
                    }
                    Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer).padding(horizontal=8.dp,vertical=6.dp),
                        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        NativeSearchScopePicker(state.selection.scope,Modifier.weight(1f)) { scope -> state.updateSelection(state.selection.copy(scope=scope)) }
                        NativePaperIconButton(NativeAppGlyphName.Brain,
                            {state.updateMode(if(state.mode==NativeSearchMode.LOOKUP) NativeSearchMode.CLINICAL else NativeSearchMode.LOOKUP)},
                            if(state.mode==NativeSearchMode.CLINICAL) "Клинический режим включён. Переключить на поиск по названию" else "Поиск по названию. Включить клинический режим",
                            primary=state.mode==NativeSearchMode.CLINICAL)
                        NativePaperIconButton(if(state.loading || state.error!=null) NativeAppGlyphName.Refresh else NativeAppGlyphName.Search,
                            {if(state.query.isNotBlank()) state.attempt+=1},if(state.loading) "Ищем" else "Найти или повторить поиск",
                            enabled=state.query.isNotBlank() && !state.loading)
                    }
                }
            }
            if (openingSource) Text("Открываем источник…", modifier = Modifier.padding(horizontal = HOME_GAP),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
            sourceError?.let { Text(it, modifier = Modifier.padding(horizontal = HOME_GAP),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
            onRetrySave?.let { retry -> TextButton(onClick = retry, modifier = Modifier.padding(horizontal = HOME_GAP)) { Text("Повторить сохранение", color = MaterialTheme.colorScheme.onSurface) } }
            state.inputError?.let { Text(it, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(horizontal = HOME_GAP)) }
            identitiesError?.let {
                Text(it, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(horizontal = HOME_GAP))
                TextButton(onClick = { state.attempt += 1 }) { Text("Повторить чтение названий", color = MaterialTheme.colorScheme.onSurface) }
            }
            if (state.mode == NativeSearchMode.LOOKUP) NativeIdentityRail(identities, openingSource, onOpenIdentity)
            if (state.loading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(horizontal = HOME_GAP), color = MaterialTheme.colorScheme.onSurface)
            if (state.error != null) {
                Text(
                    state.error ?: "Не удалось выполнить поиск.",
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(HOME_GAP),
                )
                TextButton(onClick = { state.attempt += 1 }, modifier = Modifier.padding(horizontal = HOME_GAP)) {
                    Text("Повторить поиск", color = MaterialTheme.colorScheme.onSurface)
                }
            }

            if (!state.loading && !identitiesLoading && state.error == null && identitiesError == null && state.completedQuery != null && groups.isEmpty() && identities.isEmpty()) {
                Text("По этому запросу источники не найдены.", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(HOME_GAP))
            }
            }
            }
                if(toolCore!=null && onOpenTool!=null && onSaveTool!=null && onOpenTools!=null && state.query.isNotBlank()) {
                    val matches=toolCore.searchTools(state.query)
                    if(matches.isNotEmpty()) item(key="tool-matches") { NativeToolMatchesRail(state.query,matches,onOpenTool,onSaveTool,onOpenTools) }
                }
                if (state.mode == NativeSearchMode.CLINICAL) state.outcome?.analysis?.let { analysis ->
                    item(key = "clinical-analysis") { NativeClinicalAnalysisPanel(analysis, onSuggestion = { suggestion ->
                        state.updateQuery(state.query.trimEnd() + (if (state.query.isBlank()) "" else "\n") + suggestion.insertion)
                        queryFocus.requestFocus()
                        keyboard?.show()
                    }) }
                }
                itemsIndexed(groups, key = { _,group -> group.documentId }) { index,group ->
                    DocumentResultCard(group = group,index=index, onOpenDocument = onOpenDocument)
                }
        }
    }
}

/** Source-faithful paper group: all excerpts remain available behind the same disclosure. */
@Composable
private fun DocumentResultCard(group: SearchResultGroup,index: Int,
    onOpenDocument: (String,String,String?,NativeDocumentTarget?)->Unit) {
    var expanded by remember(group.documentId) { mutableStateOf(false) }
    val kindGlyph=when(group.documentKind) {
        DocumentKind.MEDICATION -> NativeAppGlyphName.Prescription
        DocumentKind.CLINICAL_RECOMMENDATION -> NativeAppGlyphName.BookOpen
        DocumentKind.LEGAL -> NativeAppGlyphName.Scales
        DocumentKind.CALCULATOR -> NativeAppGlyphName.Calculator
        DocumentKind.ASSESSMENT -> NativeAppGlyphName.ListChecks
        else -> NativeAppGlyphName.Notes
    }
    NativePaperSurface(Modifier.fillMaxWidth().padding(vertical=6.dp),raised=false) {
        Column {
            Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer)
                .clickable { onOpenDocument(group.documentId,group.documentTitle,group.items.firstOrNull()?.anchor,group.items.firstOrNull()?.target) }
                .padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.Top) {
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        NativeAppGlyph(kindGlyph,Modifier.size(16.dp),MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(group.documentKind.label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(group.documentTitle,style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.onSurface)
                    group.items.firstOrNull()?.sectionPath?.let { Text(it,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                Text((index+1).toString().padStart(2,'0'),style=MaterialTheme.typography.headlineLarge,
                    color=MaterialTheme.colorScheme.onSurface.copy(alpha=.10f),fontSize=64.sp,lineHeight=58.sp,
                    modifier=Modifier.padding(start=8.dp).clearAndSetSemantics { })
            }
            group.items.take(if(expanded) group.items.size else 1).forEach { item ->
                Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable { onOpenDocument(group.documentId,group.documentTitle,item.anchor,item.target) }
                    .padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Text(item.sectionPath.uppercase(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(highlightedSnippet(item.snippet,item.highlightedRanges),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurface)
                }
            }
            val more=group.items.size-1
            val fragmentLabel=if(more%100 in 11..14) "фрагментов" else when(more%10) { 1 -> "фрагмент";2,3,4 -> "фрагмента";else -> "фрагментов" }
            if(more>0) NativePaperButton(
                if(expanded) "Свернуть фрагменты" else "Ещё $more $fragmentLabel",
                {expanded=!expanded},Modifier.fillMaxWidth(),glyph=if(expanded) NativeAppGlyphName.CaretUp else NativeAppGlyphName.CaretDown)
        }
    }
}

/** Thin Compose wrapper around the pure, unit-tested `snippetSegments` (text/SnippetSegments.kt). */
private fun highlightedSnippet(raw: String, ranges: List<dev.localmed.nativespike.shared.text.TextRange>) = buildAnnotatedString {
    for (segment in dev.localmed.nativespike.shared.text.snippetSegments(raw, ranges)) {
        if (segment.highlighted) {
            withStyle(style = androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold)) {
                append(segment.text)
            }
        } else {
            append(segment.text)
        }
    }
}
