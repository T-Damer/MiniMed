package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
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
) {
    val navigation by core.navigation.collectAsState()
    val progress by core.installProgress.collectAsState()
    val installFailure by core.installFailure.collectAsState()
    val compositionScope = rememberCoroutineScope()
    val scope = actionScope ?: compositionScope
    val errors = uiErrors ?: remember(core) { NativeUiErrors() }
    val failures by errors.messages.collectAsState()
    var searchSaveAttempt by remember(core) { mutableStateOf(0) }
    val searchState = remember(core) { NativeSearchUiState(core.navigation.value.search) }
    val reader = navigation.readers.lastOrNull()
    var resolution by remember(core) { mutableStateOf<NativeDocumentResolution?>(null) }
    var resolutionTarget by remember(core) { mutableStateOf<NativeDocumentTarget?>(null) }
    var readerError by remember(core) { mutableStateOf<String?>(null) }
    var resolutionAttempt by remember(core) { mutableStateOf(0) }
    var installingTarget by remember(core) { mutableStateOf<NativeDocumentTarget?>(null) }
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
    LaunchedEffect(core, reader?.target, resolutionAttempt, progress == null) {
        val target = reader?.target ?: return@LaunchedEffect
        if (progress != null && resolutionTarget == target && resolution != null) return@LaunchedEffect
        resolutionTarget = target
        resolution = null
        readerError = null
        try {
            val loaded = core.resolveDocument(target.documentId, target.anchor, target)
            if (core.navigation.value.readers.lastOrNull()?.target == target) resolution = loaded
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            if (core.navigation.value.readers.lastOrNull()?.target == target) {
                readerError = "Не удалось открыть источник. Повторите попытку."
                resolution = NativeDocumentResolution.Unavailable("Не удалось открыть источник.")
            }
        }
    }
    val navigate = { action: suspend () -> Unit ->
        scope.launch { errors.execute(NativeUiOperation.Navigation, "Не удалось сохранить переход. Повторите действие.", action) }
        Unit
    }
    val back = { navigate { core.back() } }
    val routeError = listOfNotNull(openingError, failures[NativeUiOperation.Navigation], failures[NativeUiOperation.SearchPosition]).distinct().joinToString("\n").ifBlank { null }
    val openSource = { id: String, anchor: String?, expected: NativeDocumentTarget? ->
        if (!opening) {
            opening = true
            openingError = null
            val origin = core.navigation.value.catalog
            val originQuery = core.navigation.value.search.query
            scope.launch {
                try {
                    val source = core.resolveDocument(id, anchor, expected)
                    val current = core.navigation.value
                    val sameRoute = (origin == null) == (current.catalog == null) &&
                        origin?.moduleId == current.catalog?.moduleId && origin?.moduleVersion == current.catalog?.moduleVersion
                    if (current.readers.isEmpty() && sameRoute && (origin != null || current.search.query == originQuery)) {
                        when (source) {
                            is NativeDocumentResolution.Readable -> core.openDocument(source.document.target)
                            is NativeDocumentResolution.Download -> core.openDocument(source.target)
                            is NativeDocumentResolution.Unavailable -> openingError = source.reason
                        }
                    }
                } catch (cause: CancellationException) { throw cause }
                catch (cause: Exception) { openingError = "Не удалось открыть источник. Повторите попытку." }
                finally { opening = false }
            }
        }
    }

    NativeSpikeTheme {
        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            if (reader == null) {
                val catalog = navigation.catalog
                if (catalog == null) {
                    SearchScreen(core, searchState, openingSource = opening, sourceError = routeError,
                        onRetrySave = if (failures[NativeUiOperation.SearchPosition] != null) ({ searchSaveAttempt += 1 }) else null,
                        onOpenSources = { navigate { core.openCatalog() } },
                        onOpenDocument = { id, _, anchor -> openSource(id, anchor, null) },
                        externalQuery = externalQuery, onOutcome = onOutcome)
                } else {
                    NativeSourcesScreen(core, catalog, errors, opening, routeError, onBack = back,
                        onShowSearch = { navigate { core.showSearch() } },
                        onOpenModule = { offer -> navigate { core.openCatalog(offer.id, offer.version) } },
                        onOpenDocument = { document -> openSource(document.target.documentId, document.target.anchor, document.target) })
                }
            } else {
                when (val current = if (resolutionTarget == reader.target) resolution else null) {
                    is NativeDocumentResolution.Readable -> ReaderScreen(current.document, reader,
                        error = listOfNotNull(readerError, failures[NativeUiOperation.Navigation], failures[NativeUiOperation.ReaderPosition]).distinct().joinToString("\n").ifBlank { null },
                        saveFailed = failures[NativeUiOperation.ReaderPosition] != null,
                        onSavePosition = { snapshot -> errors.execute(NativeUiOperation.ReaderPosition, "Не удалось сохранить позицию чтения.") { core.saveReaderSnapshot(snapshot) } }, onBack = back)
                    else -> NativeDocumentStatus(
                        resolution = current, progress = progress,
                        error = listOfNotNull(readerError, installFailure?.takeIf { it.target == reader.target }?.message,
                            failures[NativeUiOperation.Navigation]).distinct().joinToString("\n").ifBlank { null },
                        installing = installingTarget != null || progress != null,
                        onBack = back,
                        onRetry = { resolutionAttempt += 1 },
                        onInstall = {
                            if (current is NativeDocumentResolution.Download && installingTarget == null && progress == null) {
                                val target = reader.target
                                installingTarget = target
                                readerError = null
                                scope.launch {
                                    try {
                                        val installed = core.install(target)
                                        searchState.completedQuery = null
                                        if (core.navigation.value.readers.lastOrNull()?.target == target) resolution = installed
                                    } catch (cause: CancellationException) {
                                        throw cause
                                    } catch (cause: Exception) {
                                        if (core.navigation.value.readers.lastOrNull()?.target == target) {
                                            readerError = "Не удалось загрузить источник. Повторите попытку."
                                        }
                                    } finally {
                                        installingTarget = null
                                    }
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}
