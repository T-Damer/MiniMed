package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeCatalogDocument
import dev.localmed.nativespike.shared.core.NativeCatalogSnapshot
import dev.localmed.nativespike.shared.core.NativeDefinitionTarget
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.core.NativeModuleOffer
import dev.localmed.nativespike.shared.text.formatFixed1
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun NativeSourcesScreen(
    core: NativeMedicalCore, snapshot: NativeCatalogSnapshot, uiErrors: NativeUiErrors, actionScope: CoroutineScope,
    openingSource: Boolean, sourceError: String?,
    onBack: () -> Unit, onShowSearch: () -> Unit,
    onOpenModule: (NativeModuleOffer) -> Unit,
    onOpenDocument: (NativeCatalogDocument) -> Unit,
    onOpenDefinition: (NativeDefinitionTarget) -> Unit,
    registerNavigationFlush: ((suspend () -> Boolean) -> (() -> Unit))? = null,
) {
    var offers by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<List<NativeModuleOffer>?>(null) }
    var documents by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<List<NativeCatalogDocument>?>(null) }
    var error by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }
    LaunchedEffect(core, snapshot.moduleId, snapshot.moduleVersion, attempt) {
        error = null
        try {
            offers = core.moduleOffers().sortedWith(compareBy<NativeModuleOffer> { it.unsupportedReason != null }.thenBy { it.title })
            if (snapshot.moduleId != null && offers.orEmpty().none { it.id == snapshot.moduleId && it.version == snapshot.moduleVersion }) {
                error = "Эта редакция набора отсутствует в текущем каталоге."
            } else documents = snapshot.moduleId?.let { core.moduleDocuments(it, requireNotNull(snapshot.moduleVersion)) }
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { error = "Не удалось открыть каталог источников. Повторите попытку." }
    }
    val selected = offers?.singleOrNull { it.id == snapshot.moduleId && it.version == snapshot.moduleVersion }
    selected?.definitionEditionTarget?.let { target ->
        NativeDefinitionCatalogScreen(core, target, selected.title, snapshot, uiErrors, actionScope,
            openingSource, sourceError, onBack, onShowSearch, onOpenDefinition, registerNavigationFlush)
        return
    }
    var saveAttempt by remember { mutableStateOf(0) }
    var filterQuery by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf(snapshot.filterQuery) }
    var positionFilter by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf(snapshot.filterQuery) }
    var filterInputError by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val failures by uiErrors.messages.collectAsState()
    var positioned by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf(false) }
    val listState = remember(core, snapshot.moduleId, snapshot.moduleVersion) {
        LazyListState(snapshot.firstVisibleItemIndex, snapshot.firstVisibleItemOffset)
    }
    fun currentSnapshot() = snapshot.copy(filterQuery = filterQuery,
        firstVisibleItemIndex = if (positionFilter != filterQuery) 0 else if (positioned) listState.firstVisibleItemIndex else snapshot.firstVisibleItemIndex,
        firstVisibleItemOffset = if (positionFilter != filterQuery) 0 else if (positioned) listState.firstVisibleItemScrollOffset else snapshot.firstVisibleItemOffset)
    DisposableEffect(core, snapshot.moduleId, snapshot.moduleVersion, registerNavigationFlush) {
        val unregister = registerNavigationFlush?.invoke {
            uiErrors.execute(NativeUiOperation.CatalogPosition, "Не удалось сохранить фильтр или позицию в каталоге.") { core.saveCatalogSnapshot(currentSnapshot()) }
        }
        onDispose { unregister?.invoke() }
    }
    fun leaveCatalog(action: () -> Unit) {
        scope.launch {
            if (uiErrors.execute(NativeUiOperation.CatalogPosition, "Не удалось сохранить фильтр или позицию в каталоге.") {
                core.saveCatalogSnapshot(currentSnapshot())
            }) action()
        }
    }
    LaunchedEffect(filterQuery) {
        if (positionFilter != filterQuery) {
            listState.scrollToItem(0)
            positionFilter = filterQuery
            positioned = true
        }
    }
    LaunchedEffect(core, snapshot.moduleId, snapshot.moduleVersion, saveAttempt, offers != null) {
        if (offers == null) return@LaunchedEffect
        var savedFilter: String? = null
        snapshotFlow { currentSnapshot() }
            .distinctUntilChanged().collectLatest { current ->
                if (savedFilter == current.filterQuery) delay(120)
                uiErrors.execute(NativeUiOperation.CatalogPosition, "Не удалось сохранить фильтр или позицию в каталоге.") {
                    core.saveCatalogSnapshot(current)
                }
                savedFilter = current.filterQuery
            }
    }
    LaunchedEffect(core, snapshot.moduleId, snapshot.moduleVersion, offers != null, documents != null) {
        if (!positioned && offers != null && (snapshot.moduleId == null || documents != null)) {
            listState.scrollToItem(snapshot.firstVisibleItemIndex, snapshot.firstVisibleItemOffset)
            positioned = true
        }
    }
    val indexedOffers = remember(offers) { offers.orEmpty().map { it to nativeCatalogFilterText(it.title, it.id) } }
    val indexedDocuments = remember(documents) { documents.orEmpty().map { it to nativeCatalogFilterText(it.title, it.target.documentId) } }
    val terms = remember(filterQuery) { nativeCatalogFilterTerms(filterQuery) }
    val visibleOffers = remember(indexedOffers, terms) { indexedOffers.filter { nativeCatalogFilterMatches(it.second, terms) }.map { it.first } }
    val visibleDocuments = remember(indexedDocuments, terms) { indexedDocuments.filter { nativeCatalogFilterMatches(it.second, terms) }.map { it.first } }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        Surface(color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { if (registerNavigationFlush != null) onBack() else leaveCatalog(onBack) }) { Text("Назад") }
                    TextButton(onClick = { leaveCatalog(onShowSearch) }) { Text("Поиск") }
                }
                Text(selected?.title ?: "Источники", modifier = Modifier.padding(bottom = 12.dp),
                    style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                if (snapshot.moduleId != null && selected == null) Text("Набор: ${snapshot.moduleId} · ${snapshot.moduleVersion}",
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(value = filterQuery, onValueChange = {
                    filterInputError = nativeCatalogInputError(it)
                    if (filterInputError == null) filterQuery = it
                },
                    label = { Text("Название или идентификатор") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
                filterInputError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
                if (snapshot.moduleId == null && offers != null) Text("Показано наборов: ${visibleOffers.size} из ${offers.orEmpty().size}",
                    modifier = Modifier.padding(bottom = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (snapshot.moduleId != null && documents != null) Text("Показано редакций: ${visibleDocuments.size} из ${documents.orEmpty().size}",
                    modifier = Modifier.padding(bottom = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (openingSource) Text("Открываем источник…", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
            sourceError?.let { Text(it, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface) }
            failures[NativeUiOperation.CatalogPosition]?.let {
                Text(it, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
                TextButton(onClick = { saveAttempt += 1 }) { Text("Повторить сохранение") }
            }
            if (error != null) {
                Text(error.orEmpty(), modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
                TextButton(onClick = { attempt += 1 }) { Text("Повторить") }
            } else if (offers == null || (snapshot.moduleId != null && documents == null)) {
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            }
            if (error == null && ((snapshot.moduleId == null && offers != null && visibleOffers.isEmpty()) ||
                (snapshot.moduleId != null && documents != null && visibleDocuments.isEmpty()))) {
                Text("По этому фильтру ничего не найдено.", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
            }
            LazyColumn(state = listState, modifier = Modifier.fillMaxWidth().weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
                if (snapshot.moduleId == null) items(visibleOffers, key = { it.id + "@" + it.version }) { offer ->
                    Column(Modifier.fillMaxWidth().clickable(enabled = !openingSource) { leaveCatalog { onOpenModule(offer) } }.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(offer.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                        Text("В каталоге: ${nativeCatalogCounts(offer.documentCount, offer.documentVersionCount)}",
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Набор: ${offer.version}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        offer.definitionEntryCount?.let { Text("Записей справочника: $it", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        offer.downloadBytes?.let { Text("Размер загрузки: ${formatFixed1(it / 1048576.0)} МБ",
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        offer.unsupportedReason?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                } else {
                    selected?.unsupportedReason?.let { reason -> item { Text(reason, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface) } }
                    items(visibleDocuments, key = { it.target.documentVersionId }) { document ->
                        Column(Modifier.fillMaxWidth().clickable(enabled = !openingSource) { leaveCatalog { onOpenDocument(document) } }.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(document.title ?: "Название не указано в каталоге", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                            if (document.title == null) Text("Идентификатор источника: ${document.target.documentId}",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Редакция: ${document.target.documentVersionId}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Статус в каталоге: ${nativeCatalogStatus(document.status)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }
    }
}
