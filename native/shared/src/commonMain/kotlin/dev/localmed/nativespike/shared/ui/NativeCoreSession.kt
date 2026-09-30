package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.user.NativeUserState
import dev.localmed.nativespike.shared.user.NativeCollectionsState
import dev.localmed.nativespike.shared.user.NativeCollectionsFormatException
import dev.localmed.nativespike.shared.user.NativeItemRef
import dev.localmed.nativespike.shared.user.NativeItemKind
import dev.localmed.nativespike.shared.core.NativeReaderRoute
import dev.localmed.nativespike.shared.user.NativeUserStateFormatException
import dev.localmed.nativespike.shared.user.NativeHistoryEntry
import dev.localmed.nativespike.shared.user.NATIVE_HISTORY_LIMIT
import dev.localmed.nativespike.shared.user.nativeCompletedSearch
import dev.localmed.nativespike.shared.user.NativeHistoryAnalysisMode
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.content.NativeToolsBundle
import dev.localmed.nativespike.shared.tools.*
import dev.localmed.nativespike.shared.user.NativeToolsState
import dev.localmed.nativespike.shared.user.NativeToolsFormatException
import dev.localmed.nativespike.shared.user.NativeToolEntry
import dev.localmed.nativespike.shared.user.NativeToolRoute
import dev.localmed.nativespike.shared.user.NativeSavedTool
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex

sealed interface NativeCoreSessionState {
    data class Opening(val progress: NativeInstallProgress? = null) : NativeCoreSessionState
    data class Ready(val core: NativeMedicalCore) : NativeCoreSessionState
    data class Failed(val message: String) : NativeCoreSessionState
}

enum class NativeUserPanel { Settings, History, Collections }

/** Host-owned lifecycle; rotation reuses this owner rather than opening another database. */
class NativeCoreSession(
    private val io: NativeContentIO,
    private val catalogLoader: suspend () -> String,
    private val scope: CoroutineScope,
    private val toolsLoader: (suspend () -> NativeToolsBundle)? = null,
) {
    private val mutableState = MutableStateFlow<NativeCoreSessionState>(NativeCoreSessionState.Opening())
    val state: StateFlow<NativeCoreSessionState> = mutableState.asStateFlow()
    val uiErrors = NativeUiErrors()
    val userState = NativeUserState(io)
    val collectionsState = NativeCollectionsState(io)
    val toolsState = NativeToolsState(io)
    val startupSearch = NativeSearchUiState(dev.localmed.nativespike.shared.core.NativeSearchSnapshot())
    private val toolsMutex = Mutex()
    private var toolsBundle: NativeToolsBundle? = null
    private val mutableTools = MutableStateFlow<NativeToolCore?>(null)
    val tools = mutableTools.asStateFlow()
    private val mutableToolsQuery=MutableStateFlow("")
    val toolsQuery=mutableToolsQuery.asStateFlow()
    private val mutableToolsKind = MutableStateFlow<NativeToolKind?>(null)
    val toolsKind = mutableToolsKind.asStateFlow()
    fun updateToolsKind(kind: NativeToolKind?) { mutableToolsKind.value = kind }
    private var toolsQueryLoaded=false
    fun updateToolsQuery(query: String) {
        if(query.length>20_000 || '\u0000' in query) {
            uiErrors.report(NativeUiOperation.ToolsState,"Запрос слишком длинный или содержит недопустимый символ.");return
        }
        mutableToolsQuery.value=query
    }
    suspend fun saveToolsQuery(): Boolean = uiErrors.execute(NativeUiOperation.ToolsState,"Не удалось сохранить запрос инструментов.") { toolsState.query(mutableToolsQuery.value) }
    val calculatorDrafts = mutableMapOf<String,NativeCalculatorUiState>()
    val assessmentDrafts = mutableMapOf<String,NativeAssessmentUiState>()

    suspend fun loadTools(): Boolean = toolsMutex.withLock {
        try {
            toolsState.load()
            if(!toolsQueryLoaded) { mutableToolsQuery.value=toolsState.snapshot.value?.query.orEmpty();toolsQueryLoaded=true }
            val bundle = toolsBundle ?: toolsLoader?.invoke()?.also { toolsBundle=it }
                ?: throw IllegalStateException("Tool bundle is unavailable")
            mutableTools.value=bundle.core()
            uiErrors.clear(NativeUiOperation.ToolsState);true
        } catch(cause: CancellationException) { throw cause }
        catch(cause: NativeToolsFormatException) { uiErrors.report(NativeUiOperation.ToolsState,"Формат сохранённых инструментов повреждён или не поддерживается. Файл оставлен без изменений.");false }
        catch(cause: Exception) { uiErrors.report(NativeUiOperation.ToolsState,"Не удалось открыть инструменты. Повторите чтение.");false }
    }
    suspend fun openTools(kind: NativeToolKind? = null): Boolean {
        if(!flushUi() || !loadTools()) return false
        val opened = uiErrors.execute(NativeUiOperation.ToolsState,"Не удалось сохранить переход к инструментам.") { toolsState.route(NativeToolRoute.Catalog) }
        if (opened) updateToolsKind(kind)
        return opened
    }
    suspend fun openTool(id: String,entry: NativeToolEntry=NativeToolEntry.Search): Boolean {
        if(!flushUi() || !loadTools()) return false
        return openLoadedTool(id,entry)
    }
    private suspend fun openLoadedTool(id: String,entry: NativeToolEntry): Boolean {
        val record=tools.value?.tool(id)
        if(record==null) { uiErrors.report(NativeUiOperation.ToolsState,"Инструмент недоступен в этой версии. Запись в коллекции сохранена.");return false }
        return uiErrors.execute(NativeUiOperation.ToolsState,"Не удалось сохранить открытие инструмента.") { toolsState.route(NativeToolRoute.Tool(record.id,record.version,entry)) }
    }
    fun calculatorState(record: NativeToolRecord): NativeCalculatorUiState = calculatorDrafts.getOrPut(record.id+"@"+record.version) {
        val saved=toolsState.snapshot.value?.drafts?.find { it.id==record.id && it.version==record.version }
        NativeCalculatorUiState(record.id,saved?.calculator?.inputs ?: tools.value!!.initialCalculatorValues(record.id),saved?.calculator?.stage ?: 0)
            .also { state -> saved?.calculatorResult?.let { state.accept(state.snapshot(),it) } }
    }
    fun assessmentState(record: NativeToolRecord): NativeAssessmentUiState = assessmentDrafts.getOrPut(record.id+"@"+record.version) {
        val saved=toolsState.snapshot.value?.drafts?.find { it.id==record.id && it.version==record.version }
        NativeAssessmentUiState(record.id,saved?.assessment?.answers.orEmpty()).also { state -> saved?.assessmentResult?.let { state.accept(state.snapshot(),it) } }
    }
    suspend fun saveTool(record: NativeToolRecord): Boolean = uiErrors.execute(NativeUiOperation.ToolsState,"Не удалось сохранить данные инструмента. Повторите сохранение.") {
        val key=record.id+"@"+record.version
        val value=when(record.definition) {
            is NativeToolDefinition.Calculator -> calculatorDrafts[key]?.let { NativeSavedTool(record.id,record.version,calculator=it.snapshot(),calculatorResult=it.result) }
            is NativeToolDefinition.Assessment -> assessmentDrafts[key]?.let { NativeSavedTool(record.id,record.version,assessment=it.snapshot(),assessmentResult=it.result) }
        }
        if(value!=null) toolsState.save(value)
    }
    suspend fun evaluateTool(id: String,inputs: Map<String,NativeToolInput>,stage: Int): NativeCalculatorResult =
        requireNotNull(toolsBundle).core().evaluateCalculator(id,inputs,stage)

    private val mutableCollectionItem = MutableStateFlow<NativeItemRef?>(null)
    val collectionItem: StateFlow<NativeItemRef?> = mutableCollectionItem.asStateFlow()
    private var collectionItemHandler: (suspend (NativeItemRef) -> String?)? = null
    private val mutablePanel = MutableStateFlow<NativeUserPanel?>(null)
    val panel: StateFlow<NativeUserPanel?> = mutablePanel.asStateFlow()
    val actionScope: CoroutineScope get() = scope
    private var replayHandler: (suspend (NativeHistoryEntry) -> Unit)? = null
    private var pendingHistory = emptyList<NativeHistoryEntry>()
    private val mutableHistoryPending = MutableStateFlow(false)
    val historyPending: StateFlow<Boolean> = mutableHistoryPending.asStateFlow()

    suspend fun recordSearch(query: String, count: Int, mode: NativeSearchMode, selection: NativeSearchSelection = NativeSearchSelection()) {
        val entry = nativeCompletedSearch(query, count, if (mode == NativeSearchMode.CLINICAL) NativeHistoryAnalysisMode.Clinical else NativeHistoryAnalysisMode.Lookup,selection)
        pendingHistory = (listOf(entry) + pendingHistory.filter { it.query != entry.query || it.scope != entry.scope || it.analysisMode != entry.analysisMode || it.selection != entry.selection }).take(NATIVE_HISTORY_LIMIT)
        mutableHistoryPending.value = true
        savePendingHistory(entry)
    }

    private suspend fun savePendingHistory(entry: NativeHistoryEntry) {
        val saved = uiErrors.execute(NativeUiOperation.UserHistory,
            "Не удалось сохранить завершённый поиск в историю. Повторите сохранение.") {
            userState.load()
            userState.recordCompletedSearch(entry)
        }
        if (saved) pendingHistory = pendingHistory.filterNot { it.id == entry.id }
        mutableHistoryPending.value = pendingHistory.isNotEmpty()
    }

    suspend fun retryHistory() {
        for (entry in pendingHistory.asReversed()) {
            if (pendingHistory.any { it.id == entry.id }) savePendingHistory(entry)
        }
    }
    suspend fun clearHistory() {
        userState.clearHistory()
        pendingHistory = emptyList()
        mutableHistoryPending.value = false
    }
    suspend fun deleteHistory(id: String) {
        val deleted = userState.snapshot.value?.history?.find { it.id == id }
        userState.deleteHistory(id)
        pendingHistory = pendingHistory.filterNot { deleted != null && it.query == deleted.query && it.scope == deleted.scope && it.analysisMode == deleted.analysisMode && it.selection == deleted.selection }
        mutableHistoryPending.value = pendingHistory.isNotEmpty()
    }

    fun registerReplayHandler(handler: suspend (NativeHistoryEntry) -> Unit): () -> Unit {
        replayHandler = handler
        return { if (replayHandler === handler) replayHandler = null }
    }

    suspend fun loadUserState(): Boolean {
        if (userState.snapshot.value != null) return true
        return try {
            userState.load()
            uiErrors.clear(NativeUiOperation.UserState)
            true
        } catch (cause: CancellationException) { throw cause }
        catch (cause: NativeUserStateFormatException) {
            uiErrors.report(NativeUiOperation.UserState, "Формат настроек и истории повреждён или не поддерживается. Файл оставлен без изменений.")
            false
        } catch (cause: Exception) {
            uiErrors.report(NativeUiOperation.UserState, "Не удалось прочитать настройки и историю. Файл сохранён; повторите чтение.")
            false
        }
    }

    suspend fun openPanel(panel: NativeUserPanel) {
        if (flushUi()) mutablePanel.value = panel
    }

    suspend fun showSearch(): Boolean {
        if (!backMutex.tryLock()) return false
        try {
            if (!flushUi()) return false
            return uiErrors.execute(NativeUiOperation.Navigation, "Не удалось сохранить переход к поиску. Повторите действие.") {
                (state.value as? NativeCoreSessionState.Ready)?.core?.showSearch()
                if (toolsState.snapshot.value?.route != null) toolsState.route(null)
                mutablePanel.value = null
                mutableCollectionItem.value = null
            }
        } finally { backMutex.unlock() }
    }

    suspend fun loadCollections(): Boolean {
        if (collectionsState.snapshot.value != null) return true
        return try {
            collectionsState.load()
            uiErrors.clear(NativeUiOperation.CollectionsState)
            true
        } catch (cause: CancellationException) { throw cause }
        catch (cause: NativeCollectionsFormatException) {
            uiErrors.report(NativeUiOperation.CollectionsState, "Формат избранного и коллекций повреждён или не поддерживается. Файл оставлен без изменений.")
            false
        } catch (cause: Exception) {
            uiErrors.report(NativeUiOperation.CollectionsState, "Не удалось прочитать избранное и коллекции. Повторите чтение.")
            false
        }
    }

    suspend fun openCollections(item: NativeItemRef? = null) {
        if (!flushUi()) return
        mutableCollectionItem.value = item
        mutablePanel.value = NativeUserPanel.Collections
    }

    suspend fun openReaderCollections(title: String) {
        if (!flushUi()) return
        val route = (state.value as? NativeCoreSessionState.Ready)?.core?.navigation?.value?.readers?.lastOrNull() ?: return
        val id = when (route) {
            is NativeReaderRoute.Document -> route.target.documentId
            is NativeReaderRoute.Definition -> route.target.entityId
        }
        mutableCollectionItem.value = NativeItemRef(NativeItemKind.Document, id, title = title.take(300), reader = route)
        mutablePanel.value = NativeUserPanel.Collections
    }

    /** The ready application returns null on success, or the actual unavailable reason. */
    fun registerCollectionItemHandler(handler: suspend (NativeItemRef) -> String?): () -> Unit {
        collectionItemHandler = handler
        return { if (collectionItemHandler === handler) collectionItemHandler = null }
    }

    suspend fun openCollectionItem(item: NativeItemRef): Boolean {
        if (!backMutex.tryLock()) return false
        try {
        if(item.kind==NativeItemKind.Tool) {
            if(!flushUi() || !loadTools() || !openLoadedTool(item.id,NativeToolEntry.Collections)) return false
            mutablePanel.value=null;mutableCollectionItem.value=null;return true
        }
        val handler = collectionItemHandler
        if (handler == null) {
            uiErrors.report(NativeUiOperation.Collections, "Источники ещё не подготовлены. Повторите открытие после загрузки базы.")
            return false
        }
        if (!flushUi()) return false
        if (closed.value || collectionItemHandler !== handler) return false
        var unavailable: String? = null
        val executed = uiErrors.execute(NativeUiOperation.Collections, "Не удалось открыть сохранённый элемент. Повторите действие.") {
            unavailable = handler(item)
            if(unavailable==null && toolsState.snapshot.value?.route!=null) toolsState.route(null)
        }
        if (!executed) return false
        unavailable?.let { uiErrors.report(NativeUiOperation.Collections, it); return false }
        mutablePanel.value = null
        mutableCollectionItem.value = null
        return true
        } finally { backMutex.unlock() }
    }

    suspend fun replay(entry: NativeHistoryEntry): Boolean {
        val handler = replayHandler ?: return false
        if (!flushUi()) return false
        return uiErrors.execute(NativeUiOperation.Navigation, "Не удалось повторить поиск. Повторите действие.") {
            handler(entry)
            mutablePanel.value = null
        }
    }
    private val closeFinished = CompletableDeferred<Unit>()
    private var opening: Job? = null
    private val closed = MutableStateFlow(false)
    private val generation = MutableStateFlow(0)
    private val navigationFlushers = linkedMapOf<Any,suspend () -> Boolean>()
    private val backMutex = Mutex()

    /** The current composed route supplies its viewport; stale disposals cannot clear a newer route. */
    fun registerNavigationFlush(flush: suspend () -> Boolean): () -> Unit {
        val token=Any();navigationFlushers[token]=flush
        return { navigationFlushers.remove(token);Unit }
    }

    suspend fun flushUi(): Boolean = navigationFlushers.values.lastOrNull()?.invoke() ?: true

    suspend fun back(): Boolean {
        if (!backMutex.tryLock()) return false
        try {
            if (!flushUi()) return false
            if (mutablePanel.value != null) { mutablePanel.value = null; return true }
            toolsState.snapshot.value?.route?.let { route ->
                val entry=(route as? NativeToolRoute.Tool)?.entry
                if(entry==NativeToolEntry.Collections && !loadCollections()) return false
                val saved=uiErrors.execute(NativeUiOperation.ToolsState,"Не удалось сохранить переход из инструмента.") {
                    toolsState.route(if(entry==NativeToolEntry.Catalog) NativeToolRoute.Catalog else null)
                }
                if(saved && entry==NativeToolEntry.Collections) {
                    mutableCollectionItem.value=null
                    mutablePanel.value=NativeUserPanel.Collections
                }
                return saved
            }
            val core = (state.value as? NativeCoreSessionState.Ready)?.core ?: return false
            return uiErrors.execute(NativeUiOperation.Navigation, "Не удалось сохранить переход. Повторите действие.") { core.back() }
        } finally { backMutex.unlock() }
    }

    fun retry() {
        if (closed.value || opening?.isActive == true || mutableState.value is NativeCoreSessionState.Ready) return
        val attempt = generation.value + 1
        generation.value = attempt
        mutableState.value = NativeCoreSessionState.Opening(NativeInstallProgress("opening"))
        opening = scope.launch {
            var created: NativeMedicalCore? = null
            try {
                val core = NativeMedicalCore.open(io, catalogLoader()) { progress ->
                    if (!closed.value && generation.value == attempt) mutableState.value = NativeCoreSessionState.Opening(progress)
                }
                created = core
                if (!closed.value && generation.value == attempt && currentCoroutineContext().isActive) {
                    mutableState.value = NativeCoreSessionState.Ready(core)
                    created = null
                }
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                if (!closed.value && generation.value == attempt) mutableState.value = NativeCoreSessionState.Failed(cause.message ?: "Не удалось подготовить базу источников.")
            } finally {
                withContext(NonCancellable) { created?.close() }
            }
        }
    }

    suspend fun close() {
        if (!closed.compareAndSet(false, true)) { closeFinished.await(); return }
        generation.value += 1
        withContext(NonCancellable) {
            try {
                opening?.cancelAndJoin()
                userState.awaitWrites()
                collectionsState.awaitWrites()
                toolsState.awaitWrites()
                (mutableState.value as? NativeCoreSessionState.Ready)?.core?.close()
                closeFinished.complete(Unit)
            } catch (cause: Throwable) {
                closeFinished.completeExceptionally(cause)
                throw cause
            }
        }
    }
}
