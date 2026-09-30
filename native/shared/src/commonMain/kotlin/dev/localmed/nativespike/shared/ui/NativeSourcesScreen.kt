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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.core.NativeCatalogDocument
import dev.localmed.nativespike.shared.core.NativeCatalogSnapshot
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.core.NativeModuleOffer
import dev.localmed.nativespike.shared.text.formatFixed1
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged

@Composable
fun NativeSourcesScreen(
    core: NativeMedicalCore, snapshot: NativeCatalogSnapshot, uiErrors: NativeUiErrors,
    openingSource: Boolean, sourceError: String?,
    onBack: () -> Unit, onShowSearch: () -> Unit,
    onOpenModule: (NativeModuleOffer) -> Unit,
    onOpenDocument: (NativeCatalogDocument) -> Unit,
) {
    var offers by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<List<NativeModuleOffer>?>(null) }
    var documents by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<List<NativeCatalogDocument>?>(null) }
    var error by remember(core, snapshot.moduleId, snapshot.moduleVersion) { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }
    var saveAttempt by remember { mutableStateOf(0) }
    val failures by uiErrors.messages.collectAsState()
    val listState = remember(core, snapshot.moduleId, snapshot.moduleVersion) {
        LazyListState(snapshot.firstVisibleItemIndex, snapshot.firstVisibleItemOffset)
    }
    LaunchedEffect(core, snapshot.moduleId, snapshot.moduleVersion, attempt) {
        error = null
        try {
            offers = core.moduleOffers().sortedWith(compareBy<NativeModuleOffer> { it.unsupportedReason != null }.thenBy { it.title })
            documents = snapshot.moduleId?.let { core.moduleDocuments(it, requireNotNull(snapshot.moduleVersion)) }
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { error = cause.message ?: "Не удалось открыть каталог источников." }
    }
    LaunchedEffect(core, snapshot.moduleId, snapshot.moduleVersion, saveAttempt) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .distinctUntilChanged().collectLatest { (index, offset) ->
                delay(120)
                uiErrors.execute(NativeUiOperation.CatalogPosition, "Не удалось сохранить позицию в каталоге.") {
                    core.saveCatalogSnapshot(snapshot.copy(firstVisibleItemIndex = index, firstVisibleItemOffset = offset))
                }
            }
    }
    val selected = offers?.singleOrNull { it.id == snapshot.moduleId && it.version == snapshot.moduleVersion }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        Surface(color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = onBack) { Text("Назад") }
                    TextButton(onClick = onShowSearch) { Text("Поиск") }
                }
                Text(selected?.title ?: "Источники", modifier = Modifier.padding(bottom = 12.dp),
                    style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
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
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                if (snapshot.moduleId == null) items(offers.orEmpty(), key = { it.id + "@" + it.version }) { offer ->
                    Column(Modifier.fillMaxWidth().clickable(enabled = !openingSource) { onOpenModule(offer) }.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(offer.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                        Text("В каталоге: ${nativeCatalogCounts(offer.documentCount, offer.documentVersionCount)}",
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Набор: ${offer.version}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        offer.downloadBytes?.let { Text("Размер загрузки: ${formatFixed1(it / 1048576.0)} МБ",
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        offer.unsupportedReason?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                } else {
                    selected?.unsupportedReason?.let { reason -> item { Text(reason, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurface) } }
                    items(documents.orEmpty(), key = { it.target.documentVersionId }) { document ->
                        Column(Modifier.fillMaxWidth().clickable(enabled = !openingSource) { onOpenDocument(document) }.padding(16.dp),
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
