package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import dev.localmed.nativespike.shared.designsystem.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.localmed.nativespike.shared.user.NativeItemCollection
import dev.localmed.nativespike.shared.user.NativeItemRef
import dev.localmed.nativespike.shared.user.NATIVE_COLLECTION_ITEM_LIMIT
import dev.localmed.nativespike.shared.user.NATIVE_COLLECTION_LIMIT
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlinx.coroutines.launch

/** Session navigation restores the last folder; reselecting Files returns to its root. */
internal class NativeLibraryUiState {
    var favorites by mutableStateOf(false)
    var selectedId by mutableStateOf<String?>(null)
    var query by mutableStateOf("")
    var grid by mutableStateOf(true)
    val list = androidx.compose.foundation.lazy.LazyListState()

    fun showRoot() {
        favorites = false; selectedId = null; query = ""
        list.requestScrollToItem(0)
    }

    fun openFolder(id: String?) {
        favorites = id == null; selectedId = id; query = ""
        list.requestScrollToItem(0)
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalTime::class)
@Composable
fun NativeCollectionsScreen(session: NativeCoreSession) {
    val snapshot by session.collectionsState.snapshot.collectAsState()
    val selectedItem by session.collectionItem.collectAsState()
    val errors by session.uiErrors.messages.collectAsState()
    var favorites by session.library::favorites
    var query by session.library::query
    var grid by session.library::grid
    val pickFile = LocalNativeOpenFile.current
    val list = session.library.list
    var selectedId by session.library::selectedId
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
    val components = NativeDesign.components
    val navigationBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    NativeChromeScaffold(containerColor = NativeDesign.colors.background, desk = true,
        scrolled = list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > 0,
        topBar = {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(NativeDimensions.space2), horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space3), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                NativeIconButton(components.backButton, "back-button", "Назад", {
                    if (selectedItem == null && (favorites || selectedId != null)) { session.library.showRoot() }
                    else session.actionScope.launch { session.back() }
                }, icon = nativeCollectionGlyph(NativeAppGlyphName.ArrowLeft))
                NativeSearchField(query, { query = it }, "Название или элемент", Modifier.weight(1f), icon = nativeCollectionGlyph(NativeAppGlyphName.Search))
                if (selectedItem == null) NativeOpenFileButton()
            }
        },
    ) { padding ->
            LazyColumn(Modifier.fillMaxSize().testTag("user-library-page"), state = list,
                contentPadding = PaddingValues(start = NativeDimensions.space2, end = NativeDimensions.space2,
                    top = padding.calculateTopPadding() + NativeDimensions.space2,
                    bottom = padding.calculateBottomPadding() + navigationBottom + NativeDimensions.space3),
                verticalArrangement = Arrangement.spacedBy(NativeDimensions.space3)) {
                item {
                    NativeBreadcrumbs(buildList {
                        add(NativeCrumb("Ваши файлы", nativeCollectionGlyph(NativeAppGlyphName.House)))
                        if (selectedItem != null) add(NativeCrumb("Сохранить элемент"))
                        else if (favorites) add(NativeCrumb("Избранное"))
                        else selected?.let { add(NativeCrumb(it.name)) }
                    }, { session.library.showRoot() }, Modifier.testTag("user-library-breadcrumbs"))
                }
                item {
                    Column(Modifier.padding(horizontal = NativeDimensions.space4)) {
                        listOf(NativeUiOperation.CollectionsState, NativeUiOperation.Collections, NativeUiOperation.Navigation, NativeUiOperation.ReaderPosition).forEach { operation ->
                            errors[operation]?.let { BasicText(it, style = NativeDesign.components.coreStatusDetail.text.textStyle()) }
                        }
                        if (state == null) NativePrimaryButton(text = "Повторить чтение", onClick = { session.actionScope.launch { session.loadCollections() } })
                    }
                }
                if (state != null && selectedItem != null) {
                    val item = requireNotNull(selectedItem)
                    val favorite = state.favorites.any { it.kind == item.kind && it.id == item.id }
                    item {
                        Column(Modifier.fillMaxWidth().padding(horizontal = NativeDimensions.space4)) {
                            NativeSectionHeading(item.title ?: item.id)
                            NativePrimaryButton(text = if (favorite) "Убрать из избранного" else "В избранное", enabled = !saving && (favorite || state.favorites.size < NATIVE_COLLECTION_ITEM_LIMIT), onClick = {
                                mutate { session.collectionsState.toggleFavorite(item, now()) }
                            })
                            if (!favorite && state.favorites.size >= NATIVE_COLLECTION_ITEM_LIMIT)
                                BasicText("В избранном может быть не больше $NATIVE_COLLECTION_ITEM_LIMIT элементов.", style = NativeDesign.components.coreStatusDetail.text.textStyle())
                            NativeSectionHeading("Коллекции")
                        }
                    }
                    items(state.collections, key = { "membership:${it.id}" }) { collection ->
                        val included = collection.items.any { it.kind == item.kind && it.id == item.id }
                        val enabled = !saving && (included || collection.items.size < NATIVE_COLLECTION_ITEM_LIMIT)
                        NativePaperSheet {
                            NativeSettingSwitch(collection.name, included,
                                { value -> if (enabled) mutate { session.collectionsState.setItem(collection.id, item, value, now()) } },
                                Modifier.blockCoveredPointers(!enabled).semantics { if (!enabled) disabled() },
                                helper = if (!included && collection.items.size >= NATIVE_COLLECTION_ITEM_LIMIT) "Коллекция заполнена: $NATIVE_COLLECTION_ITEM_LIMIT элементов." else null)
                        }
                    }
                } else if (state != null) {
                    when {
                        favorites -> {
                            item { BasicText("Избранных элементов: ${state.favorites.size}", modifier = Modifier.padding(horizontal = NativeDimensions.space4), style = NativeDesign.components.coreStatusDetail.text.textStyle()) }
                            if (state.favorites.none { (it.title ?: it.id).contains(query, true) }) item { NativePaperSheet { NativeSectionHeading(if (query.isBlank()) "Избранное пока пусто" else "Ничего не найдено") } }
                            items(state.favorites.filter { (it.title ?: it.id).contains(query, true) }, key = { "favorite:${it.kind}:${it.id}" }) { item ->
                                NativeCollectionItemRow(item, !saving, onOpen = { open(item) },
                                    onRemove = { mutate { session.collectionsState.toggleFavorite(item, now()) } })
                            }
                        }
                        selected != null -> {
                            item {
                                Column(Modifier.padding(horizontal = NativeDimensions.space4)) {
                                    NativeSectionHeading(selected.name)
                                    BasicText("Элементов: ${selected.items.size}", style = NativeDesign.components.coreStatusDetail.text.textStyle())
                                    FlowRow {
                                        NativeIconButton(components.routeIconButton, "route-icon-button", "Переименовать коллекцию", { renaming = selected; name = selected.name; editingName = true }, enabled = !saving, icon = nativeCollectionGlyph(NativeAppGlyphName.Edit))
                                        NativeIconButton(components.routeIconButton, "route-icon-button", "Удалить коллекцию", { deleting = selected }, enabled = !saving, icon = nativeCollectionGlyph(NativeAppGlyphName.Trash))
                                    }
                                }
                            }
                            if (selected.items.none { (it.title ?: it.id).contains(query, true) }) item { NativePaperSheet { NativeSectionHeading(if (query.isBlank()) "Коллекция пока пуста" else "Ничего не найдено") } }
                            items(selected.items.filter { (it.title ?: it.id).contains(query, true) }, key = { "item:${it.kind}:${it.id}" }) { item ->
                                NativeCollectionItemRow(item, !saving, onOpen = { open(item) },
                                    onRemove = { mutate { session.collectionsState.setItem(selected.id, item, false, now()) } })
                            }
                        }
                        else -> {
                            item {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                    NativeIconToggle(listOf("Плитка" to nativeCollectionGlyph(NativeAppGlyphName.SquaresFour), "Список" to nativeCollectionGlyph(NativeAppGlyphName.ListBullets)),
                                        if (grid) 0 else 1, { grid = it == 0 }, Modifier.testTag("user-library-view-toggle"))
                                }
                            }
                            val folders = buildList<NativeItemCollection?> {
                                if ("Избранное".contains(query, true) || state.favorites.any { (it.title ?: it.id).contains(query, true) }) add(null)
                                addAll(state.collections.filter { collection -> collection.name.contains(query, true) || collection.items.any { (it.title ?: it.id).contains(query, true) } })
                            }
                            if (folders.isEmpty() || (query.isBlank() && state.collections.isEmpty() && state.favorites.isEmpty())) item {
                                NativePaperSheet { NativeSectionHeading(if (query.isBlank()) "Здесь пока нет сохранённых элементов" else "Ничего не найдено",
                                    description = if (query.isBlank()) "Откройте файл с устройства или сохраните источник и инструмент в избранное." else null) }
                            }
                            items(folders.chunked(if (grid) 2 else 1), key = { row -> row.first()?.id ?: "favorites" }) { row ->
                                Row(horizontalArrangement = Arrangement.spacedBy(NativeDimensions.space2)) {
                                    row.forEach { collection -> NativeFolderCard(collection?.name ?: "Избранное", "Элементов: ${collection?.items?.size ?: state.favorites.size}",
                                        { session.library.openFolder(collection?.id) }, Modifier.weight(1f).testTag("user-library-folder-card"), icon = nativeCollectionGlyph(NativeAppGlyphName.FolderOpen)) }
                                    if (grid && row.size == 1) androidx.compose.foundation.layout.Box(Modifier.weight(1f))
                                }
                            }
                            pickFile?.let { pick -> item { NativePrimaryButton("Открыть файл", pick, icon = nativeCollectionGlyph(NativeAppGlyphName.FolderOpen)) } }
                        }
                    }
                }
                if (state != null) item {
                    NativePrimaryButton(text = "Создать коллекцию", icon = nativeCollectionGlyph(NativeAppGlyphName.Plus), enabled = !saving && state.collections.size < NATIVE_COLLECTION_LIMIT, modifier = Modifier.padding(horizontal = NativeDimensions.space2), onClick = { name = ""; renaming = null; editingName = true })
                }
            }
    }
    if (editingName && state != null) NativeCollectionNameDialog(session, state, name, renaming, selectedItem, saving,
        onName = { name = it }, onDismiss = { editingName = false }, mutate = mutate, onSaved = { editingName = false })
    deleting?.let { collection -> NativeCollectionDeleteDialog(collection, saving, { deleting = null }) {
        mutate { session.collectionsState.deleteCollection(collection.id); selectedId = null; deleting = null }
    } }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NativeCollectionItemRow(item: NativeItemRef, enabled: Boolean, onOpen: () -> Unit, onRemove: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = NativeDimensions.space4)) {
        NativeSectionHeading(item.title ?: item.id)
        item.reader?.let { route ->
            val version = when (route) {
                is dev.localmed.nativespike.shared.core.NativeReaderRoute.Document -> route.target.moduleVersion ?: route.target.documentVersionId
                is dev.localmed.nativespike.shared.core.NativeReaderRoute.Definition -> route.target.moduleVersion
            }
            BasicText("Редакция: $version", style = NativeDesign.components.coreStatusDetail.text.textStyle())
        }
        FlowRow {
            NativePrimaryButton(text = "Открыть", enabled = enabled, onClick = onOpen)
            NativeIconButton(NativeDesign.components.routeIconButton, "route-icon-button", "Убрать из списка", onRemove, enabled = enabled, icon = nativeCollectionGlyph(NativeAppGlyphName.Close))
        }
    }
}
