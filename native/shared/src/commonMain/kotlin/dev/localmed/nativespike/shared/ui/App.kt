package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import dev.localmed.nativespike.shared.designsystem.NativeDesign
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import dev.localmed.nativespike.shared.core.NativeCoreIdentityTarget
import dev.localmed.nativespike.shared.core.NativeDefinitionResolution
import dev.localmed.nativespike.shared.core.NativeDefinitionTarget
import dev.localmed.nativespike.shared.core.NativeCatalogSnapshot
import dev.localmed.nativespike.shared.core.NativeDocumentResolution
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.core.NativeReaderResolution
import dev.localmed.nativespike.shared.user.NativeItemKind
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.user.NativeHistoryAnalysisMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun NativeSearchSpikeApp(
    core: NativeMedicalCore,
    externalQuery: String? = null,
    onOutcome: ((query: String, outcome: SearchOutcome?, tookMs: Double, stages: Map<String, Double>) -> Unit)? = null,
    actionScope: CoroutineScope? = null,
    uiErrors: NativeUiErrors? = null,
    session: NativeCoreSession? = null,
) {
    val navigation by core.navigation.collectAsState()
    val toolCore = session?.tools?.collectAsState()?.value
    val compositionScope = rememberCoroutineScope()
    val scope = actionScope ?: compositionScope
    val errors = uiErrors ?: remember(core) { NativeUiErrors() }
    val failures by errors.messages.collectAsState()
    var searchSaveAttempt by remember(core) { mutableStateOf(0) }
    val searchState = remember(core) {
        session?.startupSearch?.restoreWhenUntouched(core.navigation.value.search) ?: NativeSearchUiState(core.navigation.value.search)
    }
    DisposableEffect(core, session) {
        val unregister = session?.registerReplayHandler { entry ->
            val query = entry.query
            val mode = if (entry.analysisMode == NativeHistoryAnalysisMode.Clinical) NativeSearchMode.CLINICAL else NativeSearchMode.LOOKUP
            core.showSearch()
            core.saveSearchSnapshot(dev.localmed.nativespike.shared.core.NativeSearchSnapshot(query, mode = mode,selection=entry.selection))
            searchState.restoreFromHistory(dev.localmed.nativespike.shared.core.NativeSearchSnapshot(query, mode = mode, selection = entry.selection))
        }
        onDispose { unregister?.invoke() }
    }
    val reader = navigation.readers.lastOrNull()
    DisposableEffect(core, session) {
        val unregister = session?.registerCollectionItemHandler { item ->
            when {
                item.reader != null -> when (val resolved = core.openReader(item.reader)) {
                    is NativeReaderResolution.Document -> (resolved.resolution as? NativeDocumentResolution.Unavailable)?.reason
                    is NativeReaderResolution.Definition -> (resolved.resolution as? NativeDefinitionResolution.Unavailable)?.reason
                }
                item.kind == NativeItemKind.Document -> when (val resolved = core.resolveDocument(item.id)) {
                    is NativeDocumentResolution.Readable -> { core.openDocument(resolved.document.target); null }
                    is NativeDocumentResolution.Download -> { core.openDocument(resolved.target); null }
                    is NativeDocumentResolution.Unavailable -> resolved.reason
                }
                else -> "Элемент отсутствует в доступном каталоге. Он сохранён в вашем списке."
            }
        }
        onDispose { unregister?.invoke() }
    }
    var opening by remember(core) { mutableStateOf(false) }
    var openingError by remember(core) { mutableStateOf<String?>(null) }

    LaunchedEffect(core, searchSaveAttempt) {
        var savedSearch: Triple<String, NativeSearchMode,NativeSearchSelection>? = null
        snapshotFlow { searchState.snapshot() }.distinctUntilChanged().collectLatest { snapshot ->
            // Query changes are durable immediately; only frequent scroll updates are debounced.
            if (savedSearch == Triple(snapshot.query,snapshot.mode,snapshot.selection)) delay(120)
            errors.execute(NativeUiOperation.SearchPosition, "Не удалось сохранить запрос или позицию поиска.") {
                core.saveSearchSnapshot(snapshot)
            }
            savedSearch = Triple(snapshot.query,snapshot.mode,snapshot.selection)
        }
    }
    val navigate = { action: suspend () -> Unit ->
        scope.launch { errors.execute(NativeUiOperation.Navigation, "Не удалось сохранить переход. Повторите действие.", action) }
        Unit
    }
    val back = { if (session != null) scope.launch { session.back() } else navigate { core.back() }; Unit }
    DisposableEffect(core, session, reader?.target, navigation.catalog?.moduleId, navigation.catalog?.moduleVersion) {
        val unregister = if (reader == null && navigation.catalog == null) session?.registerNavigationFlush {
            errors.execute(NativeUiOperation.SearchPosition, "Не удалось сохранить запрос или позицию поиска.") { core.saveSearchSnapshot(searchState.snapshot()) }
        } else null
        onDispose { unregister?.invoke() }
    }
    val routeError = listOfNotNull(openingError, failures[NativeUiOperation.Navigation], failures[NativeUiOperation.SearchPosition],failures[NativeUiOperation.ToolsState]).distinct().joinToString("\n").ifBlank { null }
    fun sameOrigin(origin: NativeCatalogSnapshot?, originQuery: String, originMode: NativeSearchMode, originSelection: NativeSearchSelection): Boolean {
        val current = core.navigation.value
        return current.readers.isEmpty() && (origin == null) == (current.catalog == null) &&
            origin?.moduleId == current.catalog?.moduleId && origin?.moduleVersion == current.catalog?.moduleVersion &&
            current.search.selection==originSelection && searchState.selection==originSelection &&
            (origin != null || (current.search.query == originQuery && current.search.mode == originMode && searchState.mode == originMode && searchState.query == originQuery && current.search.selection==originSelection && searchState.selection==originSelection))
    }
    val openSource = { id: String, anchor: String?, expected: NativeDocumentTarget? ->
        if (!opening) {
            opening = true
            openingError = null
            val origin = core.navigation.value.catalog
            val originQuery = core.navigation.value.search.query
            val originMode = core.navigation.value.search.mode
            val originSelection = searchState.selection
            scope.launch {
                try {
                    val source = core.resolveDocument(id, anchor, expected)
                    if (sameOrigin(origin, originQuery, originMode,originSelection)) {
                        when (source) {
                            is NativeDocumentResolution.Readable -> core.openDocument(source.document.target)
                            is NativeDocumentResolution.Download -> core.openDocument(source.target)
                            is NativeDocumentResolution.Unavailable -> openingError = source.reason
                        }
                    }
                } catch (cause: CancellationException) { throw cause }
                catch (cause: Exception) { if (sameOrigin(origin, originQuery, originMode,originSelection)) openingError = "Не удалось открыть источник. Повторите попытку." }
                finally { opening = false }
            }
        }
    }

    val openDefinition = { target: NativeDefinitionTarget ->
        if (!opening) {
            opening = true
            openingError = null
            val origin = core.navigation.value.catalog
            val originQuery = core.navigation.value.search.query
            val originMode = core.navigation.value.search.mode
            val originSelection = searchState.selection
            scope.launch {
                try {
                    val source = core.resolveDefinition(target)
                    if (sameOrigin(origin, originQuery, originMode,originSelection)) {
                        if (source is NativeDefinitionResolution.Unavailable) openingError = source.reason
                        else core.openDefinition(target)
                    }
                } catch (cause: CancellationException) { throw cause }
                catch (cause: Exception) { if (sameOrigin(origin, originQuery, originMode,originSelection)) openingError = "Не удалось открыть запись источника. Повторите попытку." }
                finally { opening = false }
            }
        }
        Unit
    }
    val openIdentity = { hit: NativeCoreIdentityHit ->
        when (val target = hit.target) {
            is NativeCoreIdentityTarget.Document -> {
                val exact = target.documentTarget()
                openSource(exact.documentId, exact.anchor, exact)
            }
            is NativeCoreIdentityTarget.Definition -> openDefinition(target)
        }
        Unit
    }

    NativeSpikeTheme {
        Box(Modifier.fillMaxSize().background(NativeDesign.colors.background)) {
            if (reader == null) {
                val catalog = navigation.catalog
                if (catalog == null) {
                    SearchScreen(remember(core) { NativeSearchActions(core) }, searchState, openingSource = opening, sourceError = routeError,
                        onRetrySave = if (failures[NativeUiOperation.SearchPosition] != null) ({ searchSaveAttempt += 1 }) else null,
                        onOpenSources = { navigate { core.openCatalog() } }, onOpenIdentity = openIdentity,
                        onOpenSettings = session?.let { { scope.launch { it.openPanel(NativeUserPanel.Settings) }; Unit } },
                        onOpenHistory = session?.let { { scope.launch { it.openPanel(NativeUserPanel.History) }; Unit } },
                        toolCore = toolCore,
                        onOpenTools = session?.let { { scope.launch { it.openTools() };Unit } },
                        onOpenToolSection = session?.let { { kind -> scope.launch { it.openTools(kind) }; Unit } },
                        onOpenTool = session?.let { { record -> scope.launch { it.openTool(record.id) };Unit } },
                        onSaveTool = session?.let { { item -> scope.launch { it.openCollections(item) };Unit } },
                        onOpenCollections = session?.let { { scope.launch { it.openCollections() }; Unit } },
                        onCompletedSearch = session?.let { { query, outcome -> scope.launch { it.recordSearch(query, outcome.groups.size, outcome.mode,outcome.selection) }; Unit } },
                        onOpenDocument = { id, _, anchor, target -> openSource(id, anchor, target) },
                        externalQuery = externalQuery, onOutcome = onOutcome)
                } else {
                    NativeSourcesScreen(core, catalog, errors, scope, opening, routeError, onBack = back,
                        onShowSearch = { navigate { core.showSearch() } },
                        onOpenModule = { offer -> navigate { core.openCatalog(offer.id, offer.version) } },
                        onOpenDocument = { document -> openSource(document.target.documentId, document.target.anchor, document.target) },
                        onOpenDefinition = openDefinition, onContentInstalled = searchState::invalidateResults, registerNavigationFlush = session?.let { it::registerNavigationFlush })
                }
            } else {
                NativeReaderPane(core, reader, errors, scope, onBack = back,
                    onContentInstalled = searchState::invalidateResults,
                    onSaveItem = session?.let { { title -> scope.launch { it.openReaderCollections(title) }; Unit } },
                    registerNavigationFlush = session?.let { it::registerNavigationFlush })
            }
        }
    }
}
