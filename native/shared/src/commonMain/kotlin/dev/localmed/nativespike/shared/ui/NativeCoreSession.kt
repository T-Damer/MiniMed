package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeContentIO
import dev.localmed.nativespike.shared.core.NativeInstallProgress
import dev.localmed.nativespike.shared.core.NativeMedicalCore
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

/** Host-owned lifecycle; rotation reuses this owner rather than opening another database. */
class NativeCoreSession(
    private val io: NativeContentIO,
    private val catalogLoader: suspend () -> String,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow<NativeCoreSessionState>(NativeCoreSessionState.Opening())
    val state: StateFlow<NativeCoreSessionState> = mutableState.asStateFlow()
    val uiErrors = NativeUiErrors()
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
            val core = (state.value as? NativeCoreSessionState.Ready)?.core ?: return false
            if (!flushUi()) return false
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
                (mutableState.value as? NativeCoreSessionState.Ready)?.core?.close()
                closeFinished.complete(Unit)
            } catch (cause: Throwable) {
                closeFinished.completeExceptionally(cause)
                throw cause
            }
        }
    }
}
