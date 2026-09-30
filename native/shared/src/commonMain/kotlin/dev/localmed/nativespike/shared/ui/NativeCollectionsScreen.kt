package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.user.NativeItemCollection
import dev.localmed.nativespike.shared.user.NativeItemRef
import dev.localmed.nativespike.shared.user.NATIVE_COLLECTION_ITEM_LIMIT
import dev.localmed.nativespike.shared.user.NATIVE_COLLECTION_LIMIT
import dev.localmed.nativespike.shared.user.nativeCollectionNameError
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, ExperimentalTime::class, ExperimentalUuidApi::class)
@Composable
fun NativeCollectionsScreen(session: NativeCoreSession) {
    val snapshot by session.collectionsState.snapshot.collectAsState()
    val selectedItem by session.collectionItem.collectAsState()
    val errors by session.uiErrors.messages.collectAsState()
    var favorites by remember(session) { mutableStateOf(true) }
    var selectedId by remember(session) { mutableStateOf<String?>(null) }
    var saving by remember(session) { mutableStateOf(false) }
    var editingName by remember(session) { mutableStateOf(false) }
    var renaming by remember(session) { mutableStateOf<NativeItemCollection?>(null) }
    var deleting by remember(session) { mutableStateOf<NativeItemCollection?>(null) }
    var name by remember(session) { mutableStateOf("") }
    LaunchedEffect(session) { session.loadCollections() }
    val mutate = { action: suspend () -> Unit ->
        if (!saving && snapshot != null) {
            saving = true
            session.actionScope.launch {
                try { session.uiErrors.execute(NativeUiOperation.Collections, "Не удалось сохранить изменение. Повторите действие.", action) }
                finally { saving = false }
            }
        }
        Unit
    }
    val now = { Clock.System.now().toString() }
    val open = { item: NativeItemRef ->
        if (!saving) {
            saving = true
            session.actionScope.launch {
                try { session.openCollectionItem(item) }
                finally { saving = false }
            }
        }
        Unit
    }
    val state = snapshot
    val selected = state?.collections?.find { it.id == selectedId }
    ModalBottomSheet(onDismissRequest = { session.actionScope.launch { session.back() } }, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NativePaperIconButton(NativeAppGlyphName.ArrowLeft, { session.actionScope.launch { session.back() } }, "Назад", primary = true)
                Text(if (selectedItem == null) "Избранное и коллекции" else "Сохранить элемент", style = MaterialTheme.typography.titleMedium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(top = 8.dp))
            }
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), contentPadding = PaddingValues(top = 12.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        listOf(NativeUiOperation.CollectionsState, NativeUiOperation.Collections, NativeUiOperation.Navigation, NativeUiOperation.ReaderPosition).forEach { operation ->
                            errors[operation]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        }
                        if (state == null) NativePaperButton(text = "Повторить чтение", onClick = { session.actionScope.launch { session.loadCollections() } })
                    }
                }
                if (state != null && selectedItem != null) {
                    val item = requireNotNull(selectedItem)
                    val favorite = state.favorites.any { it.kind == item.kind && it.id == item.id }
                    item {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            Text(item.title ?: item.id, style = MaterialTheme.typography.titleMedium)
                            NativePaperButton(text = if (favorite) "Убрать из избранного" else "В избранное", enabled = !saving && (favorite || state.favorites.size < NATIVE_COLLECTION_ITEM_LIMIT), onClick = {
                                mutate { session.collectionsState.toggleFavorite(item, now()) }
                            })
                            if (!favorite && state.favorites.size >= NATIVE_COLLECTION_ITEM_LIMIT)
                                Text("В избранном может быть не больше $NATIVE_COLLECTION_ITEM_LIMIT элементов.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Коллекции", style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    items(state.collections, key = { "membership:${it.id}" }) { collection ->
                        val included = collection.items.any { it.kind == item.kind && it.id == item.id }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            Checkbox(checked = included, enabled = !saving && (included || collection.items.size < NATIVE_COLLECTION_ITEM_LIMIT), onCheckedChange = { value ->
                                mutate { session.collectionsState.setItem(collection.id, item, value, now()) }
                            })
                            Column(Modifier.weight(1f)) {
                                Text(collection.name, modifier = Modifier.padding(top = 12.dp))
                                if (!included && collection.items.size >= NATIVE_COLLECTION_ITEM_LIMIT)
                                    Text("Коллекция заполнена: $NATIVE_COLLECTION_ITEM_LIMIT элементов.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                } else if (state != null) {
                    item {
                        FlowRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            NativePaperButton(text = "Избранное", onClick = { favorites = true; selectedId = null })
                            NativePaperButton(text = "Коллекции", onClick = { favorites = false; selectedId = null })
                        }
                    }
                    when {
                        favorites -> {
                            item { Text("Избранных элементов: ${state.favorites.size}", modifier = Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            items(state.favorites, key = { "favorite:${it.kind}:${it.id}" }) { item ->
                                NativeCollectionItemRow(item, !saving, onOpen = { open(item) },
                                    onRemove = { mutate { session.collectionsState.toggleFavorite(item, now()) } })
                            }
                        }
                        selected != null -> {
                            item {
                                Column(Modifier.padding(horizontal = 16.dp)) {
                                    Text(selected.name, style = MaterialTheme.typography.titleMedium)
                                    Text("Элементов: ${selected.items.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    FlowRow {
                                        NativePaperIconButton(NativeAppGlyphName.Edit, { renaming = selected; name = selected.name; editingName = true }, "Переименовать коллекцию", enabled = !saving)
                                        NativePaperIconButton(NativeAppGlyphName.Trash, { deleting = selected }, "Удалить коллекцию", enabled = !saving)
                                    }
                                }
                            }
                            items(selected.items, key = { "item:${it.kind}:${it.id}" }) { item ->
                                NativeCollectionItemRow(item, !saving, onOpen = { open(item) },
                                    onRemove = { mutate { session.collectionsState.setItem(selected.id, item, false, now()) } })
                            }
                        }
                        else -> items(state.collections, key = { it.id }) { collection ->
                            NativePaperSurface(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clickable { selectedId = collection.id }) {
                                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                                    Text(collection.name, style = MaterialTheme.typography.titleMedium)
                                    Text("Элементов: ${collection.items.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
                if (state != null) item {
                    NativePaperButton(text = "Создать коллекцию", glyph = NativeAppGlyphName.Plus, enabled = !saving && state.collections.size < NATIVE_COLLECTION_LIMIT, modifier = Modifier.padding(horizontal = 8.dp), onClick = { name = ""; renaming = null; editingName = true })
                }
            }
        }
    }
    if (editingName && state != null) {
        val error = nativeCollectionNameError(state, name, renaming?.id)
        AlertDialog(onDismissRequest = { if (!saving) editingName = false }, title = { Text(if (renaming == null) "Новая коллекция" else "Название коллекции") },
            text = { Column { NativePaperTextField(value = name, onValueChange = { name = it }, label = "Название", singleLine = true, enabled = !saving); if (error != null && name.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error) } },
            confirmButton = { NativePaperButton(text = "Сохранить", enabled = !saving && error == null, onClick = {
                val existing = renaming
                val submittedName = name
                val item = selectedItem
                val at = now()
                val id = existing?.id ?: Uuid.random().toString()
                mutate {
                    if (existing == null) session.collectionsState.createCollection(id, submittedName, at, listOfNotNull(item))
                    else session.collectionsState.renameCollection(id, submittedName)
                    editingName = false
                }
            }) }, dismissButton = { NativePaperButton(text = "Отмена", enabled = !saving, onClick = { editingName = false }) })
    }
    deleting?.let { collection ->
        AlertDialog(onDismissRequest = { if (!saving) deleting = null }, title = { Text("Удалить коллекцию «${collection.name}»?") },
            text = { Text("Её элементы останутся в избранном и других коллекциях.") },
            confirmButton = { NativePaperButton(text = "Удалить", enabled = !saving, onClick = { mutate { session.collectionsState.deleteCollection(collection.id); selectedId = null; deleting = null } }) },
            dismissButton = { NativePaperButton(text = "Отмена", enabled = !saving, onClick = { deleting = null }) })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NativeCollectionItemRow(item: NativeItemRef, enabled: Boolean, onOpen: () -> Unit, onRemove: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text(item.title ?: item.id, style = MaterialTheme.typography.titleMedium)
        item.reader?.let { route ->
            val version = when (route) {
                is dev.localmed.nativespike.shared.core.NativeReaderRoute.Document -> route.target.moduleVersion ?: route.target.documentVersionId
                is dev.localmed.nativespike.shared.core.NativeReaderRoute.Definition -> route.target.moduleVersion
            }
            Text("Редакция: $version", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FlowRow {
            NativePaperButton(text = "Открыть", enabled = enabled, onClick = onOpen)
            NativePaperIconButton(NativeAppGlyphName.Close, onRemove, "Убрать из списка", enabled = enabled)
        }
    }
}
