package dev.localmed.nativespike.shared.ui

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import dev.localmed.nativespike.shared.designsystem.NativeDimensions
import dev.localmed.nativespike.shared.designsystem.NativeIconButton
import dev.localmed.nativespike.shared.designsystem.NativeStatusCard
import dev.localmed.nativespike.shared.designsystem.NativeSecondaryButton
import dev.localmed.nativespike.shared.designsystem.NativeActionButton
import dev.localmed.nativespike.shared.designsystem.NativeQueryProgress
import dev.localmed.nativespike.shared.designsystem.textStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchScope
import dev.localmed.nativespike.shared.tools.NativeToolCore
import dev.localmed.nativespike.shared.tools.NativeToolRecord
import dev.localmed.nativespike.shared.tools.NativeToolKind
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

private val HOME_GAP = NativeDimensions.space4

@Composable
fun SearchScreen(
    core: NativeSearchActions?,
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
    onOpenToolSection: ((NativeToolKind) -> Unit)? = null,
    onOpenTool: ((NativeToolRecord) -> Unit)? = null,
    onSaveTool: ((NativeItemRef) -> Unit)? = null,
    onCompletedSearch: ((String, SearchOutcome) -> Unit)? = null,
    onRetrySave: (() -> Unit)? = null,
    coreProgress: NativeQueryProgress? = null,
    coreError: String? = null,
    onRetryCore: (() -> Unit)? = null,
    retryCoreLabel: String = "Повторить чтение базы",
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
    var homeData by remember { mutableStateOf<NativeHomeData?>(null) }
    var homeError by remember { mutableStateOf<String?>(null) }
    var homeAttempt by remember { mutableStateOf(0) }
    LaunchedEffect(homeAttempt) {
        homeError = null
        try { homeData = bundledNativeHomeData() }
        catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { homeError = "Не удалось прочитать данные главной страницы." }
    }
    val queryFocus = remember(core) { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(externalQuery) {
        if (externalQuery != null) state.updateQuery(externalQuery)
    }
    var identities by remember(core, state.query, state.mode,state.selection) { mutableStateOf<List<NativeCoreIdentityHit>>(emptyList()) }
    var identitiesLoading by remember(core, state.query, state.mode,state.selection) { mutableStateOf(false) }
    var identitiesError by remember(core, state.query, state.mode,state.selection) { mutableStateOf<String?>(null) }
    LaunchedEffect(core, state.query, state.mode,state.selection, state.attempt) {
        if (core == null) return@LaunchedEffect
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
        if (core == null) return@LaunchedEffect
        val requestQuery = state.query
        val requestMode = state.mode
        val requestSelection = state.selection
        val restoredPosition = state.takePendingPosition()
        if (restoredPosition != null || state.positionQuery != requestQuery || state.positionMode != requestMode || state.positionSelection != requestSelection) {
            state.listState.scrollToItem(restoredPosition?.firstVisibleItemIndex ?: 0, restoredPosition?.firstVisibleItemOffset ?: 0)
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
                state.completeQueuedQuery(requestQuery)
            }
        }
    }

    NativeChromeScaffold(
        containerColor = NativeDesign.colors.background,
        scrolled = state.listState.firstVisibleItemIndex > 0 || state.listState.firstVisibleItemScrollOffset > 0,
        desk = true,
        topBar = {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal=HOME_GAP,vertical=NativeDimensions.space2),verticalAlignment=Alignment.CenterVertically, horizontalArrangement=Arrangement.spacedBy(NativeDimensions.space2)) {
                onOpenHistory?.let { action -> NativeIconButton(NativeDesign.components.historyFab, "search-history-fab", "История поиска", action) { tint -> NativeAppGlyph(NativeAppGlyphName.History, Modifier.size(NativeDimensions.space5), tint) } }
                Spacer(Modifier.weight(1f))
                NativeOpenFileButton()
                NativeIconButton(NativeDesign.components.routeIconButton, "route-icon-button", "Источники", onOpenSources, enabled = core != null) {
                    NativeAppGlyph(NativeAppGlyphName.Books, Modifier.size(NativeDimensions.space5), it)
                }
                onOpenTools?.let { open -> NativeIconButton(NativeDesign.components.routeIconButton, "route-icon-button", "Инструменты", open) {
                    NativeAppGlyph(NativeAppGlyphName.Calculator, Modifier.size(NativeDimensions.space5), it)
                } }
            }
        },
    ) { padding ->
        val groups = state.outcome?.groups.orEmpty()
        LazyColumn(
            modifier = Modifier.fillMaxSize().navigationBarsPadding(), state = state.listState,
            contentPadding = PaddingValues(start=HOME_GAP,end=HOME_GAP,top=padding.calculateTopPadding()+NativeDimensions.space2,bottom=NativeDimensions.space2+padding.calculateBottomPadding()),
            verticalArrangement = Arrangement.spacedBy(NativeDimensions.borderHairline),
        ) {
            item(key="search-controls") {
            Column(Modifier.fillMaxWidth()) {
            NativeSearchControls(state, queryFocus, core != null, coreProgress)
            coreError?.let { BasicText(it, style = NativeDesign.components.coreStatusDetail.text.textStyle()) }
            onRetryCore?.let { retry -> NativeActionButton(retryCoreLabel, retry) }
            if (openingSource) BasicText("Открываем источник…", modifier = Modifier.padding(horizontal = HOME_GAP),
                style = NativeDesign.components.coreStatusDetail.text.textStyle())
            sourceError?.let { BasicText(it, modifier = Modifier.padding(horizontal = HOME_GAP),
                style = NativeDesign.components.coreStatusDetail.text.textStyle()) }
            onRetrySave?.let { retry -> NativeSecondaryButton("Повторить сохранение", retry, Modifier.padding(horizontal = HOME_GAP)) }
            state.inputError?.let { BasicText(it, style = NativeDesign.components.coreStatusDetail.text.textStyle(), modifier = Modifier.padding(horizontal = HOME_GAP)) }
            identitiesError?.let {
                BasicText(it, style = NativeDesign.components.coreStatusDetail.text.textStyle(), modifier = Modifier.padding(horizontal = HOME_GAP))
                NativeSecondaryButton("Повторить чтение названий", { state.attempt += 1 })
            }
            if (state.mode == NativeSearchMode.LOOKUP) NativeIdentityRail(identities, openingSource, onOpenIdentity)
            if (state.error != null) {
                BasicText(
                    state.error ?: "Не удалось выполнить поиск.",
                    style = NativeDesign.components.coreStatusDetail.text.textStyle(),
                    modifier = Modifier.padding(HOME_GAP),
                )
                NativeSecondaryButton("Повторить поиск", { state.attempt += 1 }, Modifier.padding(horizontal = HOME_GAP))
            }

            if (!state.loading && !identitiesLoading && state.error == null && identitiesError == null && state.completedQuery != null && groups.isEmpty() && identities.isEmpty()) {
                BasicText("По этому запросу источники не найдены.", style = NativeDesign.components.coreStatusDetail.text.textStyle(), modifier = Modifier.padding(HOME_GAP))
            }
            }
            }
                if (state.query.isBlank()) {
                    homeError?.let { message -> item(key="home-error") {
                        NativeStatusCard("Главная страница", message)
                        NativeActionButton("Повторить чтение", { homeAttempt += 1 })
                    } }
                    homeData?.let { data -> item(key="search-home-intro") {
                        NativeSearchHomeContent(data, toolCore, onOpenTools,
                            onOpenSection = { section ->
                                if (section.countEntity == "tool") {
                                    onOpenToolSection?.invoke(if (section.id == "calculators") NativeToolKind.Calculator else NativeToolKind.Assessment)
                                        ?: onOpenTools?.invoke()
                                }
                                else {
                                    val scope = NativeSearchScope.entries.first { it.name.lowercase() == section.id }
                                    state.selectSection(scope, resetSpecialties = true)
                                }
                            },
                            onExample = { example -> state.updateQuery(example); state.submit(core == null) },
                            scope = if (state.mode == NativeSearchMode.CLINICAL) NativeSearchScope.DIAGNOSIS else state.selection.scope,
                            showIntro = state.query.isEmpty(),
                        )
                    } }
                }
                if(toolCore!=null && onOpenTool!=null && onSaveTool!=null && onOpenTools!=null && state.query.isNotBlank() && state.mode == NativeSearchMode.LOOKUP && state.selection.scope in listOf(NativeSearchScope.ALL, NativeSearchScope.DIAGNOSIS)) {
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
                    NativeSearchResultCard(group = group,index=index, onOpenDocument = onOpenDocument)
                }
        }
    }
}
