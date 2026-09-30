@file:OptIn(org.jetbrains.compose.resources.ExperimentalResourceApi::class)
package dev.localmed.nativespike.shared.preview

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.localmed.nativespike.shared.content.bundledNativeTools
import dev.localmed.nativespike.shared.core.*
import dev.localmed.nativespike.shared.designsystem.gallery.NativeDesignGallery
import dev.localmed.nativespike.shared.designsystem.gallery.NativeReaderGallery
import dev.localmed.nativespike.shared.model.*
import dev.localmed.nativespike.shared.ui.*
import dev.localmed.nativespike.shared.user.*
import kotlinx.browser.window
import org.w3c.dom.url.URLSearchParams
import kotlinx.coroutines.launch
import dev.localmed.nativespike.shared.designsystem.NativeQueryProgress
import dev.localmed.nativespike.shared.designsystem.NativeActionButton
import dev.localmed.nativespike.shared.reader.nativeFilePickerAvailable
import dev.localmed.nativespike.shared.reader.rememberNativeFilePicker
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import minimed_native_spike.shared.generated.resources.Res

/** Public-source visual scenes and actual tools; no SQLite or private profile is opened. */
@Composable
fun NativeVisualPreview() {
    val scope = rememberCoroutineScope()
    val parameters = remember { window.location.search.removePrefix("?").split('&').mapNotNull {
        val parts = it.split('=', limit = 2); if (parts.size == 2) parts[0] to parts[1] else null
    }.toMap() }
    var scene by remember { mutableStateOf(parameters["scene"] ?: "search") }
    var fixtureReady by remember { mutableStateOf(scene != "startup") }
    val session = remember { NativeCoreSession(PreviewContentIO(), { error("Preview has no SQL catalog") }, scope, ::bundledNativeTools) }
    val user by session.userState.snapshot.collectAsState()
    val panel by session.panel.collectAsState()
    val openedFile by session.openedFile.collectAsState()
    val pickFile = rememberNativeFilePicker { result -> scope.launch { session.openFile(result) } }
    val toolRoute by session.toolsState.snapshot.collectAsState()
    val tools by session.tools.collectAsState()
    var source by remember { mutableStateOf<NativeSourceDocument?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    val searchState = remember { NativeSearchUiState(NativeSearchSnapshot()) }
    var readerPosition by remember { mutableStateOf<NativeReaderRoute.Document?>(null) }
    LaunchedEffect(session) {
        try {
            check(session.loadUserState())
            session.userState.setTheme(if (parameters["theme"] == "dark") NativeThemePreference.Dark else NativeThemePreference.Light)
            check(session.loadTools())
            val value = Json.parseToJsonElement(Res.readBytes("files/native-visual-document.json").decodeToString()).jsonObject
            source = Json.decodeFromJsonElement(NativeSourceDocument.serializer(), requireNotNull(value["document"]))
            if (scene == "tools") session.openTools()
            else if (scene.startsWith("tool:")) session.openTool(scene.removePrefix("tool:"))
        } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
        catch (cause: Exception) { failure = "Не удалось открыть визуальные fixtures: ${cause::class.simpleName}" }
    }
    DisposableEffect(session) {
        val unregister = session.registerReplayHandler { entry -> searchState.updateQuery(entry.query); scene = "search" }
        onDispose { unregister() }
    }
    val document = source
    val chrome = remember(scene, document?.target) { NativeReaderChrome() }
    val navVisible = openedFile == null && !scene.startsWith("design") && panel != NativeUserPanel.Collections && panel != NativeUserPanel.History &&
        (panel != null || toolRoute?.route != null || scene != "reader" || chrome.visible)
    NativeUserAppearance(user?.preferences ?: NativeUserPreferences()) {
        NativeSpikeTheme {
            CompositionLocalProvider(LocalNativeOpenFile provides pickFile.takeIf { nativeFilePickerAvailable }, LocalNativeReaderChrome provides chrome, LocalNativeNavigationPadding provides if (navVisible) 68.dp else 0.dp) {
                Box(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().focusProperties { canFocus = openedFile == null }.onPreviewKeyEvent { openedFile != null }
                        .then(if (openedFile != null) Modifier.clearAndSetSemantics { } else Modifier)) {
                    // Design-system gallery (claude-coordinator): ?scene=design[&theme=dark][&loading=1][&q=query]
                    if (scene == "design") NativeDesignGallery(loading = parameters["loading"] == "1", initialQuery = URLSearchParams(window.location.search.toJsString()).get("q").orEmpty())
                    else if (scene == "design-reader") NativeReaderGallery(initialFind = URLSearchParams(window.location.search.toJsString()).get("find").orEmpty())
                    else if (failure != null) Text(requireNotNull(failure), Modifier.padding(16.dp))
                    else if (document == null || tools == null) Text("Подготовка визуального сравнения…", Modifier.padding(16.dp))
                    else {
                        val actions = remember(document) { fixtureSearchActions(document) }
                        if (scene == "reader") {
                            val position = readerPosition ?: NativeReaderRoute.Document(document.target)
                            ReaderScreen(document, position, onSavePosition = { readerPosition = it; true }, onBack = { scene = "search" },
                                onSaveItem = { scope.launch { session.openCollections(NativeItemRef(NativeItemKind.Document, document.target.documentId, title = document.title, reader = readerPosition ?: position)) } })
                        } else {
                        SearchScreen(actions.takeIf { fixtureReady }, searchState,
                            coreProgress = if (fixtureReady) null else NativeQueryProgress("Открываем базу источников", "Публичный fixture; база SQL не открывается"),
                            onOpenDocument = { _, _, anchor, _ -> readerPosition = NativeReaderRoute.Document(document.target.copy(anchor = anchor)); scene = "reader" },
                            onOpenSources = { scene = "reader" }, onOpenIdentity = { scene = "reader" },
                            onOpenHistory = { scope.launch { session.openPanel(NativeUserPanel.History) } },
                            toolCore = tools, onOpenTools = { scope.launch { session.openTools() } },
                            onOpenToolSection = { kind -> scope.launch { session.openTools(kind) }; Unit },
                            onOpenTool = { record -> scope.launch { session.openTool(record.id) } },
                            onSaveTool = { item -> scope.launch { session.openCollections(item) } },
                            onCompletedSearch = { query, outcome -> scope.launch { session.recordSearch(query, outcome.groups.size, outcome.mode, outcome.selection) } })
                        if (!fixtureReady) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = LocalNativeNavigationPadding.current)) {
                            NativeActionButton("Fixture готов: выполнить запрос", { fixtureReady = true })
                        }
                        }
                        if (toolRoute?.route != null) NativeToolsPane(session)
                        when (panel) {
                            NativeUserPanel.Settings -> NativeSettingsScreen(session, user)
                            NativeUserPanel.History -> NativeHistoryDrawer(session, user)
                            NativeUserPanel.Collections -> NativeCollectionsScreen(session)
                            null -> Unit
                        }
                    }
                    }
                    openedFile?.let { file -> NativeOpenedFileScreen(file) { scope.launch { session.back() } } }
                    if (navVisible) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp)) {
                        NativeBottomNavigation(if (panel == NativeUserPanel.Settings) 2 else 0,
                            onSearch = { scope.launch { if (session.showSearch()) scene = "search" } },
                            onCollections = { scope.launch { session.openCollections() } },
                            onSettings = { scope.launch { session.openPanel(NativeUserPanel.Settings) } })
                    }
                }
            }
        }
    }
}

private fun fixtureSearchActions(document: NativeSourceDocument) = NativeSearchActions(
    lookupIdentities = { _, _ -> emptyList() },
    search = { query, mode, selection, _ ->
        val matching = query.trim().lowercase().let { it.isNotEmpty() && document.title.lowercase().contains(it) }
        val allowed = selection.scope in listOf(NativeSearchScope.ALL, NativeSearchScope.GUIDELINES, NativeSearchScope.DIAGNOSIS)
        val groups = if (!matching || !allowed) emptyList() else listOf(
            SearchResultGroup(document.target.documentId, document.title, DocumentKind.CLINICAL_RECOMMENDATION,
                document.sections.flatMap { section -> section.chunks.take(1).map { chunk ->
                    SearchResultItem(chunk.id, section.id, section.title, chunk.anchor, chunk.originalText, target = document.target.copy(anchor = chunk.anchor))
                } }.take(3)),
        )
        SearchOutcome(groups, SearchTiming(0.0, 0.0), mode, selection = selection)
    },
)

/** Disposable in-memory profile; actual state stores still perform their normal atomic calls. */
private class PreviewContentIO : NativeContentIO {
    private val files = mutableMapOf<String, String>()
    override fun exists(path: String) = path in files
    override suspend fun readText(path: String) = requireNotNull(files[path])
    override suspend fun writeTextAtomic(path: String, text: String) { files[path] = text }
    override suspend fun delete(path: String) { files.remove(path) }
    override suspend fun moveAtomic(source: String, target: String) { files[target] = requireNotNull(files.remove(source)) }
    override fun databasePath(path: String): String = error("Preview does not open SQL")
    override suspend fun verify(path: String, sha256: String, sizeBytes: Long): Unit = error("Preview does not install packs")
    override suspend fun download(url: String, path: String, maximumBytes: Long, progress: (Long) -> Unit): Unit = error("Preview does not download packs")
    override suspend fun decodeGzip(source: String, target: String, maximumBytes: Long): Unit = error("Preview does not install packs")
}
