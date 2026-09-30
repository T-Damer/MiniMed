package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.user.NativeUserState
import dev.localmed.nativespike.shared.user.NativeUserStateFormatException
import dev.localmed.nativespike.shared.user.NativeHistoryEntry
import dev.localmed.nativespike.shared.user.NATIVE_HISTORY_LIMIT
import dev.localmed.nativespike.shared.user.nativeCompletedSearch
import dev.localmed.nativespike.shared.user.NativeHistoryAnalysisMode
import dev.localmed.nativespike.shared.model.NativeSearchMode
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

enum class NativeUserPanel { Settings, History }

/** Host-owned lifecycle; rotation reuses this owner rather than opening another database. */
class NativeCoreSession(
    private val io: NativeContentIO,
    private val catalogLoader: suspend () -> String,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow<NativeCoreSessionState>(NativeCoreSessionState.Opening())
    val state: StateFlow<NativeCoreSessionState> = mutableState.asStateFlow()
    val uiErrors = NativeUiErrors()
    val userState = NativeUserState(io)
    private val mutablePanel = MutableStateFlow<NativeUserPanel?>(null)
    val panel: StateFlow<NativeUserPanel?> = mutablePanel.asStateFlow()
    val actionScope: CoroutineScope get() = scope
    private var replayHandler: (suspend (NativeHistoryEntry) -> Unit)? = null
    private var pendingHistory = emptyList<NativeHistoryEntry>()
    private val mutableHistoryPending = MutableStateFlow(false)
    val historyPending: StateFlow<Boolean> = mutableHistoryPending.asStateFlow()

    suspend fun recordSearch(query: String, count: Int, mode: NativeSearchMode) {
        val entry = nativeCompletedSearch(query, count, if (mode == NativeSearchMode.CLINICAL) NativeHistoryAnalysisMode.Clinical else NativeHistoryAnalysisMode.Lookup)
        pendingHistory = (listOf(entry) + pendingHistory.filter { it.query != entry.query || it.scope != entry.scope || it.analysisMode != entry.analysisMode }).take(NATIVE_HISTORY_LIMIT)
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
        pendingHistory = pendingHistory.filterNot { deleted != null && it.query == deleted.query && it.scope == deleted.scope && it.analysisMode == deleted.analysisMode }
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
    private var navigationFlush: (suspend () -> Boolean)? = null
    private val backMutex = Mutex()

    /** The current composed route supplies its viewport; stale disposals cannot clear a newer route. */
    fun registerNavigationFlush(flush: suspend () -> Boolean): () -> Unit {
        navigationFlush = flush
        return { if (navigationFlush === flush) navigationFlush = null }
    }

    suspend fun flushUi(): Boolean = navigationFlush?.invoke() ?: true

    suspend fun back(): Boolean {
        if (!backMutex.tryLock()) return false
        try {
            if (!flushUi()) return false
            if (mutablePanel.value != null) { mutablePanel.value = null; return true }
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
                (mutableState.value as? NativeCoreSessionState.Ready)?.core?.close()
                closeFinished.complete(Unit)
            } catch (cause: Throwable) {
                closeFinished.completeExceptionally(cause)
                throw cause
            }
        }
    }
}
