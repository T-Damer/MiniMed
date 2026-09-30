package dev.localmed.nativespike.shared.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.localmed.nativespike.shared.core.NativeSearchSnapshot
import dev.localmed.nativespike.shared.model.SearchOutcome
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.NativeSearchScope

/** Kept by the app root while readers are open; durable results are recomputed from this query. */
class NativeSearchUiState(snapshot: NativeSearchSnapshot) {
    private var edited = false
    private data class SectionState(val snapshot: NativeSearchSnapshot, val outcome: SearchOutcome?)
    private val sections = mutableMapOf<NativeSearchScope, SectionState>()
    private fun sectionKey() = if (mode == NativeSearchMode.CLINICAL) NativeSearchScope.DIAGNOSIS
        else selection.scope.takeUnless { it == NativeSearchScope.DIAGNOSIS } ?: NativeSearchScope.ALL
    var query by mutableStateOf(snapshot.query)
        private set
    var mode by mutableStateOf(snapshot.mode)
        private set
    var selection by mutableStateOf(snapshot.selection)
        private set
    var inputError by mutableStateOf<String?>(null)
        private set
    var outcome by mutableStateOf<SearchOutcome?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var attempt by mutableStateOf(0)
    var queuedQuery by mutableStateOf<String?>(null)
        private set
    var completedSelection: NativeSearchSelection? = null
    var positionSelection: NativeSearchSelection = snapshot.selection
    var completedQuery: String? = null
    var completedMode: NativeSearchMode? = null
    var positionQuery: String = snapshot.query
    var positionMode: NativeSearchMode = snapshot.mode
    var listState by mutableStateOf(LazyListState(snapshot.firstVisibleItemIndex.coerceAtLeast(0), snapshot.firstVisibleItemOffset.coerceAtLeast(0)))
        private set

    fun updateQuery(value: String) {
        inputError = nativeSearchInputError(value)
        if (inputError == null && value != query) {
            edited = true
            query = value
            queuedQuery = null
            outcome = null
            completedQuery = null
            completedMode = null
            completedSelection = null
            error = null
        }
    }

    fun submit(waitingForCore: Boolean) {
        if (query.isBlank() || inputError != null) return
        queuedQuery = if (waitingForCore) query else null
        attempt += 1
    }

    fun completeQueuedQuery(requestQuery: String) {
        if (queuedQuery == requestQuery) queuedQuery = null
    }

    fun restoreWhenUntouched(saved: NativeSearchSnapshot): NativeSearchUiState =
        if (edited || attempt > 0) this else NativeSearchUiState(saved)

    fun updateMode(value: NativeSearchMode) {
        if (mode == value) return
        edited = true
        mode = value
        outcome = null
        completedQuery = null
        completedMode = null
        completedSelection = null
        error = null
    }

    fun updateSelection(value: NativeSearchSelection) {
        if(selection==value) return
        edited = true
        selection=value;outcome=null;completedQuery=null;completedMode=null;completedSelection=null;error=null
    }
    /** Section memory is local to this session; only the active snapshot is persisted. */
    fun selectSection(scope: NativeSearchScope, resetSpecialties: Boolean = false) {
        switchSection(scope.takeUnless { it == NativeSearchScope.DIAGNOSIS } ?: NativeSearchScope.ALL,
            NativeSearchMode.LOOKUP, resetSpecialties)
    }

    fun toggleClinical(enabled: Boolean) {
        switchSection(if (enabled) NativeSearchScope.DIAGNOSIS else NativeSearchScope.ALL,
            if (enabled) NativeSearchMode.CLINICAL else NativeSearchMode.LOOKUP)
    }

    private fun switchSection(key: NativeSearchScope, targetMode: NativeSearchMode, resetSpecialties: Boolean = false) {
        val previous = sectionKey()
        if (previous == key && !resetSpecialties) return
        val finished = completedQuery == query && completedMode == mode && completedSelection == selection
        sections[previous] = SectionState(snapshot(), outcome.takeIf { finished })
        val saved = sections[key]
        val clinicalToggle = (previous == NativeSearchScope.ALL && key == NativeSearchScope.DIAGNOSIS) ||
            (previous == NativeSearchScope.DIAGNOSIS && key == NativeSearchScope.ALL)
        val restored = saved?.snapshot ?: NativeSearchSnapshot(
            query = if (clinicalToggle) query else "", mode = targetMode,
            selection = NativeSearchSelection(if (key == NativeSearchScope.DIAGNOSIS) NativeSearchScope.ALL else key))
        val targetSelection = if (resetSpecialties) restored.selection.copy(
            filters = restored.selection.filters.copy(specialties = emptyList())) else restored.selection
        edited = true
        query = restored.query
        mode = targetMode
        selection = targetSelection
        outcome = saved?.outcome.takeIf { targetSelection == restored.selection }
        completedQuery = query.takeIf { outcome != null }
        completedMode = mode.takeIf { outcome != null }
        completedSelection = selection.takeIf { outcome != null }
        positionQuery = query
        positionMode = mode
        positionSelection = selection
        listState = LazyListState(restored.firstVisibleItemIndex, restored.firstVisibleItemOffset)
        inputError = null
        error = null
        queuedQuery = null
        loading = false
    }

    fun acceptsRequest(requestQuery: String,requestMode: NativeSearchMode,requestSelection: NativeSearchSelection): Boolean =
        query==requestQuery && mode==requestMode && selection==requestSelection
    fun acceptsLookupIdentities(requestQuery: String, requestMode: NativeSearchMode,requestSelection: NativeSearchSelection = NativeSearchSelection()): Boolean =
        requestMode == NativeSearchMode.LOOKUP && acceptsRequest(requestQuery,requestMode,requestSelection)

    fun snapshot(): NativeSearchSnapshot {
        val resetPosition = positionQuery != query || positionMode != mode || positionSelection != selection
        return NativeSearchSnapshot(query, if (resetPosition) 0 else listState.firstVisibleItemIndex,
            if (resetPosition) 0 else listState.firstVisibleItemScrollOffset, mode,selection)
    }
}
