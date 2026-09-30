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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeCatalogSnapshot
import dev.localmed.nativespike.shared.core.NativeDefinitionCard
import dev.localmed.nativespike.shared.core.NativeDefinitionEditionResolution
import dev.localmed.nativespike.shared.core.NativeDefinitionEditionTarget
import dev.localmed.nativespike.shared.core.NativeDefinitionTarget
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.text.formatFixed1
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Source-local search over one exact verified edition, independent of qualified lookup ranking. */
@Composable
fun NativeDefinitionCatalogScreen(
    core: NativeMedicalCore, target: NativeDefinitionEditionTarget, title: String,
    snapshot: NativeCatalogSnapshot, uiErrors: NativeUiErrors, actionScope: CoroutineScope,
    openingSource: Boolean, sourceError: String?, onBack: () -> Unit, onShowSearch: () -> Unit,
    onOpenDefinition: (NativeDefinitionTarget) -> Unit,
    registerNavigationFlush: ((suspend () -> Boolean) -> (() -> Unit))? = null,
) {
    val progress by core.installProgress.collectAsState()
    val installFailure by core.installFailure.collectAsState()
    val failures by uiErrors.messages.collectAsState()
    var resolution by remember(core, target) { mutableStateOf<NativeDefinitionEditionResolution?>(null) }
    var loadError by remember(core, target) { mutableStateOf<String?>(null) }
    var attempt by remember(core, target) { mutableStateOf(0) }
    var saveAttempt by remember(core, target) { mutableStateOf(0) }
    var query by remember(core, target) { mutableStateOf(snapshot.filterQuery) }
    var inputError by remember(core, target) { mutableStateOf<String?>(null) }
    var completedQuery by remember(core, target) { mutableStateOf<String?>(null) }
    var cards by remember(core, target) { mutableStateOf<List<NativeDefinitionCard>>(emptyList()) }
    var searching by remember(core, target) { mutableStateOf(false) }
    var searchError by remember(core, target) { mutableStateOf<String?>(null) }
    var viewportQuery by remember(core, target) { mutableStateOf<String?>(null) }
    var pendingQuery by remember(core, target) { mutableStateOf(snapshot.filterQuery) }
    var pendingIndex by remember(core, target) { mutableStateOf(snapshot.firstVisibleItemIndex) }
    var pendingOffset by remember(core, target) { mutableStateOf(snapshot.firstVisibleItemOffset) }
    var installing by remember(core, target) { mutableStateOf(false) }
    val listState = remember(core, target) { LazyListState() }
    fun currentSnapshot() = snapshot.copy(filterQuery = query,
        firstVisibleItemIndex = if (viewportQuery == query) listState.firstVisibleItemIndex else if (pendingQuery == query) pendingIndex else 0,
        firstVisibleItemOffset = if (viewportQuery == query) listState.firstVisibleItemScrollOffset else if (pendingQuery == query) pendingOffset else 0)
    suspend fun saveCurrent() = uiErrors.execute(NativeUiOperation.CatalogPosition, "Не удалось сохранить запрос или позицию справочника.") { core.saveCatalogSnapshot(currentSnapshot()) }
    fun onCurrentRoute() = core.navigation.value.let { it.readers.isEmpty() && it.catalog?.moduleId == target.moduleId && it.catalog?.moduleVersion == target.moduleVersion }
    fun leave(action: () -> Unit) { actionScope.launch { if (saveCurrent()) action() } }
    DisposableEffect(core, target, registerNavigationFlush) {
        val unregister = registerNavigationFlush?.invoke { saveCurrent() }
        onDispose { unregister?.invoke() }
    }
    LaunchedEffect(core, target, saveAttempt) {
        var savedQuery: String? = null
        snapshotFlow { currentSnapshot() }.distinctUntilChanged().collectLatest {
            if (savedQuery == it.filterQuery) delay(120)
            if (uiErrors.execute(NativeUiOperation.CatalogPosition, "Не удалось сохранить запрос или позицию справочника.") { core.saveCatalogSnapshot(it) }) savedQuery = it.filterQuery
        }
    }
    LaunchedEffect(core, target, attempt, progress == null) {
        loadError = null
        try {
            val loaded = core.resolveDefinitionEdition(target)
            if (onCurrentRoute()) resolution = loaded
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { if (onCurrentRoute()) loadError = "Не удалось открыть эту редакцию справочника. Повторите попытку." }
    }
    val installed = resolution as? NativeDefinitionEditionResolution.Installed
    LaunchedEffect(core, target, installed != null, query, attempt) {
        if (viewportQuery == query) { pendingIndex = listState.firstVisibleItemIndex; pendingOffset = listState.firstVisibleItemScrollOffset }
        else if (pendingQuery != query) { pendingIndex = 0; pendingOffset = 0 }
        pendingQuery = query
        viewportQuery = null
        cards = emptyList()
        completedQuery = null
        searchError = null
        searching = installed != null && query.isNotBlank()
        if (installed == null || query.isBlank()) return@LaunchedEffect
        val requestedQuery = query
        try {
            delay(120)
            val found = core.searchDefinitions(target, requestedQuery)
            if (query == requestedQuery && onCurrentRoute()) { cards = found; completedQuery = requestedQuery }
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { if (query == requestedQuery && onCurrentRoute()) searchError = "Не удалось выполнить поиск в этой редакции. Повторите попытку." }
        finally { if (query == requestedQuery && onCurrentRoute()) searching = false }
    }
    LaunchedEffect(core, target, completedQuery) {
        if (completedQuery != null) {
            listState.scrollToItem(pendingIndex, pendingOffset)
            viewportQuery = completedQuery
        }
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        Surface(color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = onBack) { Text("Назад") }
                    TextButton(onClick = { leave(onShowSearch) }) { Text("Поиск") }
                }
                Text(title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                Text("Требует проверки · записи в пределах источников", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Редакция: ${target.moduleVersion}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                installed?.let { Text("Записей справочника: ${it.status.entries}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                OutlinedTextField(value = query, onValueChange = {
                    inputError = nativeCatalogInputError(it)
                    if (inputError == null) query = it
                }, enabled = installed != null, label = { Text("Название или исходная фраза") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
            }
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            inputError?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface) }
            sourceError?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface) }
            if (openingSource) Text("Открываем запись…", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
            failures[NativeUiOperation.CatalogPosition]?.let {
                Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
                TextButton(onClick = { saveAttempt += 1 }) { Text("Повторить сохранение") }
            }
            val error = loadError ?: installFailure?.takeIf { it.target == target }?.message
            error?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface) }
            when (val current = resolution) {
                null -> if (error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                is NativeDefinitionEditionResolution.Unavailable -> Text(current.reason, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
                is NativeDefinitionEditionResolution.Download -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Для поиска и чтения исходных записей установите эту редакцию. После установки она доступна без интернета.", color = MaterialTheme.colorScheme.onSurface)
                    Text("Размер загрузки: ${formatFixed1(current.downloadBytes / 1048576.0)} МБ", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (progress != null || installing) NativeInstallProgressView(progress)
                    else TextButton(onClick = {
                        installing = true
                        actionScope.launch {
                            try {
                                val loaded = core.installDefinitionEdition(target)
                                if (onCurrentRoute()) resolution = loaded
                            } catch (cause: CancellationException) { throw cause }
                            catch (cause: Exception) { if (onCurrentRoute()) loadError = "Не удалось загрузить справочник. Повторите попытку." }
                            finally { installing = false }
                        }
                    }) { Text("Загрузить справочник") }
                }
                is NativeDefinitionEditionResolution.Installed -> {
                    if (searching) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (query.isBlank()) Text("Введите название или фразу из исходного текста.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
                    searchError?.let {
                        Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface)
                        TextButton(onClick = { attempt += 1 }) { Text("Повторить поиск") }
                    }
                    if (completedQuery != null) Text(if (cards.isEmpty()) "В этой редакции записи не найдены." else "Показано записей: ${cards.size} · максимум 20 за запрос",
                        Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    LazyColumn(state = listState, modifier = Modifier.fillMaxWidth().weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
                        items(cards, key = { it.id }) { card ->
                            Column(Modifier.fillMaxWidth().clickable(enabled = !openingSource) { leave { onOpenDefinition(target.entityTarget(card.id)) } }.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(card.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                                Text(nativeDefinitionEntryLabel(card), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(nativeIdentityCoverageLabel(card.coverage), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(if (card.match == "text") "Совпадение исходного текста" else "Совпадение названия", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("Исходных блоков: ${card.blockCount}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
            if (loadError != null) TextButton(onClick = { attempt += 1 }) { Text("Повторить открытие") }
        }
    }
}
