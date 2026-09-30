package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import dev.localmed.nativespike.shared.core.NativeCatalogSnapshot
import dev.localmed.nativespike.shared.core.NativeDocumentResolution
import dev.localmed.nativespike.shared.core.NativeDocumentTarget
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.model.SearchOutcome
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
    val compositionScope = rememberCoroutineScope()
    val scope = actionScope ?: compositionScope
    val errors = uiErrors ?: remember(core) { NativeUiErrors() }
    val failures by errors.messages.collectAsState()
    var searchSaveAttempt by remember(core) { mutableStateOf(0) }
    val searchState = remember(core) { NativeSearchUiState(core.navigation.value.search) }
    val reader = navigation.readers.lastOrNull()
    var opening by remember(core) { mutableStateOf(false) }
    var openingError by remember(core) { mutableStateOf<String?>(null) }

    LaunchedEffect(core, searchSaveAttempt) {
        var savedQuery: String? = null
        snapshotFlow { searchState.snapshot() }.distinctUntilChanged().collectLatest { snapshot ->
            // Query changes are durable immediately; only frequent scroll updates are debounced.
            if (savedQuery == snapshot.query) delay(120)
            errors.execute(NativeUiOperation.SearchPosition, "Не удалось сохранить запрос или позицию поиска.") {
                core.saveSearchSnapshot(snapshot)
            }
            savedQuery = snapshot.query
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
    val routeError = listOfNotNull(openingError, failures[NativeUiOperation.Navigation], failures[NativeUiOperation.SearchPosition]).distinct().joinToString("\n").ifBlank { null }
    fun sameOrigin(origin: NativeCatalogSnapshot?, originQuery: String): Boolean {
        val current = core.navigation.value
        return current.readers.isEmpty() && (origin == null) == (current.catalog == null) &&
            origin?.moduleId == current.catalog?.moduleId && origin?.moduleVersion == current.catalog?.moduleVersion &&
            (origin != null || current.search.query == originQuery)
    }
    val openSource = { id: String, anchor: String?, expected: NativeDocumentTarget? ->
        if (!opening) {
            opening = true
            openingError = null
            val origin = core.navigation.value.catalog
            val originQuery = core.navigation.value.search.query
            scope.launch {
                try {
                    val source = core.resolveDocument(id, anchor, expected)
                    if (sameOrigin(origin, originQuery)) {
                        when (source) {
                            is NativeDocumentResolution.Readable -> core.openDocument(source.document.target)
                            is NativeDocumentResolution.Download -> core.openDocument(source.target)
                            is NativeDocumentResolution.Unavailable -> openingError = source.reason
                        }
                    }
                } catch (cause: CancellationException) { throw cause }
                catch (cause: Exception) { if (sameOrigin(origin, originQuery)) openingError = "Не удалось открыть источник. Повторите попытку." }
                finally { opening = false }
            }
        }
    }

    val openIdentity = { hit: NativeCoreIdentityHit ->
        when (val target = hit.target) {
            is NativeCoreIdentityTarget.Document -> {
                val exact = target.documentTarget()
                openSource(exact.documentId, exact.anchor, exact)
            }
            is NativeCoreIdentityTarget.Definition -> if (!opening) {
                opening = true
                openingError = null
                val origin = core.navigation.value.catalog
                val originQuery = core.navigation.value.search.query
                scope.launch {
                    try {
                        val source = core.resolveDefinition(target)
                        if (sameOrigin(origin, originQuery)) {
                            if (source is NativeDefinitionResolution.Unavailable) openingError = source.reason
                            else core.openDefinition(target)
                        }
                    } catch (cause: CancellationException) { throw cause }
                    catch (cause: Exception) { if (sameOrigin(origin, originQuery)) openingError = "Не удалось открыть запись источника. Повторите попытку." }
                    finally { opening = false }
                }
            }
        }
        Unit
    }

    NativeSpikeTheme {
        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            if (reader == null) {
                val catalog = navigation.catalog
                if (catalog == null) {
                    SearchScreen(core, searchState, openingSource = opening, sourceError = routeError,
                        onRetrySave = if (failures[NativeUiOperation.SearchPosition] != null) ({ searchSaveAttempt += 1 }) else null,
                        onOpenSources = { navigate { core.openCatalog() } }, onOpenIdentity = openIdentity,
                        onOpenDocument = { id, _, anchor -> openSource(id, anchor, null) },
                        externalQuery = externalQuery, onOutcome = onOutcome)
                } else {
                    NativeSourcesScreen(core, catalog, errors, opening, routeError, onBack = back,
                        onShowSearch = { navigate { core.showSearch() } },
                        onOpenModule = { offer -> navigate { core.openCatalog(offer.id, offer.version) } },
                        onOpenDocument = { document -> openSource(document.target.documentId, document.target.anchor, document.target) },
                        registerNavigationFlush = session?.let { it::registerNavigationFlush })
                }
            } else {
                NativeReaderPane(core, reader, errors, scope, onBack = back,
                    onContentInstalled = { searchState.completedQuery = null },
                    registerNavigationFlush = session?.let { it::registerNavigationFlush })
            }
        }
    }
}
